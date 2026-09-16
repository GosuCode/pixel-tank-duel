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

- Move & aim: WASD / Arrow keys (desktop) or the on-screen joystick (touch) — by default the turret points where you drive
- Independent aim (optional): switch **Controls → Aim** in the Armory to aim with the mouse (desktop) or the right stick (touch)
- Fire: Spacebar (desktop) or the FIRE button / right stick (touch)
- Customize tank: Customize button or G key
- Trash talk: number keys `1`–`7` for preset emotes, `T` (or Enter) to type a message — or tap the on-screen emote/TALK buttons on touch
- Scoreboard: hold `Tab` (wins, kills, deaths, damage, accuracy)
- Bullets are destroyed when they hit a wall/obstacle — they do not bounce unless you have the Ricochet power-up (see below)
- Normal bullets have a fixed range (~400px) and fizzle out mid-air; Ricochet and Laser shots are exempt
- Tanks are solid to each other and slide around one another instead of overlapping (walls too)
- Three arena maps (Crossroads, Bunkers, Bastion) — one is picked at random each round, never twice in a row
- Each round starts with a 3-2-1 countdown and brief spawn protection (drops the moment you fire)
- Last tank standing wins the round; if the 60s timer runs out, most kills wins
- Tanks have **3 HP** (shown as a segmented bar above each tank) — three hits destroy one; a hit flashes the tank white
- Hit feedback: landing a shot shows a hitmarker and a hit sound, taking one flashes a red vignette with a low thud and a brief screen shake, and floating `-1`/`BLOCK` numbers mark the impact
- Destroyed tanks erupt in a debris burst with a synthesized boom at the spot they died
- Tied on the clock? **Sudden death**: everyone drops to 1 HP and the next kill wins
- Rounds auto-restart a few seconds after ending; the **match is first to 3 round wins**, then the series resets
- Max 4 players per game

## Customize your tank

Before a match (and any time mid-game), open the **Armory** with the button or the **G** key. Set a callsign (required, up to 4 characters), then pick a hull, turret, barrel length and color, and hit **Deploy** — you can't deploy until a callsign is entered. Your callsign shows above your tank and your design is saved in the browser and shared with everyone in the match over WebSockets. Parts are purely cosmetic — they don't change speed, hitbox or damage.

The Armory also has a **Controls** toggle: **Classic** (default) makes the turret point wherever you drive and keeps the touch FIRE button, while **Aim** gives you an independent turret (mouse on desktop, right aim-stick on touch).

## Power-ups

Powerups spawn on a fixed clock at fixed spots on each map (first at ~8s, then every ~9s), cycling through every type in a fixed order. The next spawn is announced with a pulsing marker and countdown, so it's a contested objective rather than a lottery. Drive over one to grab an 8-second buff:

| Power | Icon | Effect |
| --- | --- | --- |
| Speed Boost | S (cyan) | Move speed up ~70% |
| Rapid Fire | F (orange) | Fire cooldown cut way down |
| Triple Shot | T (purple) | Fires a 3-bullet spread instead of 1 |
| Ricochet | R (yellow) | Bullets survive 3 wall bounces instead of being destroyed on impact — rendered as bigger gold bullets, and not subject to the normal bullet range limit |
| Energy Shield | B (blue) | Absorbs the next bullet hit (including ricochets/spread shots), then shatters |
| Laser | L (red) | Fires a fast beam that pierces walls and every tank in its path, hitting each enemy once (never its owner). Each wall it passes through keeps a permanent hole for the rest of the round — normal bullets can fly through the holes, but tanks are still blocked |

Your active buff shows as a badge above your tank and a countdown chip in the HUD.

## Trash talk

Every tank can talk smack. A message pops up in a speech bubble above the sender, wobbles for a moment, and plays a synthesized sound (no audio files — generated with the Web Audio API).

- **Emotes:** number keys `1`–`7` (`GG`, `REKT`, `NICE!`, `LOL`, `EZ`, `OOPS`, `HeHeHe...`), or tap the emote buttons on the touch bar. Each emote has its own tune.
- **Free text:** press `T` (or Enter) to open the chat bar, type up to 40 characters and hit Enter. On phones, tap **TALK**.
- Messages are sanitized server-side (control characters stripped, length capped, a light profanity filter applied) and rate-limited to one taunt per ~1.2s, so a hacked client can't spam or inject. Bubbles fade out after ~3s and clear at the start of each round.

## Bolt economy & The Forge

Earn ⚡ by fighting:

| Action | Bolts |
| --- | --- |
| Kill | +3 |
| First blood (first kill of a round) | +2 bonus |
| Round win | +5 |
| Match win (first to 3) | +15 |
| Accuracy ≥60% (round end) | +2 |
| Survival — zero deaths that round | +3 |
| Streak bonus (consecutive kills) | +1 per kill, up to +3/kill |

Lose ⚡ by dying:

| Event | Bolts |
| --- | --- |
| Death | −2 |
| Round loss | −3 |
| Match loss | −8 |
| Rage quit (mid-round disconnect) | −15 (also clears streak) |

**The Forge** (press **F** or tap ⚡ in the Garage) — spend earned bolts on cosmetic and consumable upgrades:

| Category | Item | Cost |
| --- | --- | --- |
| Skin | Neon Chrome | 100 |
| Skin | Ghost | 80 |
| Skin | Ember | 120 |
| Trail | Fire Trail | 60 |
| Trail | Rainbow | 90 |
| Trail | Spark | 50 |
| Trail | Smoke | 40 |
| Boom | Confetti | 70 |
| Boom | Skull | 90 |
| Boom | Comets | 110 |
| Spawn | Teleport | 50 |
| Spawn | Skydrop | 60 |
| Spawn | Smoke Puff | 40 |
| Consumable | Map Vote | 15 (choose the next map) |
| Consumable | Haunt Shield | 20 (blocks the next haunt) |

Consumables are one-at-a-time: buy, use, then buy again.

**Streak skins** unlock automatically at win thresholds and are equipped over any chosen skin:

| Wins | Skin | Look |
| --- | --- | --- |
| 3 | Scarred | paint scratches |
| 5 | Golden | metallic gold accent |
| 10 | Phantom | semi-transparent ghost |
| 25 | Titanium | silver + dark glass + spinning bolt badge |

## Haunt system

Losing stacks haunt levels (1–5), cleared on a round win or a kill. Effects are **self-inflicted and client-side only** — no network spam, no impact on other players.

| Level | Cumulative losses | Effect |
| --- | --- | --- |
| 1 | 1 | Title taunts ("REKT", "GIT GUD"…) |
| 2 | 3 | Random beeps + 3 s screen blur |
| 3 | 5 | Browser window shrinks + lateral controls scramble for 10 s |
| 4 | 7 | Notification spam ×4 + screen inversion for 3 s |
| 5 | 9 | All above + webcam request |

Buy a **Haunt Shield** in The Forge (20 ⚡) to block the next haunt. Win a round or land a kill to clear your streak.

## Persistence

All bolt balances, owned cosmetics, win/loss records and streaks are stored server-side at `data/players.json` (auto-created on first use, one entry per callsign). Data survives server restarts.

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
server.js          Authoritative game server (Express + ws)
public/index.html  Client: canvas renderer, input handling, HUD
data/              Persisted player banks (players.json, auto-created)
assets/            README screenshots
deploy/            systemd + nginx + UFW + Tailscale setup (see HOSTING.md)
```
