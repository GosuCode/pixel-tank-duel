// Bolt bank: persistence + economy. An account is the durable identity; devices
// hold tokens that point at it. This lets one player link several devices
// without ever copying the original secret, and lets a stolen token be revoked
// on its own. This module owns the on-disk store and is the only place that
// reads/writes it.
//
// On disk (data/players.json):
//   { version: 2,
//     accounts: { <accountId>: { bolts, owned, wins, losses, streak, best, bought,
//                                devices: { <tokenHash>: { label, createdAt,
//                                                          lastSeen, approved, requestId } } } },
//     legacy:   { <callsign>: <old bank record> } }
//
// Raw tokens and link codes are secrets: they are never logged, echoed, or
// written to disk. Only SHA-256 hashes of tokens are stored.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  START_BOLTS, TRANSFER_CODE_TTL_MS, TRANSFER_CODE_LEN, TRANSFER_CODE_ALPHABET, TRANSFER_MAX_DEVICES,
} = require('./config');
const { WIN_STREAK_SKINS } = require('./catalog');

const BANK_FILE = path.join(__dirname, '..', 'data', 'players.json');
const STORE_VERSION = 2;

let store = { version: STORE_VERSION, accounts: {}, legacy: {} };
const deviceIndex = new Map(); // tokenHash -> accountId
const pendingCodes = new Map(); // code -> { accountId, exp }  (ephemeral, never persisted)

function baseAccount() {
  return { bolts: START_BOLTS, owned: [], wins: 0, losses: 0, streak: 0, best: 0, bought: {}, devices: {} };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function isTokenKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9_-]{16,}$/.test(key);
}

function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8'));
  } catch {
    return;
  }
  if (raw && typeof raw === 'object' && raw.version === STORE_VERSION && raw.accounts) {
    store = { version: STORE_VERSION, accounts: raw.accounts, legacy: raw.legacy || {} };
  } else if (raw && typeof raw === 'object') {
    migrateV1(raw);
  }
  rebuildIndex();
  saveBank();
}

// v1 was { <token-or-callsign>: { bolts, owned, ... } }. Token-shaped keys become
// accounts bound to that device; short keys are pre-token callsign banks kept
// aside for one-time adoption.
function migrateV1(old) {
  const accounts = {};
  const legacy = {};
  for (const key of Object.keys(old)) {
    const val = old[key];
    if (!val || typeof val !== 'object') continue;
    if (isTokenKey(key)) {
      const accountId = crypto.randomUUID();
      const account = Object.assign(baseAccount(), val);
      account.devices = {
        [hashToken(key)]: { label: 'existing device', createdAt: Date.now(), lastSeen: Date.now(), approved: true },
      };
      accounts[accountId] = account;
    } else {
      legacy[key] = val;
    }
  }
  store = { version: STORE_VERSION, accounts, legacy };
}

function rebuildIndex() {
  deviceIndex.clear();
  for (const accountId of Object.keys(store.accounts)) {
    const devices = store.accounts[accountId].devices || {};
    for (const h of Object.keys(devices)) deviceIndex.set(h, accountId);
  }
}

