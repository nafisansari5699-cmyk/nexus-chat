/**
 * dbConfig.js — Zero-config JSON file database.
 *
 * Every collection is an in-memory array persisted to <DATA_DIR>/db.json
 * (debounced writes, atomic replace). This keeps the app dependency-free and
 * instantly runnable on any host (Render, Railway, Fly, Docker, localhost).
 * The models expose a tiny data-access layer, so swapping to MongoDB/Postgres
 * later only means reimplementing the functions in models/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'jwt-secret');

/** Load whole store from disk (or start fresh). */
function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { users: [], messages: [], counters: { userId: 1000000 } };
  }
}

const db = load();

let saveTimer = null;
/** Debounced, atomic write to disk. */
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      console.error('[db] persist failed:', err.message);
    }
  }, 150);
}

/**
 * Persistent JWT secret — auto-generated once, stored in DATA_DIR.
 * (Set JWT_SECRET in .env to override, required for multi-instance deploys.)
 */
function getJwtSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16) {
    return process.env.JWT_SECRET;
  }
  try {
    if (!fs.existsSync(SECRET_FILE)) {
      fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
    }
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    // Last resort for read-only filesystems (ephemeral hosting)
    return 'insecure-dev-secret-change-me';
  }
}

module.exports = { db, save, getJwtSecret, DATA_DIR };
