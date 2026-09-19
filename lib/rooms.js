// Room registry: maps room codes to live rooms, lists open ones and drives them.
const { createRoom } = require('./room');
const { MAX_PLAYERS, MAX_ROOMS } = require('./config');

const rooms = new Map(); // code -> room
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike chars
const ROOM_GRACE_MS = 15000; // keep a fresh, still-empty room around long enough to connect

function sanitizeRoomCode(v) {
  return typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) : '';
}

function makeRoomCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return rooms.has(c) ? makeRoomCode() : c;
}

function getRoom(code) {
  return (code && rooms.get(code)) || null;
}

function roomCount() {
  return rooms.size;
}

// Create a room up front (the caller connects to it right after). Returns null
// once the global cap is hit so a flood cannot exhaust memory.
function createRoomWithVisibility(visibility) {
  if (rooms.size >= MAX_ROOMS) return null;
  const code = makeRoomCode();
  const room = createRoom(code, visibility === 'private' ? 'private' : 'open');
  rooms.set(code, room);
  return room;
}

// Dev playground: a private sandbox room stocked with AI bots and debug controls.
function createSandboxRoom() {
  if (rooms.size >= MAX_ROOMS) return null;
  const code = makeRoomCode();
  const room = createRoom(code, 'private', { sandbox: true });
  rooms.set(code, room);
  return room;
}

// Open rooms only — invite-only rooms are reachable solely by their code.
function listOpenRooms() {
  const out = [];
  for (const room of rooms.values()) {
    if (room.visibility !== 'open') continue;
    out.push({ code: room.code, players: room.playerCount(), max: MAX_PLAYERS, state: room.roundState() });
  }
  return out.sort((a, b) => b.players - a.players);
}

// Everyone connected across every room (bots are not sockets, so they don't count).
function totalPlayers() {
  let n = 0;
  for (const room of rooms.values()) n += room.playerCount();
  return n;
}

// One pass over every active room; stale empty rooms are reaped.
function tickRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    room.tick();
    if (room.isEmpty() && now - room.createdAt > ROOM_GRACE_MS) rooms.delete(code);
  }
}

module.exports = { sanitizeRoomCode, getRoom, createRoomWithVisibility, createSandboxRoom, listOpenRooms, totalPlayers, roomCount, tickRooms };
