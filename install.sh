#!/usr/bin/env bash
# ==============================================================
#  Chakor installer for Linux, macOS, and Android (Termux).
#
#  Run it and it sorts out Node for you, installs everything,
#  sets up your config, builds, and starts the app. No manual
#  dependency hunting.
#
#      bash install.sh
# ==============================================================
set -e
cd "$(dirname "$0")"

say()  { printf '\033[1;32m%s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$1"; }
err()  { printf '\033[1;31m%s\033[0m\n' "$1" >&2; }

# ---- figure out where we are ----
OS="$(uname -s 2>/dev/null || echo unknown)"
IS_TERMUX=0
case "${PREFIX:-}" in *com.termux*) IS_TERMUX=1;; esac

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 20 ]
}

install_node() {
  warn "Node 20+ not found. Installing it for you..."
  if [ "$IS_TERMUX" -eq 1 ]; then
    pkg install -y nodejs-lts || pkg install -y nodejs
  elif [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    brew install node
  else
    # Universal, no-sudo fallback: nvm in the user's home.
    say "Using nvm (no admin rights needed)."
    export NVM_DIR="$HOME/.nvm"
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    fi
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install 20
    nvm use 20
  fi
}

if node_ok; then
  say "Node $(node -v) found."
else
  install_node
  if ! node_ok; then
    err "Could not get Node 20+ installed automatically."
    err "Install Node 20+ from https://nodejs.org and run this again."
    exit 1
  fi
  say "Node $(node -v) ready."
fi

# ---- deps, config, db, build (setup.sh handles the details) ----
say "Setting things up..."
bash ./setup.sh

# ---- go ----
say "Starting Chakor on http://localhost:3001"
say "First account you register becomes the admin. Press Ctrl+C to stop."
exec npm start
