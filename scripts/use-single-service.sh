#!/usr/bin/env bash
#
# Fold the local model into one service. Chakor already knows how to run
# llama-server itself (it supervises it as a child process); this script just
# gets the old separate model service out of the way and moves the GPU reset
# onto the Chakor unit so it still runs at boot.
#
# Run once with sudo:
#     sudo bash scripts/use-single-service.sh
#
# After this there is a single service (chakor.service). Switching the model and
# context from the web UI then works with no sudo. To undo, see the end.
#
set -euo pipefail

CHAKOR_UNIT="${CHAKOR_UNIT:-chakor.service}"
LLAMA_UNIT="${CHAKOR_LLAMA_UNIT:-llama-gemma.service}"
DROPIN_DIR="/etc/systemd/system/${CHAKOR_UNIT}.d"
DROPIN="${DROPIN_DIR}/gpu-reset.conf"

if [ "$(id -u)" -ne 0 ]; then
  echo "This needs root to change systemd units. Re-run: sudo bash $0" >&2
  exit 1
fi

if ! systemctl cat "$CHAKOR_UNIT" >/dev/null 2>&1; then
  echo "Could not find '$CHAKOR_UNIT'. Set CHAKOR_UNIT=<your-unit> and retry." >&2
  exit 1
fi

# 1. Keep the privileged CUDA/UVM unwedge, now on the Chakor unit. Runs as root
#    (+) before the app and the model it supervises start. Harmless if no nvidia.
mkdir -p "$DROPIN_DIR"
cat > "$DROPIN" <<'EOF'
[Service]
# Clear a wedged CUDA/UVM state before the app (and the model it runs) starts.
ExecStartPre=+/bin/sh -c 'modprobe -r nvidia_uvm 2>/dev/null || true; modprobe nvidia_uvm || true'
EOF
echo "Wrote $DROPIN"

# 2. Take the old model service out of the way so Chakor can own the port and
#    Wants= can't revive it. A real unit file blocks `systemctl mask`, so stop it,
#    move the real file aside, then mask.
if systemctl cat "$LLAMA_UNIT" >/dev/null 2>&1; then
  systemctl stop "$LLAMA_UNIT" 2>/dev/null || true
  systemctl disable "$LLAMA_UNIT" 2>/dev/null || true
  UNIT_FILE="/etc/systemd/system/$LLAMA_UNIT"
  if [ -f "$UNIT_FILE" ] && [ ! -L "$UNIT_FILE" ]; then
    mv -f "$UNIT_FILE" "${UNIT_FILE}.disabled-by-chakor"
    echo "Backed up $UNIT_FILE -> ${UNIT_FILE}.disabled-by-chakor"
  fi
  systemctl daemon-reload
  systemctl mask "$LLAMA_UNIT" >/dev/null 2>&1 || true
  STATE="$(systemctl is-enabled "$LLAMA_UNIT" 2>/dev/null || true)"
  if [ -L "$UNIT_FILE" ] || [ "$STATE" = "masked" ]; then
    echo "Stopped + masked $LLAMA_UNIT (Chakor runs the model now)"
  else
    echo "Stopped $LLAMA_UNIT (Chakor runs the model now)"
  fi
fi

# 3. Reload and restart Chakor — its supervisor launches llama-server on boot.
systemctl daemon-reload
systemctl restart "$CHAKOR_UNIT"
sleep 2
echo
systemctl --no-pager --lines=0 status "$CHAKOR_UNIT" | head -5 || true
echo
echo "Done. One service now runs both the app and the model: $CHAKOR_UNIT"
echo "Watch the model come up:  journalctl -u $CHAKOR_UNIT -f | grep llama"
echo
echo "To undo (as root):"
echo "  systemctl unmask $LLAMA_UNIT"
echo "  [ -f /etc/systemd/system/$LLAMA_UNIT.disabled-by-chakor ] && mv /etc/systemd/system/$LLAMA_UNIT.disabled-by-chakor /etc/systemd/system/$LLAMA_UNIT"
echo "  rm -f $DROPIN && systemctl daemon-reload"
echo "  systemctl enable --now $LLAMA_UNIT && systemctl restart $CHAKOR_UNIT"
