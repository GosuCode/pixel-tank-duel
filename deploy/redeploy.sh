#!/usr/bin/env bash
# Pixel Tank Duel - redeploy code changes.
#
# Restarts the systemd service (so a changed server.js is picked up) and
# validates + reloads nginx. Touches nothing else - no UFW, no htpasswd, no
# port killing. Run the full setup-nginx-ufw.sh only for first-time host or
# infra changes.
#
#   npm run deploy                 # restart + reload nginx
#   npm run deploy -- --no-nginx   # restart only
#
# public/index.html is served from disk by express.static, so editing it needs
# no restart at all - just reload the browser.
set -euo pipefail

SERVICE="pixel-tank"
GAME_PORT="${GAME_PORT:-3000}"

DO_NGINX=1
for arg in "$@"; do
    case "$arg" in
        --no-nginx) DO_NGINX=0 ;;
        -h|--help)
            echo "usage: deploy/redeploy.sh [--no-nginx]"
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
    echo "Service $SERVICE.service not installed. Run deploy/setup-nginx-ufw.sh first." >&2
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

if [ "$DO_NGINX" -eq 1 ] && command -v nginx >/dev/null 2>&1; then
    echo "== Validating + reloading nginx =="
    $SUDO nginx -t
    $SUDO systemctl reload nginx
    echo "   nginx reloaded"
fi

echo
echo "Done. Re-run deploy/setup-nginx-ufw.sh only for host/infra changes."
