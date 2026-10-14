#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  Chakor one-command setup.
#  Installs deps, creates the Python venv used by Agent Workspace,
#  creates .env.local (with a generated AUTH_SECRET), initializes
#  the database, and builds the app.
# ──────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }

# 1. Node version check
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 20+ from https://nodejs.org and re-run." >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node 20+ is required (found $(node -v))." >&2
  exit 1
fi

# 2. Install dependencies
bold "→ Installing dependencies…"
npm install --legacy-peer-deps

# 3. Python venv for the Agent Workspace tools (docx/pptx/charts).
#    lib/workspace-tools.ts runs scripts/sandbox-runner.py with this
#    interpreter; without the venv those tools cannot work.
bold "→ Setting up the Python environment for Agent Workspace…"
PYBIN=""
if command -v python3 >/dev/null 2>&1; then PYBIN=python3
elif command -v python >/dev/null 2>&1; then PYBIN=python
fi
if [ -n "$PYBIN" ]; then
  [ -x .venv/bin/python ] || "$PYBIN" -m venv .venv
  .venv/bin/pip install --quiet --disable-pip-version-check python-docx python-pptx matplotlib pandas
else
  echo "  python3 not found — Agent Workspace document tools will not work." >&2
  echo "  Install Python 3.10+ and run:  python3 -m venv .venv && .venv/bin/pip install python-docx python-pptx matplotlib pandas" >&2
fi

# 4. Create .env.local if missing
if [ ! -f .env.local ]; then
  bold "→ Creating .env.local…"
  cp .env.example .env.local
  # Point the app at the venv created above (absolute path, survives cwd changes).
  if [ -x .venv/bin/python ]; then
    if sed --version >/dev/null 2>&1; then
      sed -i "s|^CHAKOR_PYTHON=.*|CHAKOR_PYTHON=\"$PWD/.venv/bin/python\"|" .env.local
    else
      sed -i '' "s|^CHAKOR_PYTHON=.*|CHAKOR_PYTHON=\"$PWD/.venv/bin/python\"|" .env.local
    fi
  fi
  if command -v openssl >/dev/null 2>&1; then
    SECRET="$(openssl rand -base64 32)"
    # Replace the placeholder secret with a real one (portable sed).
    if sed --version >/dev/null 2>&1; then
      sed -i "s|REPLACE_ME_WITH_openssl_rand_base64_32|${SECRET//|/\\|}|" .env.local
    else
      sed -i '' "s|REPLACE_ME_WITH_openssl_rand_base64_32|${SECRET//|/\\|}|" .env.local
    fi
    bold "  Generated a random AUTH_SECRET."
  else
    echo "  openssl not found — set AUTH_SECRET in .env.local manually."
  fi
  echo "  Review .env.local to add any model API keys before first use."
else
  bold "→ .env.local already exists — leaving it as-is."
fi

# 5. Initialize database
bold "→ Initializing database…"
npm run init-db

# 6. Build
bold "→ Building…"
npm run build

# 7. Verify the whole environment (non-fatal — it only reports)
bold "→ Running the environment checkup…"
node scripts/doctor.mjs || true

bold "✓ Done."
echo "Start the app with:  npm start"
echo "Then open:           http://localhost:3001"
echo "The first account you register becomes the admin."
if [ "$(uname -s)" != "Linux" ]; then
  echo ""
  echo "Note: Agent Workspace's Python sandbox limits (CPU/memory/process caps) are"
  echo "Linux-only — scripts/sandbox-runner.py uses the resource module and /proc."
  echo "On this OS the document tools may not run; use the Docker image instead."
fi
