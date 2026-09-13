#!/usr/bin/env bash
# Pixel Tank Duel — nginx reverse proxy, systemd service, firewall setup.
# Run with:  sudo bash /tmp/opencode/setup-nginx-ufw.sh
# Idempotent-ish: safe to re-run. Backs up the existing api-gateway vhost.
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DIR/.." && pwd)"
RUN_USER="${SUDO_USER:-$(id -un)}"
GAME_PORT="${GAME_PORT:-3000}"
PROXY_PORT="${PROXY_PORT:-8080}"

# LAN subnet to allow: explicit override, else auto-detect from the default route interface.
LAN_IF="$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')"
LAN_CIDR="${LAN_CIDR:-$(ip -o -f inet addr show dev "$LAN_IF" scope global 2>/dev/null | awk '{print $4}' | head -1)}"
if [ -z "$LAN_CIDR" ]; then
    echo "Could not detect a LAN subnet. Re-run with: LAN_CIDR=192.168.0.0/24 sudo -E bash $0"
    exit 1
fi

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
echo "lan=$LAN_CIDR"

echo "== [1/7] Install nginx vhosts =="
sudo install -m 644 "$DIR/game-limits.conf" /etc/nginx/conf.d/game-limits.conf
sudo install -m 644 "$DIR/pixel-tank.nginx" /etc/nginx/sites-available/pixel-tank
sudo ln -sf /etc/nginx/sites-available/pixel-tank /etc/nginx/sites-enabled/pixel-tank

echo "== [2/7] Patch api-gateway with WebSocket headers (backup kept) =="
if [ -f /etc/nginx/sites-available/api-gateway ] && ! grep -q 'proxy_set_header Upgrade' /etc/nginx/sites-available/api-gateway; then
    sudo cp /etc/nginx/sites-available/api-gateway "/etc/nginx/sites-available/api-gateway.bak-$(date +%Y%m%d-%H%M%S)"
    sudo install -m 644 "$DIR/api-gateway.patched" /etc/nginx/sites-available/api-gateway
    echo "   patched."
else
    echo "   already patched or file missing; skipping."
fi

echo "== [3/7] Basic-auth user for the public proxy =="
if [ ! -f /etc/nginx/.htpasswd-pixel ]; then
    sudo apt-get install -y apache2-utils
    read -rp "   choose a username for the game login: " U
    sudo htpasswd -c /etc/nginx/.htpasswd-pixel "$U"
else
    echo "   /etc/nginx/.htpasswd-pixel exists."
    echo "   add another user with: sudo htpasswd /etc/nginx/.htpasswd-pixel USER"
fi

echo "== [4/7] Test nginx config =="
sudo nginx -t || { echo "nginx config test FAILED — aborting."; exit 1; }

echo "== [5/7] Reload nginx =="
sudo systemctl reload nginx

echo "== [6/7] Install + start systemd service =="
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

echo "== [7/7] Trim UFW and scope $GAME_PORT to LAN =="
for spec in 8080 5000/tcp 5173/tcp "$GAME_PORT"; do
    for _ in 1 2; do
        sudo ufw --force delete allow "$spec" >/dev/null 2>&1 || true
    done
done
sudo ufw allow from "$LAN_CIDR" to any port "$GAME_PORT" proto tcp
sudo ufw status numbered

cat <<EOF

Done.

Tailscale (if not already):
  1. sudo tailscale up
  2. Admin console: enable MagicDNS + HTTPS certificates.
     Add to Access Controls:
       "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]
  3. sudo tailscale funnel --bg $PROXY_PORT
  4. Public URL: https://<host>.<tailnet>.ts.net  (basic-auth prompt, then the game)

If the public URL fails to load, allow Funnel ingress:
  sudo ufw allow 443/tcp
EOF
