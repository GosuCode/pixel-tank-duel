// Server wiring only: HTTP/static + lobby API + WebSocket accept + room loop.
// Game logic lives in lib/ (config, catalog, design, bank, room, rooms).
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const { TICK_MS } = require('./lib/config');
const { sanitizeRoomCode, getRoom, createRoomWithVisibility, listOpenRooms, tickRooms } = require('./lib/rooms');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static('public'));

// ---- Lobby API ----
app.get('/api/rooms', (req, res) => {
  res.json({ rooms: listOpenRooms() });
});

app.post('/api/rooms', (req, res) => {
  const visibility = req.body && req.body.visibility === 'private' ? 'private' : 'open';
  const room = createRoomWithVisibility(visibility);
  res.json({ code: room.code, visibility: room.visibility });
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
