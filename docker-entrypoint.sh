#!/usr/bin/env sh
# Boots the app with zero manual config. If no AUTH_SECRET is provided, we
# generate one and keep it in the data volume so sessions survive restarts.
set -e

if [ -z "${AUTH_SECRET:-}" ]; then
  if [ -f /data/.auth_secret ]; then
    AUTH_SECRET="$(cat /data/.auth_secret)"
  else
    AUTH_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
    echo "$AUTH_SECRET" > /data/.auth_secret
    echo "[chakor] generated a new AUTH_SECRET (stored in the data volume)"
  fi
  export AUTH_SECRET
fi

exec npm start
