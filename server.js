const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static('public'));

// ---- Config ----
const ARENA_W = 800;
const ARENA_H = 600;
const TANK_R = 16;
const BULLET_R = 4;
const BULLET_SPEED = 7;
const BULLET_MAX_DISTANCE = 400; // normal bullets fizzle out after this; ricochet/laser are exempt
const TANK_SPEED = 2.2;
const FIRE_COOLDOWN = 600;
const ROUND_TIME = 60000;
const RESTART_DELAY = 4000;
const MAX_PLAYERS = 4;
const TICK_MS = 1000 / 60;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const POWERUP_TYPES = ['speed', 'rapid', 'triple', 'ricochet', 'shield', 'laser'];
const POWERUP_R = 14;
const POWERUP_DURATION = 8000;
const POWERUP_RESPAWN = 12000;
const SPEED_MULT = 1.7;
const RAPID_COOLDOWN = 240;
const TRIPLE_SPREAD = 0.26; // radians, ~15 degrees
const RICOCHET_BOUNCES = 3;
const LASER_COOLDOWN = 900;
const LASER_SPEED = 14; // 2x bullet speed
const HOLE_R = 12; // radius of the tunnel a laser punches through a wall

const TAUNT_MAX_LEN = 40;
const TAUNT_COOLDOWN = 1200; // ms between a player's taunts
const TAUNT_DURATION = 3200; // ms a speech bubble stays up
const EXPLOSION_DURATION = 900; // ms a wreck stays in the state feed

// Kept deliberately short - this is a friends-on-the-LAN game, not a chat app.
const PROFANITY = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'pussy', 'fag', 'nigger', 'retard'];

const TANK_COLORS = [
  { id: 'red', hex: '#FF4136', name: 'Red' },
  { id: 'blue', hex: '#0074D9', name: 'Blue' },
  { id: 'green', hex: '#2ECC40', name: 'Green' },
  { id: 'yellow', hex: '#FFDC00', name: 'Yellow' },
  { id: 'orange', hex: '#FF851B', name: 'Orange' },
  { id: 'purple', hex: '#B10DC9', name: 'Purple' },
  { id: 'cyan', hex: '#7FDBFF', name: 'Cyan' },
  { id: 'pink', hex: '#F012BE', name: 'Pink' },
];

const TANK_PARTS = {
  hull: ['classic', 'wedge', 'round'],
  turret: ['square', 'round', 'dome'],
  barrel: ['short', 'medium', 'long'],
};

function defaultDesign(index, colorHex) {
  return {
    name: '',
    hull: 'classic',
    turret: 'square',
    barrel: 'medium',
    treads: 'treads',
    color: colorHex || TANK_COLORS[index % TANK_COLORS.length].hex,
  };
}

function sanitizeName(value, fallback) {
  const raw = typeof value === 'string' ? value : fallback;
  return raw.replace(/[^\w -]/g, '').trim().slice(0, 4);
}

function sanitizeTaunt(value) {
  let raw = typeof value === 'string' ? value : '';
  // strip control chars, collapse whitespace
  raw = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  for (const word of PROFANITY) {
    raw = raw.replace(new RegExp(`\\b${word}`, 'gi'), (m) => m[0] + '*'.repeat(m.length - 1));
  }
  return raw.slice(0, TAUNT_MAX_LEN);
}

function sanitizeDesign(input, fallback) {
  const d = input && typeof input === 'object' ? input : {};
  const design = {};
  for (const key of Object.keys(TANK_PARTS)) {
    design[key] = TANK_PARTS[key].includes(d[key]) ? d[key] : fallback[key];
  }
  design.color = TANK_COLORS.some((c) => c.hex === d.color) ? d.color : fallback.color;
  design.treads = 'treads';
  design.name = sanitizeName(d.name, fallback.name);
  return design;
}

function colorName(hex) {
  const c = TANK_COLORS.find((c) => c.hex === hex);
  return c ? c.name : 'Player';
}

function displayName(p) {
  return (p.design && p.design.name) || colorName(p.design.color);
}

const SPAWNS = [
  { x: 80, y: 80 },
  { x: ARENA_W - 80, y: ARENA_H - 80 },
  { x: ARENA_W - 80, y: 80 },
  { x: 80, y: ARENA_H - 80 },
];

