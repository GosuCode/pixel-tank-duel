# Hosting & Remote Access

How Pixel Tank Duel is hosted on this machine and made reachable from the internet
without port-forwarding, using **systemd + nginx + UFW + Tailscale Funnel**.

This document is the "how it was set up" companion to `README.md`. It covers the
exact commands, config files, and the gotchas we hit.

---

## Architecture

```
                      public internet
                            │  HTTPS :443
                            ▼
              ┌──────────────────────────────┐
              │  Tailscale Funnel            │
              │  <host>.<tailnet>.ts.net     │  (TLS terminated by Tailscale)
              └──────────────┬───────────────┘
                             │  http://127.0.0.1:8080
                             ▼
              ┌──────────────────────────────┐
              │  nginx  (127.0.0.1:8080)     │
              │  - HTTP basic auth           │
              │  - limit_req / limit_conn    │
              │  - WebSocket proxy headers   │
              └──────────────┬───────────────┘
                             │  http://127.0.0.1:3000  (HTTP + WebSocket)
                             ▼
              ┌──────────────────────────────┐
              │  Node game server (:3000)    │
              │  managed by systemd          │
              └──────────────────────────────┘

Same Wi-Fi (LAN):  http://<host-lan-ip>:3000  ────────────────────┘  (no auth)
```

Why each layer:

- **Node server** — authoritative game state, WebSockets at 60 Hz. Needs a persistent process (not serverless).
- **systemd** — keeps it running across crashes/reboots.
- **nginx** — TLS-agnostic reverse proxy that adds auth and rate limiting, and correctly forwards WebSocket upgrades.
- **UFW** — scopes the LAN port; nothing is exposed `Anywhere`.
- **Tailscale Funnel** — public HTTPS ingress through Tailscale's relays, so no router port-forwarding is needed (works behind NAT/CGNAT).

Example environment: Ubuntu/Pop!_OS 22.04, hostname `your-host`, tailnet `<tailnet>.ts.net`.
Replace the `<...>` placeholders below with your own values.

---

## 1. Application configuration

`server.js` reads two env vars:

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | listen port |
| `HOST` | `0.0.0.0` | bind address |

```bash
PORT=8080 HOST=127.0.0.1 npm start
```

For the nginx setup the game listens on `0.0.0.0:3000` so both LAN devices and the
nginx proxy (loopback) can reach it.

---

## 2. systemd service

`deploy/pixel-tank.service` is a **template** (placeholders `@USER@`, `@DIR@`, `@NODE@`).
The installer fills them in for the current user/repo/node and writes the real unit to
`/etc/systemd/system/pixel-tank.service`:

```ini
[Unit]
Description=Pixel Tank Duel (authoritative game server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=@USER@
WorkingDirectory=@DIR@
ExecStart=@NODE@ server.js
Environment=HOST=0.0.0.0
Environment=PORT=3000
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

`deploy/setup-nginx-ufw.sh` generates and installs it automatically. To do it by hand:

```bash
sed -e "s|@USER@|$USER|g" \
    -e "s|@DIR@|$PWD|g" \
    -e "s|@NODE@|$(command -v node)|g" \
    deploy/pixel-tank.service | sudo tee /etc/systemd/system/pixel-tank.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now pixel-tank
