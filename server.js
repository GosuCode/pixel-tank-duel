// Server wiring only: HTTP/static + lobby API + WebSocket accept + room loop.
// Game logic lives in lib/ (config, catalog, design, bank, room, rooms).
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const { TICK_MS } = require('./lib/config');
const { sanitizeRoomCode, getRoom, createRoomWithVisibility, createSandboxRoom, listOpenRooms, totalPlayers, tickRooms } = require('./lib/rooms');
const bank = require('./lib/bank');
const { clientIp, makeLimiter } = require('./lib/ratelimit');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json({ limit: '16kb' })); // game payloads are tiny; cap the body
app.use(express.static('public'));

// ---- Rate limiting ----
// Keyed by the real client IP (see lib/ratelimit) so one abuser can't starve
// everyone behind the tunnel. Buckets are swept so the maps stay small.
const limitRoomCreate = makeLimiter(60, 10 * 60 * 1000);
const limitTransferStart = makeLimiter(30, 10 * 60 * 1000);
const limitTransferRedeem = makeLimiter(20, 10 * 60 * 1000);
const limiters = [limitRoomCreate, limitTransferStart, limitTransferRedeem];
setInterval(() => { for (const l of limiters) l.sweep(); }, 5 * 60 * 1000).unref();

// ---- Lobby API ----
app.get('/api/rooms', (req, res) => {
  res.json({ rooms: listOpenRooms(), totalPlayers: totalPlayers() });
});

app.post('/api/rooms', (req, res) => {
  if (limitRoomCreate(clientIp(req))) return res.status(429).json({ error: 'rate-limited' });
  const visibility = req.body && req.body.visibility === 'private' ? 'private' : 'open';
  const room = createRoomWithVisibility(visibility);
  if (!room) return res.status(503).json({ error: 'at-capacity' });
  res.json({ code: room.code, visibility: room.visibility });
});

// Dev playground: bots + debug controls.
app.post('/api/playground', (req, res) => {
  if (limitRoomCreate(clientIp(req))) return res.status(429).json({ error: 'rate-limited' });
  const room = createSandboxRoom();
  if (!room) return res.status(503).json({ error: 'at-capacity' });
  res.json({ code: room.code, sandbox: true });
});

// ---- Device linking ----
// A short-lived single-use code links a second device. The code alone cannot
// open an account: the new device is created pending and must be approved from
// an already-trusted device. Tokens and codes travel in the POST body, never
// the URL, so they don't land in access logs.
function tokenFrom(req) {
  return bank.sanitizeToken(req.body && req.body.token);
}

app.post('/api/transfer/start', (req, res) => {
  if (limitTransferStart(clientIp(req))) return res.status(429).json({ error: 'rate-limited' });
  const token = tokenFrom(req);
  if (!token) return res.status(400).json({ error: 'bad-token' });
  const out = bank.startTransfer(token);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.post('/api/transfer/redeem', (req, res) => {
  if (limitTransferRedeem(clientIp(req))) return res.status(429).json({ error: 'rate-limited' });
  const out = bank.redeemTransfer(req.body && req.body.code, req.body && req.body.label);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.post('/api/transfer/pending', (req, res) => {
  const token = tokenFrom(req);
  if (!token) return res.status(400).json({ error: 'bad-token' });
  const pending = bank.listPendingDevices(token);
  if (pending === null) return res.status(403).json({ error: 'unapproved' });
  res.json({ pending });
});

app.post('/api/transfer/approve', (req, res) => {
  const token = tokenFrom(req);
  if (!token) return res.status(400).json({ error: 'bad-token' });
  const out = bank.approveDevice(token, req.body && req.body.requestId);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.post('/api/transfer/deny', (req, res) => {
  const token = tokenFrom(req);
  if (!token) return res.status(400).json({ error: 'bad-token' });
  const out = bank.denyDevice(token, req.body && req.body.requestId);
  if (out.error) return res.status(400).json(out);
  res.json(out);
});

app.post('/api/transfer/status', (req, res) => {
  const token = tokenFrom(req);
  if (!token) return res.status(400).json({ error: 'bad-token' });
  res.json(bank.deviceStatus(token));
});

// ---- Game sockets ----
// A socket must target an existing room (?room=CODE); unknown codes are refused
// so a dead link sends the player back to the lobby instead of a ghost game.
wss.on('connection', (ws, req) => {
  let code = '';
  try {
    code = sanitizeRoomCode(new URL(req.url, 'http://localhost').searchParams.get('room'));
  } catch (e) {}
  const room = getRoom(code);
  if (!room) {
    ws.send(JSON.stringify({ type: 'notfound', roomCode: code }));
    ws.close();
    return;
  }
  room.join(ws);
});

setInterval(tickRooms, TICK_MS);

server.listen(PORT, HOST, () => {
  console.log(`Pixel Tank Duel running on ${HOST}:${PORT}!`);
});
