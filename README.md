# Pixel Tank Duel

A top-down 2D local multiplayer tank shooter for 2-4 players. One device hosts the game over local Wi-Fi; everyone else joins from a browser (phone, laptop, tablet) — no internet required.

## Screenshots

| Starting screen | Gameplay |
| --- | --- |
| ![Starting screen](assets/starting-screen.png) | ![Gameplay](assets/pixel-tank-duel-gameplay.png) |

| Armory | Power-ups |
| --- | --- |
| ![Armory](assets/armory.png) | ![Power-ups](assets/power-ups.png) |

## How it works

- One player runs the server on their machine and it acts as the host.
- Everyone else connects to the host's local IP address over the same Wi-Fi network.
- The server is authoritative: it runs the game loop (movement, shooting, collisions, round timer) at 60 updates/sec and broadcasts state to every connected browser over WebSockets.

## Gameplay

- Move with `WASD` / arrow keys (or the on-screen joystick); fire with `Space` (or the FIRE button). Optional independent aim via **Controls → Aim**.
- Customize your tank from the **Armory** (**Customize** button or `G`).
- Trash talk with `1`–`7` emotes or `T`/Enter to type; hold `Tab` for the scoreboard.
- Each round opens with a 3-2-1 countdown and 1.2 s spawn protection. Tanks have **3 HP**.
- Last tank standing wins; on the 60 s timer, most kills wins; a tie goes to sudden death.
- The match is **first to 3 round wins**. Max 4 players per game.

Full controls, maps, power-ups, bullets/collisions and feedback: **[docs/GAMEPLAY.md](docs/GAMEPLAY.md)**.

## Rooms

One server hosts many independent games at once. Each game lives in a **room** with a 4-letter code and its own arena, rounds and players — rooms never see each other.

- Open the site with no code and the server mints a room for you; the URL updates to `?room=CODE`.
- Share that link (or the code) — friends land straight in your game. Join a specific code from **Armory → Room**, or by URL: `http://HOST:3000/?room=CODE`.
- Each room holds up to **4 players**. When it's full, new arrivals are told to pick another code.
- Progress is **not** per-room: your bolts, cosmetics and streaks follow your device everywhere.

## Customize your tank

Before a match (and any time mid-game), open the **Armory**. Set a callsign (required, up to 4 characters), then pick a hull, turret, barrel length and color, and hit **Deploy** — you can't deploy until a callsign is entered. Your callsign shows above your tank and your design is saved in the browser and shared with everyone in the match over WebSockets. Parts are purely cosmetic — they don't change speed, hitbox or damage.

The Armory also has a **Controls** toggle: **Classic** (default) makes the turret point wherever you drive and keeps the touch FIRE button, while **Aim** gives you an independent turret (mouse on desktop, right aim-stick on touch).

## Systems

- **Bolt economy & The Forge** — earn ⚡ in battle, spend it on cosmetics and consumables. See **[docs/ECONOMY.md](docs/ECONOMY.md)**.
- **Haunts** — keep losing and your own browser fights back. See **[docs/HAUNTS.md](docs/HAUNTS.md)**.
- **Persistence** — progress is tied to a device token in `localStorage`, so there's no login. See **[docs/ECONOMY.md#persistence](docs/ECONOMY.md#persistence)**.

## Run it

```bash
npm install
npm start
```

Server starts on port 3000.

## Play over Wi-Fi

1. Start the server on the host machine (`npm start`).
2. Find the host machine's local IP address on the Wi-Fi network:
   - **Windows:** `ipconfig` → look for `IPv4 Address` (e.g. `192.168.1.15`)
   - **Mac/Linux:** `ifconfig` or `ip a` → look for `192.168.x.x`
3. On the host machine, open `http://localhost:3000`.
4. On every other device connected to the **same Wi-Fi**, open `http://YOUR_LOCAL_IP:3000` (e.g. `http://192.168.1.15:3000`).

The first player to connect gets a room code and their URL becomes `http://…/?room=CODE`. Share that exact link with everyone else — they'll join the same room. Up to 4 players per room; different codes run separate games on the same server.

All devices must be on the same local network — this does not work over the open internet without extra setup (see below).

## Deploying off the local network

This game needs a persistent Node process holding live game state in memory and pushing it over WebSockets at 60Hz — it is **not compatible with serverless platforms** (Vercel, Netlify Functions, etc.), which spin functions up per-request and don't keep in-memory state or long-lived sockets alive between calls.

If you want it reachable outside your LAN, deploy `server.js` to any host that runs a persistent Node process with WebSocket support, for example:

- Railway
- Render
- Fly.io
- Any VPS (DigitalOcean, Linode, etc.) running `npm start` behind a process manager (pm2, systemd)

The app has no other infra requirements — no database, no build step. Just `npm install && npm start`.

On a systemd host set up with `deploy/`, ship code changes with `npm run deploy` (restarts the service and reloads nginx). Editing `public/index.html` alone needs no restart — just reload the browser. See [HOSTING.md](HOSTING.md) for the full setup.

### Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | TCP port to listen on |
| `HOST` | `0.0.0.0` | Bind address (all interfaces) |
| `PTD_DEBUG` | unset | Test-only debug seam; any non-empty value enables `dbg_kill` ws messages. Useful for headless testing — leave unset in production |

```bash
PORT=8080 HOST=127.0.0.1 npm start
```

## Reaching it from outside the LAN

Home networks sit behind NAT, so the LAN URL only works on the same Wi-Fi. Two good options:

### Tailscale (recommended)

No port-forwarding, encrypted WireGuard overlay, works under CGNAT.

1. Host and friend both install [Tailscale](https://tailscale.com/download) and join the same tailnet.
2. Friend opens `http://<host-tailscale-ip>:3000` (or the MagicDNS name).
3. For friends who won't install a client, publish via Funnel: `sudo tailscale funnel --bg 3000` → `https://<host>.<tailnet>.ts.net`. **Funnel is public** — put auth in front (see nginx below).

### nginx in front (auth + rate limiting + WebSocket proxy)

Run the game on loopback and let nginx handle TLS, basic auth and limits:

```nginx
server {
    listen 127.0.0.1:8080;
    auth_basic "Armory";
    auth_basic_user_file /etc/nginx/.htpasswd-pixel;
    limit_req zone=game burst=15 nodelay;
    limit_conn perip 6;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```

The `Upgrade`/`Connection` headers are required for the game's WebSockets. Point Tailscale Funnel/Serve at nginx (`tailscale funnel --bg 8080`) instead of the game directly.

### Firewall

Only open the port you actually need, scoped to your subnet — never `Anywhere`:

```bash
sudo ufw allow from 192.168.0.0/24 to any port 3000 proto tcp
```

See **[HOSTING.md](HOSTING.md)** for the full production setup used on this machine
(systemd service, nginx auth/rate-limiting/WebSocket proxy, UFW, Tailscale Funnel),
including the `deploy/` installer and troubleshooting.

## Project structure

```
server.js          Server wiring: HTTP/static + WebSocket + room dispatch
lib/               Game modules (config, catalog, design, bank, room, rooms)
public/index.html  Client: canvas renderer, input handling, HUD
data/              Persisted player banks (players.json, auto-created)
docs/              Gameplay, economy and haunt documentation
assets/            README screenshots
deploy/            systemd + nginx + UFW + Tailscale setup (see HOSTING.md)
```
