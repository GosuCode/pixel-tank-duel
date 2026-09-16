// Server wiring only: HTTP/static + WebSocket accept + room dispatch + loop.
// Game logic lives in lib/ (config, catalog, design, bank, room, rooms).
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const { TICK_MS } = require('./lib/config');
const { sanitizeRoomCode, getOrCreateRoom, tickRooms } = require('./lib/rooms');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));

// Pick a room for each connection (from ?room=CODE) or spin up a fresh one.
wss.on('connection', (ws, req) => {
  let code = '';
  try {
    code = sanitizeRoomCode(new URL(req.url, 'http://localhost').searchParams.get('room'));
  } catch (e) {}
  getOrCreateRoom(code).join(ws);
});

setInterval(tickRooms, TICK_MS);

server.listen(PORT, HOST, () => {
  console.log(`Pixel Tank Duel running on ${HOST}:${PORT}!`);
});
