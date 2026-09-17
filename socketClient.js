/**
 * js/socketClient.js — real-time layer.
 * Loads the Socket.io client from the backend origin, connects with the JWT,
 * and exposes a small event bus for the rest of the app.
 */

let socket = null;

/** Dynamically load /socket.io/socket.io.js from the configured backend. */
function loadClientScript() {
  return new Promise((resolve, reject) => {
    if (window.io) return resolve();
    const s = document.createElement('script');
    s.src = window.API('/socket.io/socket.io.js');
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load real-time client from server'));
    document.head.appendChild(s);
  });
}

export const Socket = {
  connected: false,
  handlers: new Map(),

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  },

  emit(event, payload) {
    if (!socket) return;
    socket.emit(event, payload);
  },

  /** Promise-based request/response for message:send acks. */
  emitWithAck(event, payload) {
    return new Promise((resolve) => {
      if (!socket) return resolve({ error: 'not connected' });
      socket.timeout(10000).emit(event, payload, (err, resp) => {
        if (err) return resolve({ error: 'timeout' });
        if (resp && resp.error) return resolve(resp);
        resolve(resp || {});
      });
    });
  },

  async connect(token) {
    await loadClientScript();
    return new Promise((resolve, reject) => {
      socket = window.io(window.APP_CONFIG.serverUrl || undefined, {
        auth: { token },
        reconnectionDelayMax: 8000,
      });

      socket.on('connect', () => {
        this.connected = true;
        resolve(socket);
      });
      socket.on('disconnect', () => { this.connected = false; });
      socket.on('connect_error', (err) => {
        this.connected = false;
        reject(err);
      });

      // fan out every server event to registered handlers
      for (const ev of [
        'message:new', 'message:delivered', 'message:read',
        'typing', 'presence', 'presence:init',
        'call:offer', 'call:answer', 'call:ice', 'call:reject', 'call:end',
      ]) {
        socket.on(ev, (payload) => {
          for (const fn of this.handlers.get(ev) || []) {
            try { fn(payload); } catch (e) { console.error(`[socket] handler for ${ev} failed`, e); }
          }
        });
      }
    });
  },

  disconnect() {
    if (socket) socket.disconnect();
    socket = null;
    this.connected = false;
  },
};
