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
const TANK_SPEED = 3;
const FIRE_COOLDOWN = 350;
const ROUND_TIME = 60000;
const RESTART_DELAY = 4000;
const MAX_PLAYERS = 4;
const TICK_MS = 1000 / 60;

const POWERUP_TYPES = ['speed', 'rapid', 'triple', 'ricochet', 'shield'];
const POWERUP_R = 14;
const POWERUP_DURATION = 8000;
const POWERUP_RESPAWN = 12000;
const SPEED_MULT = 1.7;
const RAPID_COOLDOWN = 120;
const TRIPLE_SPREAD = 0.26; // radians, ~15 degrees
const RICOCHET_BOUNCES = 3;

const COLORS = ['#FF4136', '#0074D9', '#2ECC40', '#FFDC00'];
const SPAWNS = [
    { x: 80, y: 80 },
    { x: ARENA_W - 80, y: ARENA_H - 80 },
    { x: ARENA_W - 80, y: 80 },
    { x: 80, y: ARENA_H - 80 },
];

// Symmetric arena layout: a center cross (breaks the diagonal sightline
// between opposite spawns) plus 4 edge pillars (break the straight
// horizontal/vertical lanes and add flanking routes). All pieces stay
// well clear of the 4 corner spawn points so nobody gets walled in.
const CX = ARENA_W / 2;
const CY = ARENA_H / 2;
const OBSTACLES = [
    // center cross
    { x: CX - 100, y: CY - 10, w: 200, h: 20 },
    { x: CX - 10, y: CY - 110, w: 20, h: 80 },
    { x: CX - 10, y: CY + 30, w: 20, h: 80 },
    // edge pillars
    { x: CX - 10, y: 60, w: 20, h: 80 },
    { x: CX - 10, y: ARENA_H - 140, w: 20, h: 80 },
    { x: 60, y: CY - 10, w: 80, h: 20 },
    { x: ARENA_W - 140, y: CY - 10, w: 80, h: 20 },
];

const players = {}; // id -> { x,y,angle,color,alive,kills,lastShot,dx,dy,fire,buff }
let bullets = []; // { x,y,vx,vy,ownerId,bounces,bounceLimit,bornAt,hot }

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
}

function startRound() {
    const ids = Object.keys(players);
    ids.forEach((id, i) => resetPlayerForRound(players[id], i));
    bullets = [];
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

    players[id] = {
        x: spawn.x,
        y: spawn.y,
        angle: 0,
        color: COLORS[index % COLORS.length],
        alive: true,
        kills: 0,
        lastShot: 0,
        dx: 0,
        dy: 0,
        fire: false,
        buff: null,
    };

    ws.send(JSON.stringify({ type: 'init', id, arena: { w: ARENA_W, h: ARENA_H }, obstacles: OBSTACLES }));

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

            const blocked = OBSTACLES.some((o) => circleRectCollide(newX, newY, TANK_R, o));
            if (!blocked) {
                p.x = newX;
                p.y = newY;
            }
        }

        const cooldown = buffType === 'rapid' ? RAPID_COOLDOWN : FIRE_COOLDOWN;
        if (p.fire && round.state === 'active' && now - p.lastShot > cooldown) {
            p.lastShot = now;
            const angles = buffType === 'triple' ? [p.angle - TRIPLE_SPREAD, p.angle, p.angle + TRIPLE_SPREAD] : [p.angle];
            const bounceLimit = buffType === 'ricochet' ? RICOCHET_BOUNCES : 1;
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
                    vx: Math.cos(angle) * BULLET_SPEED,
                    vy: Math.sin(angle) * BULLET_SPEED,
                    ownerId: id,
                    bounces: 0,
                    bounceLimit,
                    hot: bounceLimit > 1,
                    bornAt: now,
                });
            }
        }
    }

    // Bullets
    if (round.state === 'active') {
        bullets = bullets.filter((b) => {
            b.x += b.vx;
            b.y += b.vy;

            let bounced = false;
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
            for (const o of OBSTACLES) {
                if (circleRectCollide(b.x, b.y, BULLET_R, o)) {
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
                if (id === b.ownerId && now - b.bornAt < 120) continue;
                const dx = target.x - b.x;
                const dy = target.y - b.y;
                if (dx * dx + dy * dy < (TANK_R + BULLET_R) * (TANK_R + BULLET_R)) {
                    if (target.buff && target.buff.type === 'shield') {
                        target.buff = null; // shield absorbs the hit and shatters
                    } else {
                        target.alive = false;
                        if (players[b.ownerId] && b.ownerId !== id) players[b.ownerId].kills++;
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
            endRound(winner ? `${winner.color} wins!` : 'Draw!');
        } else if (now >= round.endAt) {
            const maxKills = Math.max(...Object.values(players).map((p) => p.kills), 0);
            const leaders = Object.values(players).filter((p) => p.kills === maxKills && maxKills > 0);
            endRound(leaders.length === 1 ? `${leaders[0].color} wins on kills!` : "Time's up! Draw!");
        }
    } else if (round.state === 'ended') {
        if (now >= round.endsWaitingAt) {
            round.state = 'waiting';
            maybeStartRound();
        }
    }

    const playersOut = {};
    for (const id in players) {
        const p = players[id];
        playersOut[id] = {
            x: p.x,
            y: p.y,
            angle: p.angle,
            color: p.color,
            alive: p.alive,
            kills: p.kills,
            buff: p.buff ? { type: p.buff.type, timeLeft: Math.max(0, p.buff.expiresAt - now) } : null,
        };
    }

    const state = JSON.stringify({
        type: 'state',
        players: playersOut,
        bullets: bullets.map((b) => ({ x: b.x, y: b.y, hot: b.hot })),
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

server.listen(3000, '0.0.0.0', () => {
    console.log('Pixel Tank Duel running on port 3000!');
});