// Three symmetric arena layouts. Each is 180-degree symmetric and keeps all
// pieces well clear of the 4 corner spawn points so nobody gets walled in.
// One is picked at random each round (never the same twice in a row).
const CX = ARENA_W / 2;
const CY = ARENA_H / 2;
const MAPS = [
  {
    name: 'Crossroads',
    // center cross breaks the diagonal sightline between opposite spawns,
    // plus 4 edge pillars that break the straight lanes.
    obstacles: [
      { x: CX - 100, y: CY - 10, w: 200, h: 20 },
      { x: CX - 10, y: CY - 110, w: 20, h: 80 },
      { x: CX - 10, y: CY + 30, w: 20, h: 80 },
      { x: CX - 10, y: 60, w: 20, h: 80 },
      { x: CX - 10, y: ARENA_H - 140, w: 20, h: 80 },
      { x: 60, y: CY - 10, w: 80, h: 20 },
      { x: ARENA_W - 140, y: CY - 10, w: 80, h: 20 },
    ],
  },
  {
    name: 'Bunkers',
    // solid center block with four offset bars for flanking cover.
    obstacles: [
      { x: CX - 40, y: CY - 40, w: 80, h: 80 },
      { x: CX - 180, y: CY - 130, w: 90, h: 20 },
      { x: CX + 90, y: CY - 130, w: 90, h: 20 },
      { x: CX - 180, y: CY + 110, w: 90, h: 20 },
      { x: CX + 90, y: CY + 110, w: 90, h: 20 },
    ],
  },
  {
    name: 'Bastion',
    // broken square ring around the center with gaps on all four sides.
    obstacles: [
      { x: CX - 140, y: CY - 160, w: 100, h: 20 },
      { x: CX + 40, y: CY - 160, w: 100, h: 20 },
      { x: CX - 140, y: CY + 140, w: 100, h: 20 },
      { x: CX + 40, y: CY + 140, w: 100, h: 20 },
      { x: CX - 140, y: CY - 90, w: 20, h: 60 },
      { x: CX - 140, y: CY + 30, w: 20, h: 60 },
      { x: CX + 120, y: CY - 90, w: 20, h: 60 },
      { x: CX + 120, y: CY + 30, w: 20, h: 60 },
    ],
  },
];

let mapIndex = 0;
let OBSTACLES = MAPS[mapIndex].obstacles;

const players = {}; // id -> { x,y,angle,design,alive,kills,lastShot,dx,dy,fire,buff }
let bullets = []; // { x,y,vx,vy,ownerId,bounces,bounceLimit,bornAt,hot,laser,hitIds }
let holes = []; // { x,y,r } permanent tunnels punched through walls by lasers (reset each round)
let explosions = []; // { id,x,y,color,at } wreck markers, pruned after EXPLOSION_DURATION
let explosionSeq = 0;

let round = { state: 'waiting', endAt: 0, winnerText: '' };
let powerup = null; // { x, y, type }
let nextPowerupAt = 0;

function circleRectCollide(cx, cy, r, rect) {
    const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy < r * r;
}

// Two tanks are solid to each other: a move that would put the tank's center
// within two radii of a live enemy is rejected. Checked per axis so tanks
// slide around each other instead of overlapping.
function tankBlocked(x, y, selfId) {
    const minDistSq = (TANK_R * 2) * (TANK_R * 2);
    for (const id in players) {
        if (id === selfId) continue;
        const other = players[id];
        if (!other.alive) continue;
        const dx = x - other.x;
        const dy = y - other.y;
        if (dx * dx + dy * dy < minDistSq) return true;
    }
    return false;
}

function pointInHole(x, y) {
  for (const h of holes) {
    const dx = x - h.x;
    const dy = y - h.y;
    if (dx * dx + dy * dy < h.r * h.r) return true;
  }
  return false;
}

function addHole(x, y) {
  // Skip if a hole already covers this spot so a beam carves a clean tunnel
  // instead of stacking hundreds of overlapping circles.
  const minDistSq = (HOLE_R * 0.75) * (HOLE_R * 0.75);
  for (const h of holes) {
    const dx = x - h.x;
    const dy = y - h.y;
    if (dx * dx + dy * dy < minDistSq) return;
  }
  holes.push({ x, y, r: HOLE_R });
}

