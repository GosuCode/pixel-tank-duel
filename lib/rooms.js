// Room registry: maps room codes to live rooms and drives them.
const { createRoom } = require('./room');

const rooms = new Map(); // code -> room
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike chars

function sanitizeRoomCode(v) {
  return typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) : '';
}

function makeRoomCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return rooms.has(c) ? makeRoomCode() : c;
}

// Join an existing room, or create one (minting a code when none was given).
function getOrCreateRoom(code) {
  let room = code ? rooms.get(code) : null;
  if (!room) {
    const finalCode = code || makeRoomCode();
    room = createRoom(finalCode);
    rooms.set(finalCode, room);
  }
  return room;
}

// One pass over every active room; empty rooms are reaped.
function tickRooms() {
  for (const [code, room] of rooms) {
    room.tick();
    if (room.isEmpty()) rooms.delete(code);
  }
}

module.exports = { sanitizeRoomCode, getOrCreateRoom, tickRooms };
