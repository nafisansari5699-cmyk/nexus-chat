/**
 * socketServer.js — WebSocket layer (Socket.io).
 *
 *  - JWT-authenticated connections, one personal room per user ("user:<id>")
 *  - Real-time message relay + persistence (ciphertext only)
 *  - Delivery & read receipts, typing indicators, presence
 *  - WebRTC signaling relay for voice/video calls
 */
const { Server } = require('socket.io');
const authVerify = require('./middleware/authVerify');
const User = require('./models/User');
const Message = require('./models/Message');
const { save } = require('./dbConfig');

const CALL_EVENTS = ['call:offer', 'call:answer', 'call:ice', 'call:reject', 'call:end'];

function initSocket(httpServer, corsOrigins) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 2e6,
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  const online = new Map(); // userId -> Set<socketId>

  const broadcastPresence = (userId) => {
    const user = User.findById(userId);
    io.emit('presence', {
      id: userId,
      online: online.has(userId),
      lastSeen: user ? user.lastSeen : Date.now(),
    });
  };

  io.use((socket, next) => {
    try {
      const payload = authVerify.verifySocketToken(socket.handshake.auth && socket.handshake.auth.token);
      socket.userId = payload.sub;
      socket.username = payload.username;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    socket.join(`user:${userId}`);

    if (!online.has(userId)) online.set(userId, new Set());
    online.get(userId).add(socket.id);
    if (online.get(userId).size === 1) broadcastPresence(userId);

    // let the client know who is online right now
    socket.emit('presence:init', { online: [...online.keys()] });

    /* ---------------- messaging ---------------- */

    socket.on('message:send', (payload = {}, ack) => {
      try {
        const { to, type, ct, iv, attachment } = payload;
        if (!to || !ct || !iv) return ack && ack({ error: 'invalid payload' });
        const peer = User.findById(to);
        if (!peer) return ack && ack({ error: 'recipient not found' });

        const msg = Message.create({ from: userId, to: peer.id, type, ct, iv, attachment });
        io.to(`user:${peer.id}`).emit('message:new', msg);
        ack && ack({ ok: true, id: msg.id, ts: msg.ts });
      } catch (err) {
        ack && ack({ error: err.message || 'failed' });
      }
    });

    socket.on('message:delivered', ({ peer } = {}) => {
      if (!peer) return;
      const n = Message.markDelivered(userId, peer);
      if (n) io.to(`user:${peer}`).emit('message:delivered', { peer: userId });
    });

    socket.on('message:read', ({ peer } = {}) => {
      if (!peer) return;
      const n = Message.markRead(userId, peer);
      if (n) io.to(`user:${peer}`).emit('message:read', { peer: userId });
    });

    socket.on('typing', ({ to, isTyping } = {}) => {
      if (!to) return;
      io.to(`user:${to}`).emit('typing', { from: userId, isTyping: !!isTyping });
    });

    /* ---------------- call signaling (WebRTC relay) ---------------- */

    for (const event of CALL_EVENTS) {
      socket.on(event, (payload = {}) => {
        const { to, from } = payload;
        if (!to || (from && Number(from) !== userId)) return; // cannot spoof sender
        io.to(`user:${to}`).emit(event, { ...payload, from: userId });
      });
    }

    socket.on('disconnect', () => {
      const set = online.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          online.delete(userId);
          User.touch(userId);
          broadcastPresence(userId);
        }
      }
    });
  });

  return io;
}

module.exports = { initSocket };