systemctl status pixel-tank
```

> **nvm gotcha:** the generated `ExecStart` points at a versioned nvm path. After
> upgrading Node, re-run the installer (or the `sed` above) and
> `sudo systemctl daemon-reload && sudo systemctl restart pixel-tank`.

---

## 3. nginx reverse proxy

### Rate-limit zones — `/etc/nginx/conf.d/game-limits.conf`

```nginx
limit_req_zone $binary_remote_addr zone=game:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=perip:10m;
```

### Game vhost — `/etc/nginx/sites-available/pixel-tank`

```nginx
server {
    listen 127.0.0.1:8080;
    server_name _;

    auth_basic "Armory";
    auth_basic_user_file /etc/nginx/.htpasswd-pixel;

    # Tailscale Funnel/Serve proxies from loopback; recover the real client IP
    # from X-Forwarded-For so the per-IP limits below actually work.
    set_real_ip_from 127.0.0.1;
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;

    limit_req zone=game burst=15 nodelay;
    limit_conn perip 6;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Key points:

- Binds **loopback only** (`127.0.0.1:8080`) — reachable by Tailscale, never directly from the LAN/internet, so no UFW rule is needed for 8080.
- `Upgrade`/`Connection` headers are **required** for the game's WebSockets.
- `auth_basic` protects the public URL; `limit_req`/`limit_conn` blunt abuse.

Enable + reload:

```bash
sudo ln -sf /etc/nginx/sites-available/pixel-tank /etc/nginx/sites-enabled/pixel-tank
sudo nginx -t && sudo systemctl reload nginx
```

Create a login (username + password prompt):

```bash
sudo apt-get install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-pixel <username>
# add more users later:
sudo htpasswd /etc/nginx/.htpasswd-pixel <another-user>
```

### Existing `api-gateway` vhost

The pre-existing `/etc/nginx/sites-available/api-gateway` (port 80 → `127.0.0.1:3000`)
was missing the WebSocket upgrade headers. It was patched with a backup kept as
`api-gateway.bak-<timestamp>` (see `deploy/api-gateway.patched`).

---

## 4. Firewall (UFW)

Only the LAN port is opened, scoped to the local subnet — nothing `Anywhere`:

```bash
# remove the old broad rules (v4 + v6)
for spec in 8080 5000/tcp 5173/tcp 3000; do
  sudo ufw --force delete allow "$spec"
done

# allow the game from the LAN only
sudo ufw allow from 192.168.0.0/24 to any port 3000 proto tcp
sudo ufw status numbered
```

Funnel ingress arrives at tailscaled on `443`; if the public URL doesn't load,
`sudo ufw allow 443/tcp` (public by design, since that's what Funnel is).

---

## 5. Tailscale + Funnel

Install (Ubuntu/Pop!_OS):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

> **Gotcha we hit:** `install.sh` runs `apt-get update`, which aborted with exit 100
> because the **MySQL apt repo's signing key had rotated** (`NO_PUBKEY B7B3B788A8D3785C`).
> Fix before installing Tailscale:
> ```bash
> curl -fsSL https://repo.mysql.com/RPM-GPG-KEY-mysql-2023 \
>   | sudo gpg --dearmor -o /usr/share/keyrings/mysql-apt-config.gpg
> sudo apt-get update
> ```

In the Tailscale admin console:

1. Enable **MagicDNS**.
2. Enable **HTTPS certificates**.
3. Add the Funnel node attribute in **Access Controls**:
   ```jsonc
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] }
   ]
   ```

Publish the game through nginx:

```bash
sudo tailscale funnel --bg 8080
tailscale funnel status
```

Result:

```
https://<host>.<tailnet>.ts.net
|-- / proxy http://127.0.0.1:8080
```

Friends open the URL, get the basic-auth prompt, then the game. They do **not** need
Tailscale installed for Funnel.

---

## 6. Verification

```bash
# game up?
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/          # 200

# nginx proxy (expect 401 = auth prompt)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/          # 401

# public funnel URL (expect 401)
curl -s -o /dev/null -w '%{http_code}\n' https://<host>.<tailnet>.ts.net/

# LAN direct
curl -s -o /dev/null -w '%{http_code}\n' http://<host-lan-ip>:3000/       # 200
```

Then load the Funnel URL in a browser on mobile data and confirm tanks move
(WebSocket path works end-to-end).

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| **503 Bad Gateway** from the public URL | nginx is up but the game isn't listening on `:3000` | `sudo systemctl start pixel-tank` (or `systemctl status pixel-tank`) |
| `apt-get update` fails with `NO_PUBKEY` | MySQL repo key rotated | refresh key (see §5) |
| `EADDRINUSE :3000` | a manual `node server.js` still holds the port | `sudo fuser -k 3000/tcp` then restart the service |
| Funnel URL 404/error, `tailscale funnel status` empty | Funnel not enabled for the node | add `funnel` nodeAttr + enable MagicDNS/HTTPS in admin console |
| Rate limits don't seem per-client | real IP not recovered behind Funnel | confirm `X-Forwarded-For` in nginx access log; `real_ip` directives in §3 handle it |
| Game unreachable after reboot | service not enabled | `sudo systemctl enable pixel-tank` |

Handy commands:

```bash
systemctl status pixel-tank
journalctl -u pixel-tank -f
sudo tailscale funnel status
sudo tailscale status
ss -ltnp | grep -E ':(3000|8080)\b'
sudo nginx -t
sudo tail -f /var/log/nginx/access.log
```

---

## 8. Maintenance

- **Deploy code changes:** `npm run deploy` (restarts the service + reloads nginx; no UFW/htpasswd side effects)
- **Restart after code changes:** `sudo systemctl restart pixel-tank`
- **Reload nginx after vhost edits:** `sudo nginx -t && sudo systemctl reload nginx`
- **Add/remove logins:** `sudo htpasswd /etc/nginx/.htpasswd-pixel <user>` / `sudo htpasswd -D ...`
- **Stop public access:** `sudo tailscale funnel --bg=off` (or `tailscale funnel reset`); LAN access keeps working.
- **Change the port:** set `PORT`/`HOST` in the systemd unit and update `proxy_pass` in the vhost.

---

## 9. Security notes

- **Keep real values out of the repo.** This document uses `<host>`, `<tailnet>`, `<user>`,
  `<host-lan-ip>` placeholders. Your actual tailnet name, Funnel URL, username and LAN IP
  are environment-identifying — don't commit them to a public repo.
- **Funnel is public.** The URL is the only secret-ish thing; basic auth is the real gate. Anyone with the URL + credentials can connect. The game itself has no in-app auth.
- **Nothing is opened to `Anywhere` in UFW.** The public path is HTTPS 443 handled by Tailscale; nginx stays on loopback.
- **Rate limiting** (`limit_req`/`limit_conn`) reduces abuse; `MAX_PLAYERS = 4` caps concurrent players.
- **Credentials are sent in plaintext over LAN HTTP** (`:3000` direct). Over the Funnel URL it's HTTPS. Don't reuse a sensitive password.
- For tailnet-only access instead of public Funnel, use `sudo tailscale serve --bg 8080` and have friends install Tailscale.

---

## Files

All config lives in `deploy/`:

```
deploy/setup-nginx-ufw.sh    one-shot installer (nginx + systemd + UFW)
deploy/redeploy.sh           restart service + reload nginx (code changes)
deploy/pixel-tank.nginx      game vhost (auth + limits + WS proxy)
deploy/game-limits.conf      nginx limit zones
deploy/api-gateway.patched   port-80 vhost with WebSocket headers
deploy/pixel-tank.service    systemd unit
```

For code changes (`server.js`, `deploy/*.nginx`, `deploy/*.service`) use the lightweight redeploy:

```bash
npm run deploy                 # restart + nginx -t + reload
npm run deploy -- --no-nginx   # restart only
```

Editing `public/index.html` needs no restart — it's served from disk, just reload the browser.

Re-run the full installer only for first-time host setup or infra changes (nginx vhosts, systemd unit,
UFW, basic auth). It's idempotent-ish and backs up the api-gateway vhost:

```bash
sudo bash deploy/setup-nginx-ufw.sh
```
