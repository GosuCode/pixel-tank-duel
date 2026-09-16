// Player design + chat sanitization. Pure functions over static content.
const { PROFANITY, TAUNT_MAX_LEN } = require('./config');
const { TANK_COLORS, TANK_PARTS, SHOP_ITEMS } = require('./catalog');

function defaultDesign(index, colorHex) {
  return {
    name: '',
    hull: 'classic',
    turret: 'square',
    barrel: 'medium',
    treads: 'treads',
    color: colorHex || TANK_COLORS[index % TANK_COLORS.length].hex,
    skin: null,
    trail: null,
    boom: null,
    spawn: null,
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

// Cosmetics (skin/trail/boom/spawn) are only honored if the player owns the
// item - a hacked client can't equip gear it never bought.
function ownables(d) {
  const out = ['none'];
  const allowed = new Set(d || []);
  for (const it of SHOP_ITEMS) {
    if (it.cat !== 'consumable' && allowed.has(it.id)) out.push(it.id);
  }
  return out;
}

function sanitizeDesign(input, fallback, owned) {
  const d = input && typeof input === 'object' ? input : {};
  const design = {};
  for (const key of Object.keys(TANK_PARTS)) {
    design[key] = TANK_PARTS[key].includes(d[key]) ? d[key] : fallback[key];
  }
  design.color = TANK_COLORS.some((c) => c.hex === d.color) ? d.color : fallback.color;
  design.treads = 'treads';
  design.name = sanitizeName(d.name, fallback.name);
  const hoard = ownables(owned || []);
  for (const cat of ['skin', 'trail', 'boom', 'spawn']) {
    design[cat] = hoard.includes(d[cat]) ? d[cat] : null;
  }
  return design;
}

function colorName(hex) {
  const c = TANK_COLORS.find((c) => c.hex === hex);
  return c ? c.name : 'Player';
}

function displayName(p) {
  return (p.design && p.design.name) || colorName(p.design.color);
}

module.exports = { defaultDesign, sanitizeName, sanitizeTaunt, ownables, sanitizeDesign, colorName, displayName };
