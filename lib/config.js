// Tunable game and economy constants. Pure data — no game logic lives here.

// ---- Arena & tanks ----
const ARENA_W = 800;
const ARENA_H = 600;
const TANK_R = 16;
const TANK_SPEED = 2.2;
const MAX_HP = 3; // shots to destroy a tank
const MAX_PLAYERS = 4;

// ---- Bullets & firing ----
const BULLET_R = 4;
const BULLET_SPEED = 7;
const BULLET_MAX_DISTANCE = 400; // normal bullets fizzle out after this; ricochet/laser are exempt
const FIRE_COOLDOWN = 600;
const FIRE_RECOIL = 5; // px the hull kicks back opposite the barrel on each shot
// Per-powerup recoil override: heavier weapons throw the hull harder.
const POWERUP_RECOIL = {
  speed: 5,
  rapid: 3,    // fires often, so keep each kick small
  triple: 16,  // three shells at once = the big shove
  ricochet: 5,
  shield: 5,
  laser: 10,   // high-energy beam
};

// ---- Round / match flow ----
const TICK_MS = 1000 / 60;
const ROUND_TIME = 60000;
const RESTART_DELAY = 4000;
const MATCH_END_DELAY = 9000; // longer pause after the match is decided
const MATCH_TARGET_WINS = 3; // first to this many round wins takes the match
const COUNTDOWN_MS = 3000; // freeze before a round goes live
const SPAWN_PROTECT_MS = 1200; // no damage at round start, dropped early if you fire
const SUDDEN_TIME = 15000; // sudden-death window
const SUDDEN_HP = 1; // everyone drops to this in sudden death

// ---- Power-ups ----
const POWERUP_TYPES = ['speed', 'rapid', 'triple', 'ricochet', 'shield', 'laser'];
const POWERUP_R = 14;
const POWERUP_DURATION = 8000;
const POWERUP_FIRST_AT = 8000; // first spawn after the round goes live
const POWERUP_INTERVAL = 9000; // then one every interval, random spot/type order
const SPEED_MULT = 1.7;
const RAPID_COOLDOWN = 240;
const TRIPLE_SPREAD = 0.26; // radians, ~15 degrees
const RICOCHET_BOUNCES = 3;
const LASER_COOLDOWN = 900;
const LASER_CHARGE = 500; // hold fire this long before a laser shot releases
const LASER_SPEED = 14; // 2x bullet speed
const HOLE_R = 12; // radius of the tunnel a laser punches through a wall

// ---- Taunts & feedback lifetimes ----
const TAUNT_MAX_LEN = 40;
const TAUNT_COOLDOWN = 1200; // ms between a player's taunts
const TAUNT_DURATION = 3200; // ms a speech bubble stays up
const EXPLOSION_DURATION = 900; // ms a wreck stays in the state feed
const HIT_EVENT_DURATION = 350; // ms a hit marker stays in the state feed
const FIRE_EVENT_DURATION = 160; // ms a muzzle event stays in the state feed

// Kept deliberately short - this is a friends-on-the-LAN game, not a chat app.
const PROFANITY = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'pussy', 'fag', 'nigger', 'retard'];

// ---- Bolt economy ----
const START_BOLTS = 25;
const KILL_BOLTS = 3;
const ACE_BOLTS = 5;
const FIRST_BLOOD_BOLTS = 2;
const ROUND_WIN_BOLTS = 5;
const MATCH_WIN_BOLTS = 15;
const ACCURATE_BOLTS = 2; // round accuracy >= 60%
const SURVIVED_BOLTS = 3; // died zero times in the round
const STREAK_BONUS_BOLTS = 1; // extra per kill after a 2-kill streak
const DEATH_TAX = 2;
const ROUND_LOSS_TAX = 3;
const MATCH_LOSS_TAX = 8;
const RAGE_QUIT_TAX = 15;
const MAP_VOTE_COST = 15;
const HAUNT_IMMUNITY_COST = 20;
const ACCURATE_THRESHOLD = 0.6;

// ---- Device linking ----
const TRANSFER_CODE_TTL_MS = 5 * 60 * 1000; // a link code is dead after this
const TRANSFER_CODE_LEN = 8; // ~40 bits, single-use + owner approval behind it
const TRANSFER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1
const TRANSFER_MAX_DEVICES = 8; // approved devices per account

module.exports = {
  ARENA_W, ARENA_H, TANK_R, TANK_SPEED, MAX_HP, MAX_PLAYERS,
  BULLET_R, BULLET_SPEED, BULLET_MAX_DISTANCE, FIRE_COOLDOWN, FIRE_RECOIL, POWERUP_RECOIL,
  TICK_MS, ROUND_TIME, RESTART_DELAY, MATCH_END_DELAY, MATCH_TARGET_WINS,
  COUNTDOWN_MS, SPAWN_PROTECT_MS, SUDDEN_TIME, SUDDEN_HP,
  POWERUP_TYPES, POWERUP_R, POWERUP_DURATION, POWERUP_FIRST_AT, POWERUP_INTERVAL,
  SPEED_MULT, RAPID_COOLDOWN, TRIPLE_SPREAD, RICOCHET_BOUNCES, LASER_COOLDOWN, LASER_CHARGE, LASER_SPEED, HOLE_R,
  TAUNT_MAX_LEN, TAUNT_COOLDOWN, TAUNT_DURATION, EXPLOSION_DURATION, HIT_EVENT_DURATION, FIRE_EVENT_DURATION,
  PROFANITY,
  START_BOLTS, KILL_BOLTS, ACE_BOLTS, FIRST_BLOOD_BOLTS, ROUND_WIN_BOLTS, MATCH_WIN_BOLTS,
  ACCURATE_BOLTS, SURVIVED_BOLTS, STREAK_BONUS_BOLTS, DEATH_TAX, ROUND_LOSS_TAX, MATCH_LOSS_TAX,
  RAGE_QUIT_TAX, MAP_VOTE_COST, HAUNT_IMMUNITY_COST, ACCURATE_THRESHOLD,
  TRANSFER_CODE_TTL_MS, TRANSFER_CODE_LEN, TRANSFER_CODE_ALPHABET, TRANSFER_MAX_DEVICES,
};
