/**
 * middleware/authVerify.js — validates the JWT on every protected API route
 * and socket connection. Attach req.user = { id, username }.
 */
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../dbConfig');

module.exports = function authVerify(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.user = { id: payload.sub, username: payload.username };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

/** Same check for socket.io handshakes. Returns decoded payload or throws. */
module.exports.verifySocketToken = function verifySocketToken(token) {
  return jwt.verify(token, getJwtSecret());
};
