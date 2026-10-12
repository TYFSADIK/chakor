#!/usr/bin/env python3
"""
Sandboxed Python runner for the Chakor agent workspace.

Reads one JSON document from stdin: {"code": "...", "workspace": "/abs/path"}
Runs the code in a subprocess with hard resource limits, then prints one JSON
document to stdout: {stdout, stderr, returncode, files} or {"error": ...}.

Environment:
  CHAKOR_WORKSPACE   allowed root every workspace must live under
                     (default: /tmp/chakor-workspace)
  CHAKOR_TIMEOUT     wall-clock seconds, also RLIMIT_CPU (default: 30)
  CHAKOR_MEMORY_MB   RLIMIT_AS for the child (default: 512)
"""

import json
import sys
import os
import subprocess
import traceback
import resource

WORKSPACE_ROOT = os.environ.get("CHAKOR_WORKSPACE", "/tmp/chakor-workspace")
TIMEOUT = int(os.environ.get("CHAKOR_TIMEOUT", "30"))
MEMORY_MB = int(os.environ.get("CHAKOR_MEMORY_MB", "512"))

# RLIMIT_NPROC is per-USER on Linux and counts threads, so a fixed small cap
# breaks on any host that already runs services as this user (threads from
# llama-server, Next.js, etc. all count). We measure the current count and
# give the child a fixed headroom on top: fork bombs still hit the wall,
# legitimate runs still work.
NPROC_HEADROOM = int(os.environ.get("CHAKOR_NPROC_HEADROOM", "64"))
_nproc_limit = None


def _thread_count():
    total = 0
    for pid in os.listdir("/proc"):
        if pid.isdigit():
            try:
                total += len(os.listdir(f"/proc/{pid}/task"))
            except Exception:
                pass
    return total


def set_limits():
    """Resource limits for the child process, applied via preexec_fn."""
    max_mem = MEMORY_MB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (max_mem, max_mem))
    resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT, TIMEOUT))
    if _nproc_limit:
        resource.setrlimit(resource.RLIMIT_NPROC, (_nproc_limit, _nproc_limit))


def list_files(workspace):
    files = []
    for f in os.listdir(workspace):
        if f.startswith("."):
            continue
        fp = os.path.join(workspace, f)
        if os.path.isfile(fp):
            files.append({"name": f, "size": os.path.getsize(fp)})
    return files


def main():
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    code = payload.get("code", "")
    if not isinstance(code, str) or not code.strip():
        print(json.dumps({"error": "No code provided"}))
        sys.exit(1)

    workspace = os.path.abspath(payload.get("workspace", WORKSPACE_ROOT))

    # Containment check: the workspace must live under the allowed root.
    allowed_root = os.path.abspath(WORKSPACE_ROOT)
    if workspace != allowed_root and not workspace.startswith(allowed_root + os.sep):
        print(json.dumps({"error": "Workspace path escape attempt blocked"}))
        sys.exit(1)

    os.makedirs(workspace, exist_ok=True)

    script_path = os.path.join(workspace, ".sandbox_script.py")
    with open(script_path, "w") as f:
        f.write(code)

    # Minimal allowlisted environment for the sandboxed child. Never copy
    # os.environ here: the server process holds secrets (OPENAI_API_KEY,
    # AUTH_SECRET, HF_TOKEN, ...) that sandboxed code must not be able to read.
    # Network egress could additionally be restricted at this boundary later
    # (e.g. by launching the child inside a network namespace).
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": workspace,
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPATH": "",
        "CHAKOR_WORKSPACE": allowed_root,
        # Keep native math libraries single-threaded: thread pools inside the
        # sandbox fight the process limit and slow small jobs down.
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
        "VECLIB_MAXIMUM_THREADS": "1",
    }
    for var in ("LANG", "LC_ALL", "LC_CTYPE", "TZ"):
        if os.environ.get(var):
            env[var] = os.environ[var]

    global _nproc_limit
    _nproc_limit = _thread_count() + NPROC_HEADROOM

    try:
        result = subprocess.run(
            [sys.executable, "-I", "-B", script_path],
            cwd=workspace,
            env=env,
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
            preexec_fn=set_limits,
        )
        print(json.dumps({
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
            "files": list_files(workspace),
        }))
    except subprocess.TimeoutExpired as e:
        print(json.dumps({
            "error": "Execution timed out",
            "timeout": TIMEOUT,
            "stdout": (e.stdout or "") if isinstance(e.stdout, str) else "",
            "stderr": (e.stderr or "") if isinstance(e.stderr, str) else "",
            "returncode": 124,
            "files": list_files(workspace),
        }))
    except Exception as e:
        print(json.dumps({"error": str(e), "traceback": traceback.format_exc()}))
    finally:
        try:
            os.unlink(script_path)
        except Exception:
            pass


if __name__ == "__main__":
    main()
