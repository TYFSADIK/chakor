#!/usr/bin/env bash
# ==============================================================================
#  Chakor installer  -  hands-off setup for Linux, macOS, and Android (Termux).
#
#  Run one command and it sorts out everything Chakor needs, then starts it.
#  No manual dependency hunting, no babysitting it through the install.
#
#  In order, it:
#    1. Works out your OS, distro, and package manager.
#    2. Asks for your password ONCE (only if it needs root at all), then keeps
#       that grant alive so the rest runs start to finish without stopping.
#    3. Installs the system tools: git, curl, a C/C++ build chain, Python,
#       OpenSSL, and Node 20+.
#    4. Installs Ollama so you can run local models with no compiling (skippable).
#    5. Optionally builds llama.cpp from source, with NVIDIA CUDA if you have it.
#    6. Installs the app's deps, writes .env.local with a fresh AUTH_SECRET,
#       sets up the database, and builds the app.
#    7. Starts Chakor, or installs it as a service that runs 24/7.
#
#  Examples:
#      bash install.sh                  # core tools + Ollama, then start
#      bash install.sh --all            # also build llama.cpp (CUDA auto-detected)
#      bash install.sh --with-llama-cpp # add a local llama-server build
#      bash install.sh --service        # install + run as a systemd service
#      sudo bash install.sh --yes       # fully unattended, e.g. a fresh server
#      bash install.sh --dry-run        # show the plan, change nothing
#      bash install.sh --help           # every option
#
#  About root and passwords: this script never weakens your machine to skip
#  prompts. It does not write passwordless-sudo rules. It asks once and caches
#  the grant for this run only. If you are already root (a typical VPS or
#  container) there is no prompt at all. The long-running app is set up to run as
#  a normal user, not root, so a server that faces the network is never one bug
#  away from owning the whole box.
# ==============================================================================

set -Eeuo pipefail

# ---- where we are, and where to log -----------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
LOG_FILE="${SCRIPT_DIR}/install.log"
if ! : > "$LOG_FILE" 2>/dev/null; then
  LOG_FILE="$(mktemp -t chakor-install.XXXXXX.log 2>/dev/null || echo /tmp/chakor-install.log)"
fi
NODE_MIN_MAJOR=20

# ---- options (env CHAKOR_ASSUME_YES=1 also flips --yes) ----------------------
ASSUME_YES="${CHAKOR_ASSUME_YES:-0}"
INSTALL_OLLAMA=1
WITH_LLAMA_CPP=0
WITH_CUDA=0
DO_START=1
INSTALL_SERVICE=0
MINIMAL=0
DRY_RUN=0
SUDO=""
SUDO_KEEPALIVE_PID=""
LLAMA_SERVER_BIN_BUILT=""

# ---- pretty output, everything also tee'd to the log ------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_G=$'\033[1;32m'; C_Y=$'\033[1;33m'; C_R=$'\033[1;31m'
  C_B=$'\033[1;34m'; C_DIM=$'\033[2m'; C_0=$'\033[0m'
else
  C_G=""; C_Y=""; C_R=""; C_B=""; C_DIM=""; C_0=""
fi
log()  { printf '%s\n' "$*" >>"$LOG_FILE" 2>/dev/null || true; }
say()  { printf '%s%s%s\n' "$C_G" "$*" "$C_0"; log "$*"; }
step() { printf '\n%s==>%s %s\n' "$C_B" "$C_0" "$*"; log "==> $*"; }
info() { printf '%s\n' "$*"; log "$*"; }
warn() { printf '%s!  %s%s\n' "$C_Y" "$*" "$C_0" >&2; log "!  $*"; }
err()  { printf '%sx  %s%s\n' "$C_R" "$*" "$C_0" >&2; log "x  $*"; }

# ---- run a command, log it, and (in dry-run) only describe it ----------------
run() {
  log "\$ $*"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '   %s(dry-run) would run:%s %s\n' "$C_DIM" "$C_0" "$*"
    return 0
  fi
  "$@" > >(tee -a "$LOG_FILE") 2>&1
}

# ---- retry a flaky (usually network) command with a little backoff ----------
retry() {
  local tries="$1"; shift
  local n=1
  until "$@"; do
    if [ "$n" -ge "$tries" ]; then return 1; fi
    warn "attempt $n failed, retrying in $((n * 3))s..."
    sleep "$((n * 3))"
    n=$((n + 1))
  done
}

