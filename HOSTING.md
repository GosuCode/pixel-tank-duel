# Hosting & Remote Access

How Pixel Tank Duel is hosted on this machine and made reachable from the internet
with **systemd + Cloudflare Tunnel** — no nginx, no port-forwarding, no static IP.

This document is the "how it was set up" companion to `README.md`. It covers the
exact commands and the gotchas.

---

## Architecture

```
                      public internet
                            │  HTTPS :443
                            ▼
              ┌──────────────────────────────┐
              │  Cloudflare edge             │
              │  game.<your-domain>          │  (TLS terminated by Cloudflare)
              └──────────────┬───────────────┘
                             │  tunnel (outbound-only from the host)
                             ▼
              ┌──────────────────────────────┐
              │  cloudflared                 │  dials out to Cloudflare;
              │  (systemd service)           │  no inbound port is ever opened
              └──────────────┬───────────────┘
                             │  http://localhost:3000  (HTTP + WebSocket)
                             ▼
              ┌──────────────────────────────┐
              │  Node game server (:3000)    │
              │  managed by systemd          │
              └──────────────────────────────┘

Same Wi-Fi (LAN):  http://<host-lan-ip>:3000  ────────────────────┘  (no tunnel needed)
```

Why each layer:

- **Node server** — authoritative game state, WebSockets at 60 Hz. Needs a persistent process (not serverless).
- **systemd** — keeps the game running across crashes/reboots.
- **Cloudflare Tunnel** — the host makes an *outbound* connection to Cloudflare's edge, which
  publishes it at a public HTTPS hostname. No router port-forwarding, no static IP, no DDNS.
  WebSockets pass through tunnels natively, so no proxy headers to configure.

Example environment: Ubuntu/Pop!_OS. Replace `game.<your-domain>` and `<host-lan-ip>` with
your own values.

---

## 1. Application configuration

`server.js` reads two env vars:

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | listen port |
| `HOST` | `0.0.0.0` | bind address |

The game listens on `0.0.0.0:3000` so both LAN devices and `cloudflared` (loopback)
can reach it.

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

Install it:

```bash
sudo bash deploy/setup-systemd.sh
```

Or by hand:

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
> upgrading Node, re-run the installer and
> `sudo systemctl daemon-reload && sudo systemctl restart pixel-tank`.

---

## 3. Cloudflare Tunnel

