// Bolt bank: persistence + economy. Keyed by a per-device token so progress
// persists with no login. This module owns the on-disk store and is the only
// place that reads/writes it.
const fs = require('fs');
const path = require('path');
const { START_BOLTS } = require('./config');
const { WIN_STREAK_SKINS } = require('./catalog');

const BANK_FILE = path.join(__dirname, '..', 'data', 'players.json');
let bank = {}; // token -> { bolts, owned:[itemId], wins, losses, streak, best, bought:{} }
try {
  bank = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8'));
} catch {}

function saveBank() {
  try {
    fs.mkdirSync(path.dirname(BANK_FILE), { recursive: true });
    fs.writeFileSync(BANK_FILE, JSON.stringify(bank, null, 2));
  } catch (e) {
    console.error('bank save failed:', e.message);
  }
}

// Device token: an opaque secret the client keeps in localStorage. It is the
// bank identity, so no login is needed — but it must never be logged or echoed.
function sanitizeToken(value) {
  if (typeof value !== 'string') return '';
  const raw = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return raw.length >= 8 ? raw : '';
}

function bankKey(p) {
  if (p.token) return p.token;
  return (p.design && p.design.name) || '';
}

function bankOf(p, create = true) {
  const key = bankKey(p);
  if (!key) return null;
  if (!bank[key]) {
    if (!create) return null;
    bank[key] = { bolts: START_BOLTS, owned: [], wins: 0, losses: 0, streak: 0, best: 0, bought: {} };
    saveBank();
  }
  return bank[key];
}

function loadBankIntoPlayer(p, b) {
  if (!b) return;
  p.bolts = b.bolts; p.owned = b.owned; p.bought = b.bought;
  p.wins = b.wins; p.losses = b.losses; p.streak = b.streak; p.best = b.best;
}

function claimLegacyBank(p, name) {
  // one-time adoption of a pre-device-token bank keyed by callsign
  if (!p.token || !name || bank[p.token]) return;
  const legacy = bank[name];
  if (legacy && !legacy.device) {
    bank[p.token] = legacy;
    legacy.device = true;
    delete bank[name];
    loadBankIntoPlayer(p, legacy);
    saveBank();
  }
}

function credit(p, amount) {
  const b = bankOf(p);
  if (!b) return 0;
  b.bolts += amount;
  saveBank();
  return b.bolts;
}

function debit(p, amount) {
  const b = bankOf(p);
  if (!b) return 0;
  b.bolts = Math.max(0, b.bolts - amount);
  saveBank();
  return b.bolts;
}

function sendBank(p, msg) {
  try {
    if (!p || !p.ws || p.ws.readyState !== 1) return;
    const b = bankOf(p, false);
    if (b) p.ws.send(JSON.stringify({ type: 'bank', bolts: p.bolts, owned: b.owned, bought: b.bought,
      streak: Math.max(p.streak, 0), wins: b.wins, losses: b.losses, best: b.best,
      hauntLevel: p.hauntLevel, streakSkins: WIN_STREAK_SKINS.filter((s) => p.best >= s.at).map((s) => s.id),
      reason: msg ? msg : undefined }));
  } catch (e) {}
}

module.exports = {
  saveBank, sanitizeToken, bankOf, loadBankIntoPlayer, claimLegacyBank, credit, debit, sendBank,
};