# ---- run a best-effort step: if it fails, warn and carry on ------------------
optional() {
  local name="$1"; shift
  if "$@"; then return 0; fi
  warn "Optional step '$name' did not finish. Chakor will still run. See $LOG_FILE."
  return 0
}

have() { command -v "$1" >/dev/null 2>&1; }

# ---- tidy up + a friendly message if something fatal goes wrong --------------
cleanup() {
  if [ -n "$SUDO_KEEPALIVE_PID" ]; then
    kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
  fi
}
on_error() {
  local line="$1" cmd="$2"
  err "Install stopped on line $line:  $cmd"
  err "Full log:  $LOG_FILE"
  err "Fix the issue above and run 'bash install.sh' again. It is safe to re-run."
  cleanup
  exit 1
}
trap 'on_error "${LINENO}" "${BASH_COMMAND}"' ERR
trap cleanup EXIT

# ---- help --------------------------------------------------------------------
usage() {
  cat <<'EOF'
Chakor installer

Usage:  bash install.sh [options]

Options:
  -y, --yes            Non-interactive. Assume yes (or env CHAKOR_ASSUME_YES=1).
      --all            Everything: core tools, Ollama, and build llama.cpp
                       (CUDA is auto-detected if the toolkit is present).
      --with-llama-cpp Build a local llama-server from source.
      --with-cuda      Build llama.cpp with NVIDIA CUDA (implies --with-llama-cpp).
      --no-ollama      Do not install Ollama.
      --minimal        Only Node + the app. Bring your own model engine.
      --service        Install + start a systemd service (runs 24/7, needs root/sudo).
      --no-start       Set everything up but do not start the app.
      --dry-run        Print the plan and change nothing on disk.
  -h, --help           Show this and exit.

Notes:
  - Asks for your password at most once, then runs to the end without stopping.
  - On a box where you are already root there is no prompt at all.
  - The app is set up to run as a normal user, never as root.
EOF
}

# ---- parse args --------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    -y|--yes|--non-interactive) ASSUME_YES=1 ;;
    --all)             WITH_LLAMA_CPP=1; WITH_CUDA=1 ;;
    --with-llama-cpp|--with-llama) WITH_LLAMA_CPP=1 ;;
    --with-cuda)       WITH_LLAMA_CPP=1; WITH_CUDA=1 ;;
    --no-ollama)       INSTALL_OLLAMA=0 ;;
    --minimal)         MINIMAL=1; INSTALL_OLLAMA=0 ;;
    --service)         INSTALL_SERVICE=1; DO_START=0 ;;
    --no-start)        DO_START=0 ;;
    --dry-run|--check) DRY_RUN=1 ;;
    -h|--help)         usage; exit 0 ;;
    *) err "Unknown option: $1"; echo; usage; exit 2 ;;
  esac
  shift
done

# ---- detect the environment --------------------------------------------------
OS="$(uname -s 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"
IS_TERMUX=0; case "${PREFIX:-}" in *com.termux*) IS_TERMUX=1 ;; esac
IS_ROOT=0; [ "$(id -u 2>/dev/null || echo 1000)" -eq 0 ] && IS_ROOT=1
DISTRO=""
if [ -r /etc/os-release ]; then
  DISTRO="$(. /etc/os-release 2>/dev/null; printf '%s' "${ID:-}")"
fi

PM=""
detect_pm() {
  if [ "$IS_TERMUX" -eq 1 ] && have pkg; then PM=pkg
  elif [ "$OS" = "Darwin" ]; then have brew && PM=brew || PM=""
  elif have apt-get; then PM=apt
  elif have dnf;     then PM=dnf
  elif have yum;     then PM=yum
  elif have pacman;  then PM=pacman
  elif have zypper;  then PM=zypper
  elif have apk;     then PM=apk
  else PM=""; fi
}

# ---- get root once, keep it warm, never make it permanent -------------------
setup_privileges() {
  SUDO=""
  [ "$IS_ROOT" -eq 1 ] && return 0          # already root: no prompt, no sudo
  [ "$PM" = "brew" ] && return 0            # Homebrew refuses root, runs as you
  [ "$PM" = "pkg" ] && return 0             # Termux is user-space
  if ! have sudo; then
    warn "sudo not found and you are not root. I will install what I can in user space."
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then SUDO="sudo"; return 0; fi
  step "Asking for your password once so the rest runs without stopping"
  if sudo -v; then
    SUDO="sudo"
    # Refresh the sudo timestamp in the background until the script exits, so it
    # never stops mid-install to ask again. This is cached for THIS RUN only.
    ( while true; do sudo -n true 2>/dev/null || exit 0; sleep 50; done ) &
    SUDO_KEEPALIVE_PID=$!
  else
    warn "No sudo access granted. Falling back to user-space installs (nvm)."
    SUDO=""
  fi
}

