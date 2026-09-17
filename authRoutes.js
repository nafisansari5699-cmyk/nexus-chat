/**
 * routes/authRoutes.js — user registration, login, session.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../dbConfig');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/** POST /api/auth/register */
router.post('/register', async (req, res) => {
  try {
    const { username, password, displayName, publicKey, privateKeyPacket } = req.body || {};
    if (!publicKey || !privateKeyPacket) {
      return res.status(400).json({ error: 'Encryption identity missing — reload the app' });
    }
    const user = await User.create({ username, password, displayName, publicKey, privateKeyPacket });
    res.status(201).json({ token: signToken(user), user: User.authProfile(user) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Registration failed' });
  }
});

/** POST /api/auth/login */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = User.findByUsername(username || '');
    if (!user || !(await User.verifyPassword(user, password || ''))) {
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    User.touch(user.id);
    res.json({ token: signToken(user), user: User.authProfile(user) });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

/** GET /api/auth/me — token validity + profile refresh */
router.get('/me', (req, res) => {
  const user = User.findById(req.user.id);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  res.json({ user: User.authProfile(user) });
});

/** PATCH /api/auth/me — update display name / about */
router.patch('/me', (req, res) => {
  const updated = User.update(req.user.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json({ user: updated });
});

module.exports = router;
