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
const MAX_HP = 3; // shots to destroy a tank
const FIRE_COOLDOWN = 600;
const ROUND_TIME = 60000;
const RESTART_DELAY = 4000;
const MATCH_END_DELAY = 9000; // longer pause after the match is decided
const MATCH_TARGET_WINS = 3; // first to this many round wins takes the match
const COUNTDOWN_MS = 3000; // freeze before a round goes live
const SPAWN_PROTECT_MS = 1200; // no damage at round start, dropped early if you fire
const SUDDEN_TIME = 15000; // sudden-death window
const SUDDEN_HP = 1; // everyone drops to this in sudden death
const MAX_PLAYERS = 4;
const TICK_MS = 1000 / 60;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const POWERUP_TYPES = ['speed', 'rapid', 'triple', 'ricochet', 'shield', 'laser'];
const POWERUP_R = 14;
const POWERUP_DURATION = 8000;
const POWERUP_FIRST_AT = 8000; // first spawn after the round goes live
const POWERUP_INTERVAL = 16000; // then one every interval, fixed spots/types
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
    powerupSpots: [
      { x: 200, y: 150 }, { x: 600, y: 150 }, { x: 600, y: 450 }, { x: 200, y: 450 },
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
    powerupSpots: [
      { x: 170, y: 150 }, { x: 630, y: 150 }, { x: 630, y: 450 }, { x: 170, y: 450 },
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
    powerupSpots: [
      { x: 180, y: 300 }, { x: 620, y: 300 }, { x: 400, y: 120 }, { x: 400, y: 480 },
    ],
  },
];

let mapIndex = 0;
let OBSTACLES = MAPS[mapIndex].obstacles;
let POWERUP_SPOTS = MAPS[mapIndex].powerupSpots;

const players = {}; // id -> { x,y,angle,design,alive,kills,hp,buff,matchWins,stats,... }
let bullets = []; // { x,y,vx,vy,ownerId,bounces,bounceLimit,bornAt,hot,laser,hitIds }
let holes = []; // { x,y,r } permanent tunnels punched through walls by lasers (reset each round)
let explosions = []; // { id,x,y,color,at } wreck markers, pruned after EXPLOSION_DURATION
let explosionSeq = 0;

let round = {
  state: 'waiting', // waiting | countdown | active | sudden | ended
  endAt: 0,
  winnerText: '',
  winnerId: null,
  endsWaitingAt: 0,
  countdownEndAt: 0,
  powerupPlan: [],
  powerupIndex: 0,
};
let match = { targetWins: MATCH_TARGET_WINS, roundNumber: 0, over: false, winnerText: '' };
let powerup = null; // { x, y, type }

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

// Powerups are a contested objective, not a lottery: fixed per-map spots and a
// fixed type order on a fixed clock, so the plan is identical every round.
function buildPowerupPlan(startAt) {
  const plan = [];
  for (let i = 0; i < 4; i++) {
    const spot = POWERUP_SPOTS[i % POWERUP_SPOTS.length];
    plan.push({
      at: startAt + POWERUP_FIRST_AT + i * POWERUP_INTERVAL,
      x: spot.x,
      y: spot.y,
      type: POWERUP_TYPES[i % POWERUP_TYPES.length],
    });
  }
  return plan;
}

function nextSpawn(index) {
  return SPAWNS[index % SPAWNS.length];
}

function resetPlayerForRound(p, index) {
  const s = nextSpawn(index);
  p.x = s.x;
  p.y = s.y;
  p.angle = 0;
  p.aim = 0;
  p.alive = true;
  p.kills = 0;
  p.buff = null;
  p.taunt = null;
  p.hp = MAX_HP;
  p.lastHitAt = 0;
  p.spawnProtectedUntil = 0;
  p.dx = 0;
  p.dy = 0;
  p.fire = false;
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
  POWERUP_SPOTS = MAPS[mapIndex].powerupSpots;
  broadcastMap();

  const ids = Object.keys(players);
  ids.forEach((id, i) => resetPlayerForRound(players[id], i));
  bullets = [];
  holes = [];
  explosions = [];
  powerup = null;

  const now = Date.now();
  round.countdownEndAt = now + COUNTDOWN_MS;
  round.powerupPlan = buildPowerupPlan(round.countdownEndAt);
  round.powerupIndex = 0;
  round.state = 'countdown';
  round.endAt = 0;
  round.winnerText = '';
  round.winnerId = null;
}