# ---- package manager helpers -------------------------------------------------
pm_refresh() {
  case "$PM" in
    apt)    run $SUDO apt-get update -y || true ;;
    pacman) run $SUDO pacman -Sy --noconfirm || true ;;
    zypper) run $SUDO zypper --non-interactive refresh || true ;;
    apk)    run $SUDO apk update || true ;;
    pkg)    run pkg update -y || true ;;
    *)      : ;;
  esac
}
pm_install() {
  [ $# -eq 0 ] && return 0
  case "$PM" in
    apt)    run $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" ;;
    dnf)    run $SUDO dnf install -y "$@" ;;
    yum)    run $SUDO yum install -y "$@" ;;
    pacman) run $SUDO pacman -S --needed --noconfirm "$@" ;;
    zypper) run $SUDO zypper --non-interactive install -y "$@" ;;
    apk)    run $SUDO apk add "$@" ;;
    brew)   run brew install "$@" ;;
    pkg)    run pkg install -y "$@" ;;
    *)      return 1 ;;
  esac
}

# ---- base tools: git, curl, compiler, python, openssl -----------------------
ensure_base_tools() {
  step "Installing base tools (git, curl, compiler, python3, openssl)"
  pm_refresh
  case "$PM" in
    apt)    pm_install git curl ca-certificates build-essential python3 openssl pkg-config ;;
    dnf)    pm_install git curl ca-certificates gcc gcc-c++ make python3 openssl pkgconf-pkg-config ;;
    yum)    pm_install git curl ca-certificates gcc gcc-c++ make python3 openssl ;;
    pacman) pm_install git curl base-devel python openssl ;;
    zypper) pm_install git curl gcc gcc-c++ make python3 openssl ;;
    apk)    pm_install git curl ca-certificates build-base python3 openssl ;;
    brew)   have git || pm_install git ;;
    pkg)    pm_install git python openssl clang make ;;
    *)      warn "No known package manager. Make sure git, a C/C++ compiler, python3 and openssl are installed." ;;
  esac
  # macOS gets its compiler from the Xcode command line tools.
  if [ "$OS" = "Darwin" ] && ! have cc && ! have clang; then
    warn "Installing the Xcode command line tools (a system dialog may appear)."
    run xcode-select --install || true
  fi
}

# ---- Node 20+ ----------------------------------------------------------------
node_ok() {
  have node || return 1
  local maj; maj="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${maj:-0}" -ge "$NODE_MIN_MAJOR" ]
}
install_node_nvm() {
  step "Installing Node ${NODE_MIN_MAJOR} in user space via nvm (no root needed)"
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    retry 3 run bash -c 'set -o pipefail; curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
  fi
  if [ "$DRY_RUN" -eq 0 ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install "$NODE_MIN_MAJOR"
    nvm use "$NODE_MIN_MAJOR" >/dev/null
    hash -r 2>/dev/null || true
  fi
}
install_node_system() {
  case "$PM" in
    apt)     retry 3 run bash -c "set -o pipefail; curl -fsSL https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x | ${SUDO:+$SUDO -E }bash -" && pm_install nodejs ;;
    dnf|yum) retry 3 run bash -c "set -o pipefail; curl -fsSL https://rpm.nodesource.com/setup_${NODE_MIN_MAJOR}.x | ${SUDO:+$SUDO -E }bash -" && pm_install nodejs ;;
    pacman)  pm_install nodejs npm ;;
    zypper)  pm_install nodejs20 npm20 || pm_install nodejs npm ;;
    apk)     pm_install nodejs npm ;;
    brew)    pm_install node ;;
    pkg)     pm_install nodejs-lts || pm_install nodejs ;;
    *)       return 1 ;;
  esac
}
ensure_node() {
  if node_ok; then say "Node $(node -v) already present."; return 0; fi
  step "Installing Node ${NODE_MIN_MAJOR}+"
  if [ -n "$PM" ] && { [ "$IS_ROOT" -eq 1 ] || [ -n "$SUDO" ] || [ "$PM" = brew ] || [ "$PM" = pkg ]; }; then
    if ! install_node_system; then
      warn "System Node install did not work. Falling back to nvm."
      install_node_nvm
    fi
  else
    install_node_nvm
  fi
  [ "$DRY_RUN" -eq 1 ] && { info "   (dry-run) Node ${NODE_MIN_MAJOR}+ would be installed here."; return 0; }
  if ! node_ok; then
    err "Could not get Node ${NODE_MIN_MAJOR}+ working automatically."
    err "Install it from https://nodejs.org and run this again."
    return 1
  fi
  say "Node $(node -v) ready."
}