function spawnPowerup() {
  const margin = 50;
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = margin + Math.random() * (ARENA_W - margin * 2);
    const y = margin + Math.random() * (ARENA_H - margin * 2);
    const blocked = OBSTACLES.some((o) => circleRectCollide(x, y, POWERUP_R + 10, o));
    if (!blocked) {
      powerup = { x, y, type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)] };
      return;
    }
  }
}

function nextSpawn(index) {
  return SPAWNS[index % SPAWNS.length];
}

function resetPlayerForRound(p, index) {
  const s = nextSpawn(index);
  p.x = s.x;
  p.y = s.y;
  p.angle = 0;
  p.alive = true;
  p.kills = 0;
  p.buff = null;
  p.taunt = null;
}

function broadcastMap() {
  const msg = JSON.stringify({ type: 'map', obstacles: OBSTACLES, name: MAPS[mapIndex].name });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

function startRound() {
  let idx = Math.floor(Math.random() * MAPS.length);
  if (MAPS.length > 1 && idx === mapIndex) idx = (idx + 1) % MAPS.length;
  mapIndex = idx;
  OBSTACLES = MAPS[mapIndex].obstacles;
  broadcastMap();

  const ids = Object.keys(players);
  ids.forEach((id, i) => resetPlayerForRound(players[id], i));
  bullets = [];
  holes = [];
  explosions = [];
  powerup = null;
  nextPowerupAt = Date.now() + 3000;
  round.state = 'active';
  round.endAt = Date.now() + ROUND_TIME;
  round.winnerText = '';
}

function endRound(winnerText) {
  round.state = 'ended';
  round.winnerText = winnerText;
  round.endsWaitingAt = Date.now() + RESTART_DELAY;
}

function maybeStartRound() {
  if (round.state === 'waiting' && Object.keys(players).length >= 2) {
    startRound();
  }
}

wss.on('connection', (ws) => {
  if (Object.keys(players).length >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  const id = Math.random().toString(36).substring(2, 9);
  const index = Object.keys(players).length;
  const spawn = nextSpawn(index);

  const usedColors = new Set(Object.values(players).map((p) => p.design.color));
  const freeColor = TANK_COLORS.find((c) => !usedColors.has(c.hex));
  const design = defaultDesign(index, freeColor && freeColor.hex);

  players[id] = {
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    design,
    alive: true,
    kills: 0,
    lastShot: 0,
    dx: 0,
    dy: 0,
    fire: false,
    buff: null,
    taunt: null,
    lastTaunt: 0,
  };

  ws.send(JSON.stringify({
    type: 'init',
    id,
    arena: { w: ARENA_W, h: ARENA_H },
    obstacles: OBSTACLES,
    mapName: MAPS[mapIndex].name,
    palette: TANK_COLORS,
    parts: TANK_PARTS,
  }));

  maybeStartRound();

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    const p = players[id];
    if (!p) return;
    if (data.type === 'input') {
      p.dx = typeof data.dx === 'number' ? Math.max(-1, Math.min(1, data.dx)) : 0;
      p.dy = typeof data.dy === 'number' ? Math.max(-1, Math.min(1, data.dy)) : 0;
      p.fire = !!data.fire;
    } else if (data.type === 'design') {
      p.design = sanitizeDesign(data.design, p.design);
    } else if (data.type === 'taunt') {
      const now = Date.now();
      if (now - p.lastTaunt >= TAUNT_COOLDOWN) {
        const text = sanitizeTaunt(data.text);
        if (text) {
          p.lastTaunt = now;
          p.taunt = { text, at: now };
        }
      }
    }
  });

  ws.on('close', () => {
    delete players[id];
    if (Object.keys(players).length < 2 && round.state === 'active') {
      round.state = 'waiting';
    }
  });
});