function beginActiveRound(now) {
  round.state = 'active';
  round.endAt = now + ROUND_TIME;
  for (const id in players) players[id].spawnProtectedUntil = now + SPAWN_PROTECT_MS;
}

function endRound(winnerId, winnerText) {
  const now = Date.now();
  round.state = 'ended';
  round.winnerId = winnerId || null;
  round.winnerText = winnerText;
  match.roundNumber += 1;
  const winner = winnerId ? players[winnerId] : null;
  if (winner) {
    winner.matchWins += 1;
    if (winner.matchWins >= match.targetWins) {
      match.over = true;
      match.winnerText = `${displayName(winner)} wins the match!`;
    }
  }
  round.endsWaitingAt = now + (match.over ? MATCH_END_DELAY : RESTART_DELAY);
}

function resetMatch() {
  match = { targetWins: MATCH_TARGET_WINS, roundNumber: 0, over: false, winnerText: '' };
  for (const id in players) players[id].matchWins = 0;
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
    aim: 0,
    aimControlled: false,
    design,
    alive: true,
    kills: 0,
    hp: MAX_HP,
    lastHitAt: 0,
    spawnProtectedUntil: 0,
    lastShot: 0,
    dx: 0,
    dy: 0,
    fire: false,
    buff: null,
    taunt: null,
    lastTaunt: 0,
    matchWins: 0,
    deaths: 0,
    damage: 0,
    shots: 0,
    hits: 0,
    powerups: 0,
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

  // joining mid-round: grant the same spawn protection so you can't be sniped on entry
  if (round.state === 'active' || round.state === 'sudden') {
    players[id].spawnProtectedUntil = Date.now() + SPAWN_PROTECT_MS;
  }

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
      // Independent aim (radians). Omitted by classic clients, who fall back to
      // aiming along their movement direction.
      p.aimControlled = typeof data.aim === 'number' && Number.isFinite(data.aim);
      if (p.aimControlled) p.aim = data.aim;
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
    const inPlayStates = round.state === 'countdown' || round.state === 'active' || round.state === 'sudden';
    if (Object.keys(players).length < 2 && inPlayStates) {
      round.state = 'waiting';
    }
  });
});