# ---- Ollama (no compiling, broadest local-model support) --------------------
ensure_ollama() {
  if have ollama; then say "Ollama already installed."; return 0; fi
  step "Installing Ollama (run local models with no compiling)"
  if [ "$IS_TERMUX" -eq 1 ]; then
    warn "Ollama has no Termux build. Use --with-llama-cpp, or the in-app Hugging Face downloader."
    return 0
  fi
  if [ "$OS" = "Darwin" ]; then
    if [ "$PM" = "brew" ]; then
      pm_install ollama || warn "brew install ollama failed. Get it at https://ollama.com/download"
    else
      warn "Download Ollama for macOS at https://ollama.com/download (Chakor finds it automatically once it runs)."
    fi
    return 0
  fi
  retry 3 run bash -c 'set -o pipefail; curl -fsSL https://ollama.com/install.sh | sh' \
    || warn "Ollama install script failed. Get it at https://ollama.com/download. Chakor still runs without it."
  have ollama && say "Ollama ready. Pull a model any time with:  ollama pull llama3.2"
  return 0
}

# ---- llama.cpp from source (opt-in), with CUDA if it is here ----------------
ensure_cmake() { have cmake && return 0; pm_install cmake; }
gpu_has_nvidia() { have nvidia-smi && nvidia-smi -L >/dev/null 2>&1; }
print_cuda_hint() {
  case "$PM" in
    apt)     info "   Debian/Ubuntu: sudo apt-get install -y nvidia-cuda-toolkit  (or NVIDIA's CUDA repo for the newest)" ;;
    dnf|yum) info "   Fedora/RHEL: enable NVIDIA's CUDA repo, then: sudo dnf install -y cuda-toolkit" ;;
    pacman)  info "   Arch: sudo pacman -S cuda" ;;
    *)       info "   See https://developer.nvidia.com/cuda-downloads" ;;
  esac
}
build_llama_cpp() {
  step "Building llama.cpp from source"
  ensure_cmake || { warn "cmake is not available, cannot build llama.cpp."; return 1; }
  local src="${LLAMA_CPP_DIR:-$HOME/llama.cpp}"
  if [ -d "$src/.git" ]; then
    run git -C "$src" pull --ff-only || true
  else
    retry 3 run git clone --depth 1 https://github.com/ggml-org/llama.cpp "$src"
  fi
  local flags="-DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=ON"
  if [ "$WITH_CUDA" -eq 1 ] || gpu_has_nvidia; then
    if have nvcc; then
      flags="$flags -DGGML_CUDA=ON"
      say "CUDA toolkit found. Building llama.cpp with GPU acceleration."
    else
      warn "NVIDIA GPU detected but the CUDA toolkit (nvcc) is not installed. Building a CPU version for now."
      warn "For GPU speed, install the CUDA toolkit then re-run:  bash install.sh --with-cuda"
      print_cuda_hint
    fi
  fi
  run cmake -S "$src" -B "$src/build" $flags
  run cmake --build "$src/build" --config Release -j "$(nproc 2>/dev/null || echo 2)" --target llama-server
  local bin="$src/build/bin/llama-server"
  if [ "$DRY_RUN" -eq 1 ]; then info "   (dry-run) llama-server would build at $bin"; return 0; fi
  [ -x "$bin" ] || { warn "llama-server was not produced by the build."; return 1; }
  LLAMA_SERVER_BIN_BUILT="$bin"
  say "Built llama-server at $bin"
}

# ---- the app itself: deps, .env.local, database, build ----------------------
run_app_setup() {
  step "Installing app dependencies, writing config, building"
  run bash "$SCRIPT_DIR/setup.sh"
}
wire_llama_env() {
  [ -n "$LLAMA_SERVER_BIN_BUILT" ] || return 0
  local env="$SCRIPT_DIR/.env.local"
  [ -f "$env" ] || return 0
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  if grep -q '^LLAMA_SERVER_BIN=' "$env" 2>/dev/null; then
    sed -i.bak "s|^LLAMA_SERVER_BIN=.*|LLAMA_SERVER_BIN=\"$LLAMA_SERVER_BIN_BUILT\"|" "$env" && rm -f "$env.bak"
  else
    printf 'LLAMA_SERVER_BIN="%s"\n' "$LLAMA_SERVER_BIN_BUILT" >> "$env"
  fi
  say "Pointed Chakor at your llama-server build."
}