function tick() {
  const now = Date.now();

  // Power-up spawning + pickup (only during active rounds)
  if (round.state === 'active') {
    if (!powerup && now >= nextPowerupAt) spawnPowerup();

    if (powerup) {
      for (const id in players) {
        const p = players[id];
        if (!p.alive) continue;
        const dx = p.x - powerup.x;
        const dy = p.y - powerup.y;
        if (dx * dx + dy * dy < (TANK_R + POWERUP_R) * (TANK_R + POWERUP_R)) {
          p.buff = { type: powerup.type, expiresAt: now + POWERUP_DURATION };
          powerup = null;
          nextPowerupAt = now + POWERUP_RESPAWN;
          break;
        }
      }
    }
  }

  // Movement + firing
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;
    if (!p.design.name) continue; // a callsign is required before you can play

    if (p.buff && now >= p.buff.expiresAt) p.buff = null;
    const buffType = p.buff ? p.buff.type : null;

    if (p.dx !== 0 || p.dy !== 0) {
      const len = Math.hypot(p.dx, p.dy) || 1;
      const nx = p.dx / len;
      const ny = p.dy / len;
      p.angle = Math.atan2(ny, nx);

      const speed = buffType === 'speed' ? TANK_SPEED * SPEED_MULT : TANK_SPEED;
      let newX = p.x + nx * speed;
      let newY = p.y + ny * speed;
      newX = Math.max(TANK_R, Math.min(ARENA_W - TANK_R, newX));
      newY = Math.max(TANK_R, Math.min(ARENA_H - TANK_R, newY));

      // Resolve each axis separately so a tank pressed into a wall or another
      // tank slides along it instead of jamming. Y uses the updated X.
      if (!OBSTACLES.some((o) => circleRectCollide(newX, p.y, TANK_R, o)) && !tankBlocked(newX, p.y, id)) p.x = newX;
      if (!OBSTACLES.some((o) => circleRectCollide(p.x, newY, TANK_R, o)) && !tankBlocked(p.x, newY, id)) p.y = newY;
    }

    const cooldown = buffType === 'laser' ? LASER_COOLDOWN : buffType === 'rapid' ? RAPID_COOLDOWN : FIRE_COOLDOWN;
    if (p.fire && round.state === 'active' && now - p.lastShot > cooldown) {
      p.lastShot = now;
      const isLaser = buffType === 'laser';
      const angles = buffType === 'triple' ? [p.angle - TRIPLE_SPREAD, p.angle, p.angle + TRIPLE_SPREAD] : [p.angle];
      const bounceLimit = buffType === 'ricochet' ? RICOCHET_BOUNCES : 0;
      const speed = isLaser ? LASER_SPEED : BULLET_SPEED;
      for (const angle of angles) {
        const bx = p.x + Math.cos(angle) * (TANK_R + BULLET_R + 2);
        const by = p.y + Math.sin(angle) * (TANK_R + BULLET_R + 2);
        // Don't spawn a bullet already inside a wall (point-blank into cover) - it
        // would immediately bounce back into the shooter and self-kill them.
        if (bx < BULLET_R || bx > ARENA_W - BULLET_R || by < BULLET_R || by > ARENA_H - BULLET_R) continue;
        if (OBSTACLES.some((o) => circleRectCollide(bx, by, BULLET_R, o))) continue;
        bullets.push({
          x: bx,
          y: by,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          ownerId: id,
          bounces: 0,
          bounceLimit: isLaser ? 0 : bounceLimit,
          hot: isLaser || bounceLimit > 1,
          laser: isLaser,
          hitIds: [],
          bornAt: now,
          startX: bx,
          startY: by,
        });
      }
    }
  }

  // Bullets
  if (round.state === 'active') {
    bullets = bullets.filter((b) => {
      b.x += b.vx;
      b.y += b.vy;

      // Normal bullets have a fixed range; ricochet and laser are exempt.
      if (!b.laser && b.bounceLimit === 0) {
        const ddx = b.x - b.startX;
        const ddy = b.y - b.startY;
        if (ddx * ddx + ddy * ddy > BULLET_MAX_DISTANCE * BULLET_MAX_DISTANCE) return false;
      }

      // A laser leaves the arena instead of bouncing off its edges.
      if (b.laser) {
        if (b.x < -BULLET_R || b.x > ARENA_W + BULLET_R || b.y < -BULLET_R || b.y > ARENA_H + BULLET_R) {
          return false;
        }
      }

      let bounced = false;
      if (!b.laser) {
        if (b.x < BULLET_R || b.x > ARENA_W - BULLET_R) {
          b.vx *= -1;
          b.x = Math.max(BULLET_R, Math.min(ARENA_W - BULLET_R, b.x));
          bounced = true;
        }
        if (b.y < BULLET_R || b.y > ARENA_H - BULLET_R) {
          b.vy *= -1;
          b.y = Math.max(BULLET_R, Math.min(ARENA_H - BULLET_R, b.y));
          bounced = true;
        }
      }

      // Bullets (not lasers) slip straight through a hole punched in a wall.
      const inHole = pointInHole(b.x, b.y);
      for (const o of OBSTACLES) {
        if (circleRectCollide(b.x, b.y, BULLET_R, o)) {
          if (b.laser) {
            addHole(b.x, b.y); // punch through and keep going
            continue;
          }
          if (inHole) continue;
          const overlapL = Math.abs(b.x - o.x);
          const overlapR = Math.abs(b.x - (o.x + o.w));
          const overlapT = Math.abs(b.y - o.y);
          const overlapB = Math.abs(b.y - (o.y + o.h));
          const minOverlap = Math.min(overlapL, overlapR, overlapT, overlapB);
          if (minOverlap === overlapL || minOverlap === overlapR) b.vx *= -1;
          else b.vy *= -1;
          bounced = true;
          break;
        }
      }

      if (bounced) {
        b.bounces++;
        if (b.bounces > b.bounceLimit) return false;
      }

      // hit check (ignore owner for first 120ms so you don't insta-kill yourself)
      for (const id in players) {
        const target = players[id];
        if (!target.alive) continue;
        if (b.laser) {
          if (id === b.ownerId) continue; // a laser never hurts its own tank
          if (b.hitIds.includes(id)) continue; // only damage each tank once per beam
        } else if (id === b.ownerId && now - b.bornAt < 120) {
          continue;
        }
        const dx = target.x - b.x;
        const dy = target.y - b.y;
        if (dx * dx + dy * dy < (TANK_R + BULLET_R) * (TANK_R + BULLET_R)) {
          if (target.buff && target.buff.type === 'shield') {
            target.buff = null; // shield absorbs the hit and shatters
          } else {
            target.alive = false;
            explosions.push({
              id: ++explosionSeq,
              x: target.x,
              y: target.y,
              color: target.design.color,
              at: now,
            });
            if (players[b.ownerId] && b.ownerId !== id) players[b.ownerId].kills++;
          }
          if (b.laser) {
            b.hitIds.push(id); // pierce through and keep going
            continue;
          }
          return false;
        }
      }

      return true;
    });

    const alive = Object.values(players).filter((p) => p.alive);
    const total = Object.keys(players).length;
    if (total >= 2 && alive.length <= 1) {
      const winner = alive[0];
      endRound(winner ? `${displayName(winner)} wins!` : 'Draw!');
    } else if (now >= round.endAt) {
      const maxKills = Math.max(...Object.values(players).map((p) => p.kills), 0);
      const leaders = Object.values(players).filter((p) => p.kills === maxKills && maxKills > 0);
      endRound(leaders.length === 1 ? `${displayName(leaders[0])} wins on kills!` : "Time's up! Draw!");
    }
  } else if (round.state === 'ended') {
    if (now >= round.endsWaitingAt) {
      round.state = 'waiting';
      maybeStartRound();
    }
  }

  explosions = explosions.filter((e) => now - e.at < EXPLOSION_DURATION);

  const playersOut = {};
  for (const id in players) {
    const p = players[id];
    playersOut[id] = {
      x: p.x,
      y: p.y,
      angle: p.angle,
      design: p.design,
      alive: p.alive,
      kills: p.kills,
      buff: p.buff ? { type: p.buff.type, timeLeft: Math.max(0, p.buff.expiresAt - now) } : null,
      taunt: p.taunt && p.taunt.at + TAUNT_DURATION > now ? p.taunt : null,
    };
  }

  const state = JSON.stringify({
    type: 'state',
    players: playersOut,
    bullets: bullets.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, hot: b.hot, laser: !!b.laser })),
    holes: holes.map((h) => ({ x: h.x, y: h.y, r: h.r })),
    explosions: explosions.map((e) => ({ id: e.id, x: e.x, y: e.y, color: e.color })),
    powerup: powerup ? { x: powerup.x, y: powerup.y, type: powerup.type } : null,
    round: {
      state: round.state,
      timeLeft: round.state === 'active' ? Math.max(0, round.endAt - now) : 0,
      winnerText: round.winnerText,
    },
  });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(state);
  });
}

setInterval(tick, TICK_MS);

server.listen(PORT, HOST, () => {
  console.log(`Pixel Tank Duel running on ${HOST}:${PORT}!`);
});
