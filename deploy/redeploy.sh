#!/usr/bin/env bash
# Pixel Tank Duel - redeploy code changes.
#
# Restarts the systemd service so a changed server.js is picked up. Touches
# nothing else - no port killing, no infra changes. Run deploy/setup-systemd.sh
# only for first-time host setup.
#
#   npm run deploy
#
# public/index.html is served from disk by express.static, so editing it needs
# no restart at all - just reload the browser.
set -euo pipefail

SERVICE="pixel-tank"
GAME_PORT="${GAME_PORT:-3000}"

for arg in "$@"; do
    case "$arg" in
        -h|--help)
            echo "usage: deploy/redeploy.sh"
            exit 0
            ;;
        *)
            echo "unknown option: $arg" >&2
            exit 2
            ;;
    esac
done

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

if ! systemctl cat "$SERVICE" >/dev/null 2>&1; then
    echo "Service $SERVICE.service not installed. Run deploy/setup-systemd.sh first." >&2
    exit 1
fi

echo "== Restarting $SERVICE =="
$SUDO systemctl restart "$SERVICE"

# Node needs a moment to bind; surface an immediate crash instead of a false OK.
sleep 1
if ! systemctl is-active --quiet "$SERVICE"; then
    echo "$SERVICE failed to start:" >&2
    $SUDO systemctl --no-pager --full status "$SERVICE" | tail -n 20 >&2
    exit 1
fi
echo "   $SERVICE active (port $GAME_PORT)"

echo
echo "Done."