function tick() {
  const now = Date.now();

  // Countdown -> live
  if (round.state === 'countdown' && now >= round.countdownEndAt) {
    beginActiveRound(now);
  }

  const inPlay = round.state === 'active' || round.state === 'sudden';

  // Deterministic powerup schedule + pickup (active only)
  if (round.state === 'active') {
    while (round.powerupIndex < round.powerupPlan.length && now >= round.powerupPlan[round.powerupIndex].at) {
      const s = round.powerupPlan[round.powerupIndex];
      powerup = { x: s.x, y: s.y, type: s.type };
      round.powerupIndex++;
    }
    if (powerup) {
      for (const id in players) {
        const p = players[id];
        if (!p.alive) continue;
        const dx = p.x - powerup.x;
        const dy = p.y - powerup.y;
        if (dx * dx + dy * dy < (TANK_R + POWERUP_R) * (TANK_R + POWERUP_R)) {
          p.buff = { type: powerup.type, expiresAt: now + POWERUP_DURATION };
          p.powerups++;
          powerup = null;
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

    const frozen = round.state === 'countdown';
    if (!frozen && (p.dx !== 0 || p.dy !== 0)) {
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

    // Classic control: the turret points wherever you drive.
    if (!p.aimControlled) p.aim = p.angle;

    const cooldown = buffType === 'laser' ? LASER_COOLDOWN : buffType === 'rapid' ? RAPID_COOLDOWN : FIRE_COOLDOWN;
    if (!frozen && p.fire && inPlay && now - p.lastShot > cooldown) {
      p.lastShot = now;
      p.spawnProtectedUntil = 0; // firing forfeits your spawn protection
      const isLaser = buffType === 'laser';
      const angles = buffType === 'triple' ? [p.aim - TRIPLE_SPREAD, p.aim, p.aim + TRIPLE_SPREAD] : [p.aim];
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
        p.shots++;
      }
    }
  }

  // Bullets
  if (inPlay) {
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
          const shooter = players[b.ownerId];
          if (shooter) shooter.hits++;
          if (now < target.spawnProtectedUntil) {
            // spawn protection: the shot is consumed but does no damage
          } else if (target.buff && target.buff.type === 'shield') {
            target.buff = null; // shield absorbs the hit and shatters
          } else {
            target.hp -= 1;
            target.lastHitAt = now;
            if (shooter) shooter.damage += 1;
            if (target.hp <= 0) {
              target.hp = 0;
              target.alive = false;
              target.deaths += 1;
              explosions.push({
                id: ++explosionSeq,
                x: target.x,
                y: target.y,
                color: target.design.color,
                at: now,
              });
              if (shooter && b.ownerId !== id) shooter.kills++;
            }
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

    const ids = Object.keys(players);
    const aliveIds = ids.filter((id) => players[id].alive);
    if (ids.length >= 2 && aliveIds.length <= 1) {
      const wid = aliveIds[0] || null;
      endRound(wid, wid ? `${displayName(players[wid])} wins the round!` : 'Draw!');
    } else if (now >= round.endAt) {
      if (round.state === 'sudden') {
        endRound(null, 'Sudden death draw!');
      } else {
        const maxKills = Math.max(...ids.map((id) => players[id].kills), 0);
        const leaders = ids.filter((id) => players[id].kills === maxKills && maxKills > 0);
        if (leaders.length === 1) {
          endRound(leaders[0], `${displayName(players[leaders[0]])} wins on kills!`);
        } else {
          // tied on the clock -> sudden death: 1 HP, next kill wins
          round.state = 'sudden';
          round.endAt = now + SUDDEN_TIME;
          bullets = [];
          for (const id of aliveIds) players[id].hp = SUDDEN_HP;
        }
      }
    }
  } else if (round.state === 'ended') {
    if (now >= round.endsWaitingAt) {
      if (match.over) resetMatch();
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
      aim: p.aim,
      design: p.design,
      alive: p.alive,
      kills: p.kills,
      hp: p.hp,
      maxHp: MAX_HP,
      matchWins: p.matchWins,
      deaths: p.deaths,
      damage: p.damage,
      shots: p.shots,
      hits: p.hits,
      powerups: p.powerups,
      spawnProtected: now < p.spawnProtectedUntil,
      buff: p.buff ? { type: p.buff.type, timeLeft: Math.max(0, p.buff.expiresAt - now) } : null,
      taunt: p.taunt && p.taunt.at + TAUNT_DURATION > now ? p.taunt : null,
    };
  }

  const nextPlan = round.powerupPlan[round.powerupIndex];
  const powerupNext = nextPlan
    ? { x: nextPlan.x, y: nextPlan.y, type: nextPlan.type, timeLeft: Math.max(0, nextPlan.at - now) }
    : null;

  const state = JSON.stringify({
    type: 'state',
    players: playersOut,
    bullets: bullets.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, hot: b.hot, laser: !!b.laser })),
    holes: holes.map((h) => ({ x: h.x, y: h.y, r: h.r })),
    explosions: explosions.map((e) => ({ id: e.id, x: e.x, y: e.y, color: e.color })),
    powerup: powerup ? { x: powerup.x, y: powerup.y, type: powerup.type } : null,
    powerupNext,
    round: {
      state: round.state,
      timeLeft: (round.state === 'active' || round.state === 'sudden') ? Math.max(0, round.endAt - now) : 0,
      countdownLeft: round.state === 'countdown' ? Math.max(0, round.countdownEndAt - now) : 0,
      winnerId: round.winnerId,
      winnerText: round.winnerText,
    },
    match: {
      targetWins: match.targetWins,
      roundNumber: match.roundNumber,
      over: match.over,
      winnerText: match.winnerText,
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
