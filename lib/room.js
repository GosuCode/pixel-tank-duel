// A room is one isolated game: its own players, round, match, map and bullets.
// createRoom() returns a handle the server drives (join / tick / isEmpty).
const cfg = require('./config');
const {
  ARENA_W, ARENA_H, TANK_R, TANK_SPEED, MAX_HP, MAX_PLAYERS,
  BULLET_R, BULLET_SPEED, BULLET_MAX_DISTANCE, FIRE_COOLDOWN, FIRE_RECOIL, POWERUP_RECOIL,
  ROUND_TIME, RESTART_DELAY, MATCH_END_DELAY, MATCH_TARGET_WINS,
  COUNTDOWN_MS, SPAWN_PROTECT_MS, SUDDEN_TIME, SUDDEN_HP,
  POWERUP_TYPES, POWERUP_R, POWERUP_DURATION, POWERUP_FIRST_AT, POWERUP_INTERVAL,
  SPEED_MULT, RAPID_COOLDOWN, TRIPLE_SPREAD, RICOCHET_BOUNCES, LASER_COOLDOWN, LASER_SPEED, HOLE_R,
  TAUNT_COOLDOWN, TAUNT_DURATION, EXPLOSION_DURATION, HIT_EVENT_DURATION, FIRE_EVENT_DURATION,
  START_BOLTS, KILL_BOLTS, ACE_BOLTS, FIRST_BLOOD_BOLTS, ROUND_WIN_BOLTS, MATCH_WIN_BOLTS,
  ACCURATE_BOLTS, SURVIVED_BOLTS, STREAK_BONUS_BOLTS, DEATH_TAX, ROUND_LOSS_TAX, MATCH_LOSS_TAX,
  RAGE_QUIT_TAX, ACCURATE_THRESHOLD,
} = cfg;
const {
  WIN_STREAK_SKINS, SHOP_ITEMS, SHOP_BY_ID, TANK_COLORS, TANK_PARTS, SPAWNS, CX, CY, MAPS,
} = require('./catalog');
const { defaultDesign, sanitizeName, sanitizeTaunt, sanitizeDesign, displayName } = require('./design');
const {
  bankOf, credit, debit, sendBank, loadBankIntoPlayer, claimLegacyBank, sanitizeToken, saveBank,
} = require('./bank');

const IN_PLAY_STATES = new Set(['countdown', 'active', 'sudden']);
const isInPlay = (state) => IN_PLAY_STATES.has(state);
const isLive = (state) => state === 'active' || state === 'sudden';

