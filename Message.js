/**
 * models/Message.js — chat message structure & data access.
 * Message bodies are END-TO-END ENCRYPTED by clients: only `ct` (ciphertext)
 * and `iv` reach this server. Attachments are stored as encrypted blobs in
 * UPLOAD_DIR; the server cannot read either.
 */
const crypto = require('crypto');
const { db, save } = require('../dbConfig');

const MAX_MSG_CHARS = 8000; // ciphertext length cap

function convId(a, b) {
  return [Number(a), Number(b)].sort((x, y) => x - y).join(':');
}

const Message = {
  create({ from, to, type, ct, iv, attachment }) {
    if (!ct || !iv) throw Object.assign(new Error('Encrypted payload required'), { status: 400 });
    if (String(ct).length > MAX_MSG_CHARS) {
      throw Object.assign(new Error('Message too large'), { status: 413 });
    }
    const msg = {
      id: crypto.randomUUID(),
      convId: convId(from, to),
      from: Number(from),
      to: Number(to),
      type: ['text', 'image', 'file', 'voice'].includes(type) ? type : 'text',
      ct: String(ct),
      iv: String(iv),
      attachment: attachment || null,
      status: 'sent', // sent -> delivered -> read
      ts: Date.now(),
    };
    db.messages.push(msg);
    save();
    return msg;
  },

  /** Newest-last history page for a conversation, with optional cursor. */
  listForConversation(userId, peerId, { limit = 50, before } = {}) {
    const cid = convId(userId, peerId);
    let msgs = db.messages.filter((m) => m.convId === cid);
    if (before) msgs = msgs.filter((m) => m.ts < Number(before));
    const page = msgs.slice(-Math.min(limit, 100));
    return page;
  },

  /** Conversation summaries for the chat list: last message + unread count. */
  listConversations(userId) {
    const byPeer = new Map();
    for (const m of db.messages) {
      if (m.from !== userId && m.to !== userId) continue;
      const peerId = m.from === userId ? m.to : m.from;
      const entry = byPeer.get(peerId) || { peerId, last: null, unread: 0 };
      if (!entry.last || m.ts >= entry.last.ts) entry.last = m;
      if (m.to === userId && m.from === userId) { /* skip */ }
      if (m.to === userId && m.status !== 'read') entry.unread += 1;
      byPeer.set(peerId, entry);
    }
    return [...byPeer.values()].sort((a, b) => b.last.ts - a.last.ts);
  },

  markDelivered(userId, peerId) {
    let n = 0;
    for (const m of db.messages) {
      if (m.from === Number(peerId) && m.to === Number(userId) && m.status === 'sent') {
        m.status = 'delivered'; n++;
      }
    }
    if (n) save();
    return n;
  },

  markRead(userId, peerId) {
    let n = 0;
    for (const m of db.messages) {
      if (m.from === Number(peerId) && m.to === Number(userId) && m.status !== 'read') {
        m.status = 'read'; n++;
      }
    }
    if (n) save();
    return n;
  },

  statusOf(msg) {
    return { id: msg.id, status: msg.status, ts: msg.ts };
  },
};

module.exports = Message;
