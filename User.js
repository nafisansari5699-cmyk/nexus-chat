/**
 * models/User.js — user profile structure & data access.
 * Password is bcrypt-hashed; privateKeyPacket holds the client's E2EE
 * identity public key plus a password-wrapped private key (the server never
 * sees plaintext private keys).
 */
const bcrypt = require('bcryptjs');
const { db, save } = require('../dbConfig');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function nextUserId() {
  db.counters.userId += 1;
  return db.counters.userId;
}

const User = {
  async create({ username, password, displayName, publicKey, privateKeyPacket }) {
    username = String(username || '').trim();
    if (!USERNAME_RE.test(username)) {
      throw Object.assign(new Error('Username must be 3-20 letters, numbers or underscore'), { status: 400 });
    }
    if (!password || String(password).length < 6) {
      throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 });
    }
    if (this.findByUsername(username)) {
      throw Object.assign(new Error('That username is already taken'), { status: 409 });
    }
    const user = {
      id: nextUserId(),
      username,
      displayName: String(displayName || username).slice(0, 40),
      about: 'Hey there! I am using Nexus.',
      passwordHash: await bcrypt.hash(String(password), 10),
      // { publicKey: JWK (public), wrapped: base64, iv: base64, salt: base64 }
      privateKeyPacket,
      publicKey,
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
    db.users.push(user);
    save();
    return user;
  },

  findByUsername(username) {
    return db.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase());
  },

  findById(id) {
    return db.users.find((u) => u.id === Number(id));
  },

  /** Public-safe projection (includes E2EE public key so peers can derive chat keys). */
  publicProfile(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      about: user.about || '',
      publicKey: user.publicKey,
      createdAt: user.createdAt,
    };
  },

  /** Auth response — includes the wrapped private key for client-side unwrapping. */
  authProfile(user) {
    return {
      ...this.publicProfile(user),
      privateKeyPacket: user.privateKeyPacket,
    };
  },

  touch(id) {
    const u = this.findById(id);
    if (u) { u.lastSeen = Date.now(); save(); }
  },

  update(id, { displayName, about }) {
    const u = this.findById(id);
    if (!u) return null;
    if (displayName !== undefined) u.displayName = String(displayName).slice(0, 40) || u.displayName;
    if (about !== undefined) u.about = String(about).slice(0, 120);
    save();
    return this.publicProfile(u);
  },

  async verifyPassword(user, password) {
    return bcrypt.compare(String(password), user.passwordHash);
  },
};

module.exports = User;