function circleRectCollide(cx, cy, r, rect) {
  const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Pick a random arena position whose powerup circle clears every obstacle.
function randomPowerupSpot(obstacles) {
  const margin = POWERUP_R + 8;
  for (let attempt = 0; attempt < 80; attempt++) {
    const x = margin + Math.random() * (ARENA_W - margin * 2);
    const y = margin + Math.random() * (ARENA_H - margin * 2);
    let blocked = false;
    for (const o of obstacles) {
      if (circleRectCollide(x, y, POWERUP_R + 6, o)) { blocked = true; break; }
    }
    if (!blocked) return { x, y };
  }
  return { x: ARENA_W / 2, y: ARENA_H / 2 };
}

function buildPowerupPlan(startAt, obstacles) {
  // Random type order and a random valid position per spawn, so no two rounds
  // share a schedule. One entry per type so every powerup appears.
  const types = shuffle(POWERUP_TYPES);
  const plan = [];
  for (let i = 0; i < types.length; i++) {
    const spot = randomPowerupSpot(obstacles);
    plan.push({ at: startAt + POWERUP_FIRST_AT + i * POWERUP_INTERVAL, x: spot.x, y: spot.y, type: types[i] });
  }
  return plan;
}

function createRoom(code, visibility = 'open') {
  const sockets = new Set(); // ws connections currently in this room
  const createdAt = Date.now();

  let mapIndex = 0;
  let OBSTACLES = MAPS[mapIndex].obstacles;

  const players = {}; // id -> { x,y,angle,design,alive,kills,hp,buff,matchWins,stats,... }
  let bullets = []; // { x,y,vx,vy,ownerId,bounces,bounceLimit,bornAt,hot,laser,hitIds }
  let holes = []; // { x,y,r } permanent tunnels punched through walls by lasers (reset each round)
  let explosions = []; // { id,x,y,color,at } wreck markers, pruned after EXPLOSION_DURATION
  let explosionSeq = 0;
  let hitEvents = []; // { id,x,y,by,target,kind,at } hit feedback, pruned after HIT_EVENT_DURATION
  let hitSeq = 0;
  let fireEvents = []; // { id,x,y,by,angle,at } muzzle events for sound/flash, pruned after FIRE_EVENT_DURATION
  let fireSeq = 0;

  let round = {
    state: 'waiting', // waiting | countdown | active | sudden | ended
    endAt: 0,
    winnerText: '',
    winnerId: null,
    endsWaitingAt: 0,
    countdownEndAt: 0,
    powerupPlan: [],
    powerupIndex: 0,
    firstBloodGiven: false,
  };
  let match = { targetWins: MATCH_TARGET_WINS, roundNumber: 0, over: false, winnerText: '' };
  let powerup = null; // { x, y, type }

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

  function nextSpawn(index) {
    return SPAWNS[index % SPAWNS.length];
  }

  // Spawned tanks face the arena center rather than a fixed direction.
  function spawnAngle(x, y) {
    return Math.atan2(CY - y, CX - x);
  }

  function resetPlayerForRound(p, index) {
    const s = nextSpawn(index);
    p.x = s.x;
    p.y = s.y;
    p.angle = spawnAngle(s.x, s.y);
    p.aim = p.angle;
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
    // round-scoped economy flags
    p.roundFirstBlood = false;
    p.roundSurvived = true;
    p.killStreak = 0;
    p.firstBloodGiven = false;
    p.wonRound = false;
    p.rageQuitTaxed = false;
  }

  function broadcastMap() {
    const msg = JSON.stringify({ type: 'map', obstacles: OBSTACLES, name: MAPS[mapIndex].name });
    sockets.forEach((client) => {
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
    hitEvents = [];
    fireEvents = [];
    powerup = null;

    const now = Date.now();
    round.countdownEndAt = now + COUNTDOWN_MS;
    round.powerupPlan = buildPowerupPlan(round.countdownEndAt, OBSTACLES);
    round.powerupIndex = 0;
    round.state = 'countdown';
    round.endAt = 0;
    round.winnerText = '';
    round.winnerId = null;
    round.firstBloodGiven = false;
  }

  function beginActiveRound(now) {
    round.state = 'active';
    round.endAt = now + ROUND_TIME;
    for (const id in players) players[id].spawnProtectedUntil = now + SPAWN_PROTECT_MS;
  }

  function endRound(winnerId, winnerText) {
    const now = Date.now();
    const total = Object.keys(players).length;
    const aliveCount = Object.values(players).filter((p) => p.alive).length;
    const wiped = total >= 2 && aliveCount <= 1;
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

    // ---- Bolt settlement: per-player round reward/penalty + haunt + streak ----
    for (const id in players) {
      const p = players[id];
      if (!p.design || !p.design.name) continue;
      const b = bankOf(p);
      if (!b) continue;

      let earned = 0;
      let isWin = false;
      if (p.shots > 0 && p.hits / p.shots >= ACCURATE_THRESHOLD) earned += ACCURATE_BOLTS;
      if (p.roundSurvived) earned += SURVIVED_BOLTS;

      if (winner) {
        isWin = id === winnerId;
        if (winnerId && isWin) {
          earned += ROUND_WIN_BOLTS;
          if (wiped) earned += ACE_BOLTS;
          p.streak += 1;
          p.wonRound = true;
          p.best = Math.max(p.best, p.streak);
          clearHaunt(p);
          b.wins = (b.wins || 0) + 1;
        } else if (winnerId) {
          earned -= ROUND_LOSS_TAX;
          b.losses = (b.losses || 0) + 1;
          bumpHaunt(p);
        }
        b.streak = p.streak;
        b.best = p.best;
      }

      if (earned > 0) {
        p.bolts = credit(p, earned);
        sendBank(p, { type: 'round', amount: earned, win: isWin });
      } else if (earned < 0) {
        p.bolts = debit(p, -earned);
        sendBank(p, { type: 'round', amount: earned, win: false });
      }

      // match settlement on top of the round settlement
      if (winner && match.over && winnerId) {
        if (id === winnerId) {
          p.bolts = credit(p, MATCH_WIN_BOLTS);
          sendBank(p, { type: 'match', amount: MATCH_WIN_BOLTS, win: true });
        } else {
          p.bolts = debit(p, MATCH_LOSS_TAX);
          sendBank(p, { type: 'match', amount: -MATCH_LOSS_TAX, win: false });
        }
      }
    }
    saveBank();

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

  function bumpHaunt(p) {
    p.lossStreak = (p.lossStreak || 0) + 1;
    p.streak = 0;
    p.hauntLevel = Math.min(5, Math.max(1, Math.floor(p.lossStreak / 2) + 1));
  }

  function clearHaunt(p) {
    p.lossStreak = 0;
    p.hauntLevel = 0;
  }

  function join(ws) {
    if (Object.keys(players).length >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ type: 'full' }));
      ws.close();
      return;
    }

    sockets.add(ws);
    const id = Math.random().toString(36).substring(2, 9);
    const index = Object.keys(players).length;
    const spawn = nextSpawn(index);

    const usedColors = new Set(Object.values(players).map((p) => p.design.color));
    const freeColor = TANK_COLORS.find((c) => !usedColors.has(c.hex));
    const design = defaultDesign(index, freeColor && freeColor.hex);
    const angle = spawnAngle(spawn.x, spawn.y);

    players[id] = {
      token: null,
      x: spawn.x,
      y: spawn.y,
      angle,
      aim: angle,
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
      // bolt economy + haunt state (server-side per match, backed by bank store)
      bolts: START_BOLTS,
      owned: [],
      bought: {},
      wins: 0,
      losses: 0,
      streak: 0,
      best: 0,
      hauntLevel: 0,
      lossStreak: 0,
      killStreak: 0,
      roundFirstBlood: false,
      roundSurvived: false,
      rageQuitTaxed: false,
      wonRound: false,
      firstBloodGiven: false,
    };
    players[id].ws = ws;

    ws.send(JSON.stringify({
      type: 'init',
      id,
      roomCode: code,
      arena: { w: ARENA_W, h: ARENA_H },
      obstacles: OBSTACLES,
      mapName: MAPS[mapIndex].name,
      palette: TANK_COLORS,
      parts: TANK_PARTS,
      maps: MAPS.map((m) => m.name),
      shop: SHOP_ITEMS.map((i) => ({ id: i.id, cat: i.cat, name: i.name, cost: i.cost, color: i.color, desc: i.desc })),
      streakSkins: WIN_STREAK_SKINS.map((s) => ({ id: s.id, at: s.at, name: s.name, desc: s.desc })),
    }));

    // joining mid-round: grant the same spawn protection so you can't be sniped on entry
    if (isLive(round.state)) {
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
      } else if (data.type === 'auth') {
        // device token = bank identity; callsign is display-only
        const tok = sanitizeToken(data.token);
        if (tok && !p.token) {
          p.token = tok;
          loadBankIntoPlayer(p, bankOf(p, false));
          sendBank(p, 'auth');
        }
      } else if (data.type === 'design') {
        const newName = sanitizeName(data.design && data.design.name, p.design.name);
        claimLegacyBank(p, newName);
        const b = bankOf(p);
        p.design = sanitizeDesign(data.design, p.design, (b && b.owned) || []);
        loadBankIntoPlayer(p, b);
        sendBank(p, 'design');
      } else if (data.type === 'buy') {
        const item = SHOP_BY_ID[data.itemId];
        const b = bankOf(p);
        if (!item || !b) return;
        if (item.cat === 'consumable') {
          if ((b.bought[item.id] || 0) >= 1) { sendBank(p, { type: 'boughtFail', itemId: item.id }); return; }
          if (b.bolts < item.cost) { sendBank(p, { type: 'boughtFail', itemId: item.id }); return; }
          b.bolts -= item.cost;
          b.bought[item.id] = (b.bought[item.id] || 0) + 1;
          p.bolts = b.bolts; p.bought = b.bought;
          saveBank();
          sendBank(p, { type: 'bought', itemId: item.id });
        } else {
          if (b.bolts < item.cost) { sendBank(p, { type: 'boughtFail', itemId: item.id }); return; }
          b.bolts -= item.cost;
          if (!b.owned.includes(item.id)) b.owned.push(item.id);
          // auto-equip: a bought cosmetic takes effect immediately
          if (p.design) p.design[item.cat] = item.id;
          p.bolts = b.bolts; p.owned = b.owned.slice();
          saveBank();
          sendBank(p, { type: 'bought', itemId: item.id });
        }
      } else if (data.type === 'mapvote') {
        // consume a map-vote token to force the next map (available globally)
        const b = bankOf(p);
        if (b && (b.bought.mapvote || 0) >= 1) {
          b.bought.mapvote -= 1;
          p.bought = b.bought;
          if (MAPS.length > 1 && data.mapIndex !== mapIndex && Number.isInteger(data.mapIndex) && data.mapIndex >= 0 && data.mapIndex < MAPS.length) {
            mapIndex = data.mapIndex;
            OBSTACLES = MAPS[mapIndex].obstacles;
          }
          saveBank();
          sendBank(p, { type: 'mapvoted', mapIndex });
          broadcastMap();
        }
      } else if (data.type === 'immunity') {
        // a haunt immunity token absorbs the next haunting that would otherwise hit
        const b = bankOf(p);
        if (b && (b.bought.immunity || 0) >= 1) {
          b.bought.immunity -= 1;
          p.bought = b.bought;
          p.hauntLevel = 0;
          p.lossStreak = 0;
          saveBank();
          sendBank(p, { type: 'immunityUsed' });
        }
      } else if (data.type === 'dbg_kill' && process.env.PTD_DEBUG) {
        // test seam: drop a one-shot bullet on the target so the real kill path
        // (deaths, explosions, bolt settlement) runs. Ignored unless PTD_DEBUG=1.
        const t = players[data.target];
        const a = players[id];
        if (t && a && t !== a && t.alive) {
          t.hp = 1;
          bullets.push({
            x: t.x, y: t.y, vx: 0.01, vy: 0.01, ownerId: id,
            bounces: 0, bounceLimit: 0, hot: false, laser: false, hitIds: [],
            bornAt: Date.now(), startX: t.x, startY: t.y,
          });
        }
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
      const p = players[id];
      if (p) {
        // rage quit mid-round: heavy tax + haunts persist for the next session
        if (isInPlay(round.state) && p.design && p.design.name && !p.rageQuitTaxed) {
          p.rageQuitTaxed = true;
          debit(p, RAGE_QUIT_TAX);
          const b = bankOf(p);
          if (b) { b.streak = 0; b.best = 0; saveBank(); }
          p.streak = 0;
          p.best = 0;
          p.hauntLevel = Math.max(p.hauntLevel, 1);
        }
        const b = bankOf(p);
        if (b) { b.streak = p.streak; b.best = p.best; saveBank(); }
      }
      delete players[id];
      sockets.delete(ws);
      if (Object.keys(players).length < 2 && isInPlay(round.state)) {
        round.state = 'waiting';
      }
    });
  }

  function tick() {
    const now = Date.now();

    // Countdown -> live
    if (round.state === 'countdown' && now >= round.countdownEndAt) {
      beginActiveRound(now);
    }

    const inPlay = isLive(round.state);

    // Powerup schedule + pickup (active only)
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

        // Recoil: kick the hull back along the barrel, blocked by walls/tanks.
        // Each powerup throws a different weight, triple being the big one.
        const recoil = POWERUP_RECOIL[buffType] || FIRE_RECOIL;
        const recoilX = Math.max(TANK_R, Math.min(ARENA_W - TANK_R, p.x - Math.cos(p.aim) * recoil));
        const recoilY = Math.max(TANK_R, Math.min(ARENA_H - TANK_R, p.y - Math.sin(p.aim) * recoil));
        if (!OBSTACLES.some((o) => circleRectCollide(recoilX, recoilY, TANK_R, o)) && !tankBlocked(recoilX, recoilY, id)) {
          p.x = recoilX;
          p.y = recoilY;
        }

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

        // Muzzle event: drives the cannon sound + flash on every client.
        fireEvents.push({
          id: ++fireSeq,
          x: p.x + Math.cos(p.aim) * (TANK_R + 4),
          y: p.y + Math.sin(p.aim) * (TANK_R + 4),
          by: id,
          angle: p.aim,
          at: now,
        });
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
            let kind = 'damage';
            if (now < target.spawnProtectedUntil) {
              // spawn protection: the shot is consumed but does no damage
              kind = 'absorbed';
            } else if (target.buff && target.buff.type === 'shield') {
              target.buff = null; // shield absorbs the hit and shatters
              kind = 'absorbed';
            } else {
              target.hp -= 1;
              target.lastHitAt = now;
              if (shooter) shooter.damage += 1;
              if (target.hp <= 0) {
                target.hp = 0;
                target.alive = false;
                target.deaths += 1;
                target.roundSurvived = false;
                target.killStreak = 0;
                kind = 'kill';
                explosions.push({
                  id: ++explosionSeq,
                  x: target.x,
                  y: target.y,
                  color: target.design.color,
                  by: b.ownerId,
                  boom: (shooter && shooter.design && shooter.design.boom) || null,
                  at: now,
                });
                if (target.design && target.design.name) {
                  target.bolts = debit(target, DEATH_TAX);
                  sendBank(target, { type: 'death', amount: -DEATH_TAX });
                }
                if (shooter && b.ownerId !== id) {
                  shooter.kills++;
                  if (shooter.design && shooter.design.name) {
                    const firstBlood = round.firstBloodGiven ? 0 : FIRST_BLOOD_BOLTS;
                    if (firstBlood) round.firstBloodGiven = true;
                    const bolts = KILL_BOLTS + Math.min(3, shooter.killStreak) * STREAK_BONUS_BOLTS + firstBlood;
                    shooter.killStreak++;
                    shooter.lossStreak = 0;
                    if (shooter.hauntLevel > 0) shooter.hauntLevel = 0;
                    shooter.bolts = credit(shooter, bolts);
                    if (bolts > 0) sendBank(shooter, { type: 'kill', amount: bolts, firstBlood: firstBlood > 0 });
                  }
                }
              }
            }
            hitEvents.push({
              id: ++hitSeq,
              x: b.x,
              y: b.y,
              by: b.ownerId,
              target: id,
              kind,
              at: now,
            });
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
    hitEvents = hitEvents.filter((e) => now - e.at < HIT_EVENT_DURATION);
    fireEvents = fireEvents.filter((e) => now - e.at < FIRE_EVENT_DURATION);

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
        bolts: p.bolts,
        hauntLevel: p.hauntLevel,
        lossStreak: p.lossStreak || 0,
        wonRound: !!p.wonRound,
        streak: Math.max(p.streak, 0),
        best: Math.max(p.best, 0),
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
      bullets: bullets.map((b) => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, hot: b.hot, laser: !!b.laser, owner: b.ownerId })),
      holes: holes.map((h) => ({ x: h.x, y: h.y, r: h.r })),
      explosions: explosions.map((e) => ({ id: e.id, x: e.x, y: e.y, color: e.color, by: e.by, boom: e.boom })),
      hitEvents: hitEvents.map((e) => ({ id: e.id, x: e.x, y: e.y, by: e.by, target: e.target, kind: e.kind })),
      fireEvents: fireEvents.map((e) => ({ id: e.id, x: e.x, y: e.y, by: e.by, angle: e.angle })),
      powerup: powerup ? { x: powerup.x, y: powerup.y, type: powerup.type } : null,
      powerupNext,
      round: {
        state: round.state,
        timeLeft: isLive(round.state) ? Math.max(0, round.endAt - now) : 0,
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
    sockets.forEach((client) => {
      if (client.readyState === 1) client.send(state);
    });
  }

  return {
    code,
    visibility,
    createdAt,
    join,
    tick,
    isEmpty: () => sockets.size === 0,
    playerCount: () => sockets.size,
    roundState: () => round.state,
  };
}

module.exports = { createRoom };