# ---- run it 24/7 as a service (runs as a normal user, not root) -------------
RUN_USER="$(id -un 2>/dev/null || echo root)"
[ "$IS_ROOT" -eq 1 ] && [ -n "${SUDO_USER:-}" ] && RUN_USER="$SUDO_USER"
install_systemd_service() {
  if ! have systemctl; then
    warn "No systemd here. Start Chakor yourself with 'npm start', or use Docker."
    return 1
  fi
  step "Installing the systemd service (starts on boot, restarts on crash)"
  local node_bin unit tmp
  node_bin="$(command -v node)"
  unit="/etc/systemd/system/chakor.service"
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
[Unit]
Description=Chakor (self-hosted AI workspace)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${SCRIPT_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${SCRIPT_DIR}/.env.local
ExecStart=${node_bin} ${SCRIPT_DIR}/node_modules/next/dist/bin/next start -p 3001 -H 0.0.0.0
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
  run $SUDO cp "$tmp" "$unit"
  rm -f "$tmp"
  run $SUDO systemctl daemon-reload
  run $SUDO systemctl enable --now chakor.service
  say "Service installed. Runs as user '${RUN_USER}', starts on boot."
  info "   Status:  ${SUDO:+sudo }systemctl status chakor"
  info "   Logs:    journalctl -u chakor -f"
}

print_summary() {
  printf '\n%s------------------------------------------------------------%s\n' "$C_G" "$C_0"
  say "Chakor is set up."
  local bits="git, build tools, Node $(node -v 2>/dev/null || echo '?')"
  have ollama && bits="$bits, Ollama"
  [ -n "$LLAMA_SERVER_BIN_BUILT" ] && bits="$bits, llama.cpp"
  info "Installed: ${bits}."
  info ""
  info "Open      http://localhost:3001   (first account you register is the admin)"
  if ! have ollama && [ -z "$LLAMA_SERVER_BIN_BUILT" ]; then
    info "Get a model: install Ollama (re-run without --no-ollama), add a cloud key in"
    info "             .env.local, or download a GGUF from inside the app (Settings -> Models)."
  fi
  info "Config    edit .env.local to add cloud keys or rebrand"
  info "Log       $LOG_FILE"
  printf '%s------------------------------------------------------------%s\n' "$C_G" "$C_0"
}

# ---- orchestrate -------------------------------------------------------------
main() {
  printf '\n%sChakor installer%s  (%s, %s, %s)\n' "$C_G" "$C_0" "$OS" "$ARCH" "${DISTRO:-unknown distro}"
  [ "$DRY_RUN" -eq 1 ] && warn "Dry run: nothing will be installed or changed."

  detect_pm
  [ -z "$PM" ] && warn "No package manager detected. I will use what is already on PATH."
  setup_privileges

  if [ "$MINIMAL" -eq 0 ]; then
    ensure_base_tools
  else
    info "Minimal mode: skipping system tools and Ollama."
  fi

  ensure_node

  if [ "$INSTALL_OLLAMA" -eq 1 ]; then
    optional "Ollama" ensure_ollama
  fi
  if [ "$WITH_LLAMA_CPP" -eq 1 ]; then
    optional "llama.cpp" build_llama_cpp
  fi

  run_app_setup
  wire_llama_env

  if [ "$INSTALL_SERVICE" -eq 1 ]; then
    if [ "$IS_ROOT" -eq 1 ] || [ -n "$SUDO" ]; then
      optional "systemd service" install_systemd_service
    else
      warn "--service needs root or sudo. Skipping. Start with 'npm start' or use Docker."
    fi
  fi

  print_summary

  if [ "$DO_START" -eq 1 ] && [ "$INSTALL_SERVICE" -eq 0 ]; then
    say "Starting Chakor on http://localhost:3001  (Ctrl+C to stop)"
    if [ "$DRY_RUN" -eq 1 ]; then
      info "   (dry-run) would run: npm start"
      exit 0
    fi
    cleanup
    exec npm start
  fi
}

main "$@"
