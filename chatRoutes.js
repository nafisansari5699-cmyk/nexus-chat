/**
 * routes/chatRoutes.js — chat history, user lookup, media upload.
 * All message payloads here are E2EE ciphertext (see models/Message.js).
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const authVerify = require('../middleware/authVerify');
const User = require('../models/User');
const Message = require('../models/Message');
const upload = require('../utils/mediaUpload');

const router = express.Router();
router.use(authVerify);

/** GET /api/chats — conversation list with last message + unread count */
router.get('/chats', (req, res) => {
  const convs = Message.listConversations(req.user.id);
  res.json({
    chats: convs.map(({ peerId, last, unread }) => ({
      peer: User.publicProfile(User.findById(peerId)),
      last: {
        id: last.id,
        from: last.from,
        to: last.to,
        type: last.type,
        ts: last.ts,
        status: last.status,
        // never expose ciphertext in the list preview; client decrypts from history
        attachment: last.attachment,
      },
      unread,
    })),
  });
});

/** GET /api/chats/:peerId?limit=&before= — decrypted-by-client history page */
router.get('/chats/:peerId', (req, res) => {
  const peer = User.findById(req.params.peerId);
  if (!peer) return res.status(404).json({ error: 'User not found' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const messages = Message.listForConversation(req.user.id, peer.id, {
    limit,
    before: req.query.before,
  });
  res.json({ messages, peer: User.publicProfile(peer) });
});

/** GET /api/users/:idOrUsername — lookup for "add by ID / username" + share links */
router.get('/users/:key', (req, res) => {
  const key = String(req.params.key);
  const user = /^\d+$/.test(key) ? User.findById(key) : User.findByUsername(key);
  if (!user) return res.status(404).json({ error: 'No user with that ID or username' });
  res.json({ user: User.publicProfile(user) });
});

/** POST /api/upload — encrypted media blob in, URL out */
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname || 'file',
    size: req.file.size,
  });
});

/** DELETE /api/uploads/:filename — remove an uploaded blob */
router.delete('/uploads/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  const target = path.join(upload.dest, safe);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  res.json({ ok: true });
});

module.exports = router;
