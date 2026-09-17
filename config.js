/**
 * js/config.js — runtime configuration (plain script, loaded before modules).
 * serverUrl: "" → same origin (default when frontend+backend are deployed together).
 * Override via Settings UI (saved in localStorage) or by editing below.
 */
window.APP_CONFIG = {
  serverUrl: localStorage.getItem('cfg:server') || '',
  // STUN helps callers find each other across home routers. Add a TURN server
  // here (or via .env on the server) for carrier-grade NAT traversal.
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

/** Resolve a possibly-relative path against the backend base. */
window.API = function API(p) {
  return (window.APP_CONFIG.serverUrl || '') + p;
};
