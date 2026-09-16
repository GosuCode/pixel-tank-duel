// Static game content: shop, maps, cosmetics, streaks. Data only.
const { ARENA_W, ARENA_H, MAP_VOTE_COST, HAUNT_IMMUNITY_COST } = require('./config');

// The streak system has two independent counters.
// best:  +1 on every round win, reset to 0 on every round loss
// streak: like best, but also reset to 0 on rage-quit disconnects
const WIN_STREAK_SKINS = [
  { at: 3, id: 'scarred', name: 'Scarred', desc: '3-win streak: battle-scarred hull' },
  { at: 5, id: 'golden', name: 'Golden', desc: '5-win streak: gold trim' },
  { at: 10, id: 'phantom', name: 'Phantom', desc: '10-win streak: translucent ghost hull' },
  { at: 25, id: 'titanium', name: 'Titanium', desc: '25-win streak: full chrome, untradeable brag' },
];

const HAUNT_LEVELS = [
  { level: 1, name: 'Haunted', desc: 'Tab title turns into taunts' },
  { level: 2, name: 'Cursed', desc: 'Random beeps from your speakers, blurry start' },
  { level: 3, name: 'Possessed', desc: 'Window shrinks, controls scramble' },
  { level: 4, name: 'Hexed', desc: 'Notification spam + screen inversion' },
  { level: 5, name: 'Damned', desc: 'Everything: webcam request joins the chaos' },
];

// ---- The Forge: buyable cosmetics & consumables ----
const SHOP_ITEMS = [
  // Simple cosmetics: { id, cat, name, cost, color }
  { id: 'skin_camo', cat: 'skin', name: 'Camo', cost: 30, color: '#6b7d3a' },
  { id: 'skin_neon', cat: 'skin', name: 'Neon', cost: 60, color: '#00e5ff' },
  { id: 'skin_ghost', cat: 'skin', name: 'Ghost', cost: 80, color: '#c9c3aa' },
  { id: 'skin_chrome', cat: 'skin', name: 'Chrome', cost: 100, color: '#b8c0c8' },
  { id: 'skin_ember', cat: 'skin', name: 'Ember', cost: 50, color: '#ff6d3a' },
  { id: 'trail_fire', cat: 'trail', name: 'Fire Trail', cost: 35, color: '#ff9100' },
  { id: 'trail_rainbow', cat: 'trail', name: 'Rainbow Trail', cost: 60, color: '#ff6ec7' },
  { id: 'trail_spark', cat: 'trail', name: 'Sparkle Trail', cost: 30, color: '#fff176' },
  { id: 'trail_smoke', cat: 'trail', name: 'Smoke Trail', cost: 25, color: '#9e9e9e' },
  { id: 'boom_confetti', cat: 'boom', name: 'Confetti Boom', cost: 40, color: '#ffd600' },
  { id: 'boom_skull', cat: 'boom', name: 'Skull Cloud', cost: 70, color: '#dcedc8' },
  { id: 'boom_comets', cat: 'boom', name: 'Comet Boom', cost: 50, color: '#40c4ff' },
  { id: 'spawn_portal', cat: 'spawn', name: 'Portal In', cost: 45, color: '#b388ff' },
  { id: 'spawn_sky', cat: 'spawn', name: 'Drop From Sky', cost: 55, color: '#aeea00' },
  { id: 'spawn_smoke', cat: 'spawn', name: 'Smoke Reveal', cost: 30, color: '#eceff1' },
  // Consumables (tracked in bought.qty, used by the client when spent)
  { id: 'mapvote', cat: 'consumable', name: 'Map Vote', cost: MAP_VOTE_COST, desc: 'Force next map vote' },
  { id: 'immunity', cat: 'consumable', name: 'Haunt Immunity', cost: HAUNT_IMMUNITY_COST, desc: 'Block one haunt' },
];
const SHOP_BY_ID = {};
for (const it of SHOP_ITEMS) SHOP_BY_ID[it.id] = it;

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

module.exports = {
  WIN_STREAK_SKINS, HAUNT_LEVELS, SHOP_ITEMS, SHOP_BY_ID,
  TANK_COLORS, TANK_PARTS, SPAWNS, CX, CY, MAPS,
};