Install `cloudflared` on the host (see Cloudflare's
[download page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
for the current instructions). On Debian/Ubuntu the `.deb` package is easiest:

```bash
# example: grab the latest .deb from Cloudflare's repo, then:
sudo dpkg -i cloudflared-linux-amd64.deb
cloudflared --version
```

You need a domain on Cloudflare (e.g. `<your-domain>`). The tunnel publishes a
hostname like `game.<your-domain>` that points at `http://localhost:3000`.

### Option A — Dashboard-managed (easiest)

1. In the Cloudflare **Zero Trust** dashboard: **Networks → Tunnels → Create a tunnel**.
   Choose **Cloudflared**, name it (e.g. `pixel-tank`), and save.
2. The dashboard shows an install command for the connector. Run it on the host:
   ```bash
   sudo cloudflared service install <TOKEN>
   ```
   This installs `cloudflared` as a systemd service that dials out to Cloudflare.
3. Back in the tunnel, open the **Public Hostname** tab → **Add a public hostname**:
   - **Subdomain:** `game`
   - **Domain:** `<your-domain>`
   - **Service:** `HTTP` → `localhost:3000`
   Save. Cloudflare creates the DNS record automatically.

Players then reach the game at `https://game.<your-domain>`.

### Option B — CLI-managed

```bash
cloudflared tunnel login                 # browser auth, writes ~/.cloudflared/cert.pem
cloudflared tunnel create pixel-tank     # writes ~/.cloudflared/<tunnel-id>.json
cloudflared tunnel route dns pixel-tank game.<your-domain>
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /home/<user>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: game.<your-domain>
    service: http://localhost:3000
  - service: http_status:404
```

Run it as a service (move the config to `/etc/cloudflared/config.yml` for a
root-owned service, or install with the user's config):

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

### Notes

- **WebSockets just work.** Point the service at `http://localhost:3000` — do not use `https://`.
- **Nothing listens on the internet at the host.** `cloudflared` connects *out* on 443/7844; there are no inbound ports to open and no UFW changes needed.

---

## 4. Verification

```bash
# game up?
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/          # 200

# tunnel connector running?
sudo systemctl status cloudflared
cloudflared tunnel list

# public hostname (expect 200)
curl -s -o /dev/null -w '%{http_code}\n' https://game.<your-domain>/     # 200

# LAN direct (if you want same-Wi-Fi play)
curl -s -o /dev/null -w '%{http_code}\n' http://<host-lan-ip>:3000/       # 200
```

Then load `https://game.<your-domain>` in a browser on mobile data and confirm tanks
move (the WebSocket path works end-to-end).

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| **502 / 1033** from the public URL | tunnel is up but the game isn't listening on `:3000` | `sudo systemctl start pixel-tank` (`systemctl status pixel-tank`) |
| Tunnel shows no healthy connections | `cloudflared` not running | `sudo systemctl restart cloudflared`; check `journalctl -u cloudflared -f` |
| Public hostname 404 / not resolving | public hostname route missing or DNS not created | re-add the hostname in the tunnel (or `cloudflared tunnel route dns …`) |
| WebSocket disconnects immediately | service set to `https://` or wrong port | set the route service to `http://localhost:3000` |
| `EADDRINUSE :3000` | a manual `node server.js` still holds the port | `sudo fuser -k 3000/tcp` then restart the service |
| Game unreachable after reboot | service not enabled | `sudo systemctl enable pixel-tank` (and `cloudflared`) |

Handy commands:

```bash
systemctl status pixel-tank
journalctl -u pixel-tank -f
systemctl status cloudflared
journalctl -u cloudflared -f
ss -ltnp | grep ':3000\b'
```

---

## 6. Maintenance

- **Deploy code changes:** `npm run deploy` (restarts the game service; no infra side effects)
- **Restart after code changes:** `sudo systemctl restart pixel-tank`
- **Restart the tunnel:** `sudo systemctl restart cloudflared`
- **Stop public access:** `sudo systemctl stop cloudflared` (LAN access keeps working) or remove the public hostname
- **Change the port:** set `PORT`/`HOST` in the systemd unit and update the tunnel route's service URL

Editing `public/index.html` needs no restart — it's served from disk, just reload the browser.

---

## 7. Security notes

- **The tunnel is public.** Anyone with the URL can connect; the game has no in-app auth.
  To restrict access, put **Cloudflare Access** (Zero Trust) in front of `game.<your-domain>`
  — require an email/OTP or a service token. Cloudflare's **rate-limiting rules** can blunt abuse.
- **Keep real values out of the repo.** Use `<your-domain>`, `<host-lan-ip>`, `<user>` placeholders.
  Your domain, tunnel ID and credentials file are environment-identifying — don't commit them.
- **No inbound ports.** `cloudflared` is outbound-only, so the host needs no firewall holes for
  the game. `MAX_PLAYERS = 4` caps concurrent players per room.
- **Credentials are sent in plaintext over LAN HTTP** (`:3000` direct). Over the tunnel it's HTTPS.
  Don't reuse a sensitive password for a LAN callsign.

---

## Files

```
deploy/setup-systemd.sh      one-shot installer (systemd service)
deploy/redeploy.sh           restart the service (code changes)
deploy/pixel-tank.service    systemd unit template
```

For code changes (`server.js`, `lib/`, `deploy/pixel-tank.service`) use the lightweight redeploy:

```bash
npm run deploy
```

Re-run the installer only for first-time host setup or when the Node path changes:

```bash
sudo bash deploy/setup-systemd.sh
```
