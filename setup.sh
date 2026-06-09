#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
#  Chakor one-command setup.
#  Installs deps, creates .env.local (with a generated AUTH_SECRET),
#  initializes the database, and builds the app.
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

# 3. Create .env.local if missing
if [ ! -f .env.local ]; then
  bold "→ Creating .env.local…"
  cp .env.example .env.local
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

# 4. Initialize database
bold "→ Initializing database…"
npm run init-db

# 5. Build
bold "→ Building…"
npm run build

bold "✓ Done."
echo "Start the app with:  npm start"
echo "Then open:           http://localhost:3001"
echo "The first account you register becomes the admin."
