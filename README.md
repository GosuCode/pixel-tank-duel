# Pixel Tank Duel

A top-down 2D local multiplayer tank shooter for 2-4 players. One device hosts the game over local Wi-Fi; everyone else joins from a browser (phone, laptop, tablet) — no internet required.

## How it works

- One player runs the server on their machine and it acts as the host.
- Everyone else connects to the host's local IP address over the same Wi-Fi network.
- The server is authoritative: it runs the game loop (movement, shooting, collisions, round timer) at 60 updates/sec and broadcasts state to every connected browser over WebSockets.

## Gameplay

- Move: WASD / Arrow keys (desktop) or the on-screen joystick (touch)
- Fire: Spacebar (desktop) or the FIRE button (touch)
- Bullets bounce off walls/obstacles once before being destroyed on the second hit (more with the Ricochet power-up — see below)
- Last tank standing wins the round; if the 60s timer runs out, most kills wins
- Rounds auto-restart a few seconds after ending
- Max 4 players per game

## Power-ups

A pickup randomly spawns on the arena (one at a time, respawns ~12s after being taken). Drive over it to grab an 8-second buff:

| Power | Icon | Effect |
| --- | --- | --- |
| Speed Boost | S (cyan) | Move speed up ~70% |
| Rapid Fire | F (orange) | Fire cooldown cut way down |
| Triple Shot | T (purple) | Fires a 3-bullet spread instead of 1 |
| Ricochet | R (yellow) | Bullets survive 3 wall bounces instead of 1 — rendered as bigger gold bullets |
| Energy Shield | B (blue) | Absorbs the next bullet hit (including ricochets/spread shots), then shatters |

Your active buff shows as a badge above your tank and a countdown chip in the HUD.

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

The app has no other infra requirements — no database, no build step. Just `npm install && npm start` on port 3000 (or whatever `PORT` env var the host provides — see note below).

### Note on PORT

`server.js` currently listens on a hardcoded port 3000. Most non-LAN hosts assign their own port via `process.env.PORT`. If you deploy off-LAN, change the last line of `server.js` from:

```js
server.listen(3000, '0.0.0.0', ...)
```

to:

```js
server.listen(process.env.PORT || 3000, '0.0.0.0', ...)
```

## Project structure

```
server.js          Authoritative game server (Express + ws)
public/index.html  Client: canvas renderer, input handling, HUD
```
