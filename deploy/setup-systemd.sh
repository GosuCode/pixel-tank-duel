#!/usr/bin/env bash
# Pixel Tank Duel - install the systemd service (first-time host setup).
# Run with:  sudo bash deploy/setup-systemd.sh
# Idempotent: safe to re-run (e.g. after a Node upgrade changes the node path).
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DIR/.." && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
GAME_PORT="${GAME_PORT:-3000}"

# Node binary: prefer the invoking user's environment (nvm etc.).
NODE_BIN="${NODE_BIN:-$(sudo -u "$RUN_USER" bash -lc 'command -v node' 2>/dev/null || true)}"
[ -z "$NODE_BIN" ] && NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
    echo "Could not find node. Re-run with: NODE_BIN=/path/to/node sudo -E bash $0"
    exit 1
fi

echo "user=$RUN_USER"
echo "repo=$REPO_DIR"
echo "node=$NODE_BIN"

echo "== Install + start systemd service =="
sed -e "s|@USER@|$RUN_USER|g" -e "s|@DIR@|$REPO_DIR|g" -e "s|@NODE@|$NODE_BIN|g" \
    "$DIR/pixel-tank.service" | sudo tee /etc/systemd/system/pixel-tank.service >/dev/null
# free the game port if a manually-started node is holding it
if command -v fuser >/dev/null 2>&1; then
    sudo fuser -k "$GAME_PORT/tcp" >/dev/null 2>&1 || true
fi
sudo systemctl daemon-reload
sudo systemctl enable --now pixel-tank
sleep 1
sudo systemctl --no-pager --full status pixel-tank | head -n 12

cat <<EOF

Done. The game is listening on 0.0.0.0:$GAME_PORT (LAN + tunnel).

Expose it to the internet with a Cloudflare Tunnel - see HOSTING.md.
Ship code changes afterwards with:  npm run deploy
EOF