function saveBank() {
  try {
    fs.mkdirSync(path.dirname(BANK_FILE), { recursive: true });
    fs.writeFileSync(BANK_FILE, JSON.stringify(store, null, 2));
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

function cleanLabel(value) {
  if (typeof value !== 'string') return 'new device';
  const label = value.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 24);
  return label || 'new device';
}

function accountIdForToken(raw) {
  if (!raw) return null;
  return deviceIndex.get(hashToken(raw)) || null;
}

// Resolve an incoming token before any bank access. Unknown tokens are "new"
// (a first device, created lazily on first bank write); known tokens are either
// approved or waiting on owner approval.
function resolveAuth(raw) {
  const accountId = accountIdForToken(raw);
  if (!accountId) return { status: 'new' };
  const account = store.accounts[accountId];
  const device = account && account.devices[hashToken(raw)];
  if (!device) return { status: 'new' };
  if (!device.approved) return { status: 'pending', requestId: device.requestId, label: device.label };
  return { status: 'ok', accountId };
}

function touchDevice(raw) {
  const accountId = accountIdForToken(raw);
  if (!accountId) return;
  const device = store.accounts[accountId].devices[hashToken(raw)];
  if (device && device.approved) {
    device.lastSeen = Date.now();
    saveBank();
  }
}

function bankOf(p, create = true) {
  if (!p || p.pending) return null;
  let accountId = p.accountId;
  if (!accountId && p.token) {
    accountId = accountIdForToken(p.token);
    if (accountId) p.accountId = accountId;
  }
  if (accountId && store.accounts[accountId]) return store.accounts[accountId];
  if (!create || !p.token) return null;

  const freshId = crypto.randomUUID();
  const account = baseAccount();
  account.devices[hashToken(p.token)] = {
    label: 'device', createdAt: Date.now(), lastSeen: Date.now(), approved: true,
  };
  store.accounts[freshId] = account;
  deviceIndex.set(hashToken(p.token), freshId);
  p.accountId = freshId;
  saveBank();
  return account;
}

function loadBankIntoPlayer(p, b) {
  if (!b) return;
  p.bolts = b.bolts; p.owned = b.owned; p.bought = b.bought;
  p.wins = b.wins; p.losses = b.losses; p.streak = b.streak; p.best = b.best;
}

function claimLegacyBank(p, name) {
  // one-time adoption of a pre-device-token bank keyed by callsign, but only
  // onto an account that has not accumulated real progress yet.
  if (!p || !p.accountId || !name) return;
  const legacy = store.legacy[name];
  if (!legacy) return;
  const account = store.accounts[p.accountId];
  if (!account) return;
  const untouched = (account.wins || 0) === 0 && (account.losses || 0) === 0
    && (account.owned || []).length === 0 && (account.bolts || 0) <= START_BOLTS;
  if (!untouched) return;
  const devices = account.devices;
  Object.assign(account, legacy, { devices });
  delete store.legacy[name];
  loadBankIntoPlayer(p, account);
  saveBank();
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

// ---- Device linking -------------------------------------------------------
// Flow: an approved device mints a short-lived single-use code; a second device
// redeems it and receives its OWN token, created pending. The code alone cannot
// open the account — the original device must approve the new one.

function makeCode() {
  const bytes = crypto.randomBytes(TRANSFER_CODE_LEN);
  let code = '';
  for (let i = 0; i < TRANSFER_CODE_LEN; i++) code += TRANSFER_CODE_ALPHABET[bytes[i] % TRANSFER_CODE_ALPHABET.length];
  return code;
}

function normalizeCode(value) {
  if (typeof value !== 'string') return '';
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function startTransfer(rawToken) {
  const auth = resolveAuth(rawToken);
  if (auth.status !== 'ok') return { error: auth.status === 'pending' ? 'unapproved' : 'unknown-device' };
  const now = Date.now();
  for (const [c, e] of pendingCodes) if (now > e.exp) pendingCodes.delete(c);
  const code = makeCode();
  const expiresAt = Date.now() + TRANSFER_CODE_TTL_MS;
  pendingCodes.set(code, { accountId: auth.accountId, exp: expiresAt });
  return { code, expiresAt };
}

function redeemTransfer(rawCode, label) {
  const code = normalizeCode(rawCode);
  const entry = code && pendingCodes.get(code);
  if (!entry) return { error: 'bad-code' };
  pendingCodes.delete(code); // single-use, whether or not the rest succeeds
  if (Date.now() > entry.exp) return { error: 'expired' };
  const account = store.accounts[entry.accountId];
  if (!account) return { error: 'bad-code' };

  const approvedCount = Object.values(account.devices).filter((d) => d.approved).length;
  if (approvedCount >= TRANSFER_MAX_DEVICES) return { error: 'too-many-devices' };

  const raw = crypto.randomBytes(32).toString('hex');
  const h = hashToken(raw);
  const requestId = crypto.randomUUID();
  account.devices[h] = { label: cleanLabel(label), createdAt: Date.now(), lastSeen: 0, approved: false, requestId };
  deviceIndex.set(h, entry.accountId);
  saveBank();
  return { token: raw, requestId, status: 'pending' };
}

function listPendingDevices(rawToken) {
  const accountId = accountIdForToken(rawToken);
  if (!accountId) return null;
  const account = store.accounts[accountId];
  if (!account) return null;
  const self = account.devices[hashToken(rawToken)];
  if (!self || !self.approved) return null;
  return Object.entries(account.devices)
    .filter(([, d]) => !d.approved)
    .map(([h, d]) => ({ requestId: d.requestId, label: d.label, createdAt: d.createdAt, fingerprint: h.slice(0, 8) }));
}

function findRequest(account, requestId) {
  for (const [h, d] of Object.entries(account.devices)) {
    if (!d.approved && d.requestId === requestId) return { hash: h, device: d };
  }
  return null;
}

function approveDevice(rawToken, requestId) {
  const accountId = accountIdForToken(rawToken);
  const account = accountId && store.accounts[accountId];
  const self = account && account.devices[hashToken(rawToken)];
  if (!account || !self || !self.approved) return { error: 'unapproved' };
  const found = findRequest(account, requestId);
  if (!found) return { error: 'not-found' };
  found.device.approved = true;
  delete found.device.requestId;
  saveBank();
  return { ok: true, label: found.device.label, fingerprint: found.hash.slice(0, 8) };
}

function denyDevice(rawToken, requestId) {
  const accountId = accountIdForToken(rawToken);
  const account = accountId && store.accounts[accountId];
  const self = account && account.devices[hashToken(rawToken)];
  if (!account || !self || !self.approved) return { error: 'unapproved' };
  const found = findRequest(account, requestId);
  if (!found) return { error: 'not-found' };
  delete account.devices[found.hash];
  deviceIndex.delete(found.hash);
  saveBank();
  return { ok: true, label: found.device.label };
}

function deviceStatus(rawToken) {
  const accountId = accountIdForToken(rawToken);
  if (!accountId) return { status: 'unknown' };
  const device = store.accounts[accountId].devices[hashToken(rawToken)];
  if (!device) return { status: 'unknown' };
  if (!device.approved) return { status: 'pending', requestId: device.requestId, label: device.label };
  return { status: 'approved' };
}

load();

module.exports = {
  saveBank, sanitizeToken, bankOf, loadBankIntoPlayer, claimLegacyBank, credit, debit, sendBank,
  resolveAuth, touchDevice, startTransfer, redeemTransfer, listPendingDevices,
  approveDevice, denyDevice, deviceStatus,
};
