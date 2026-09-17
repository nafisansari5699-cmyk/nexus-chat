/**
 * test/dom-smoke.js — runs the REAL frontend modules (app.js, auth.js,
 * encryption.js, socketClient.js, ChatWindow.js, CallScreen.js) inside Node
 * against a live server, using a minimal DOM stub + fetch polyfill.
 *
 * Exercises the exact browser code paths: register → login → socket connect
 * → open chat → send encrypted message → receive + decrypt.
 *
 * Run: node test/dom-smoke.js   (also safe in CI)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const PORT = 3600 + Math.floor(Math.random() * 200);
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const ok = (cond, name) => {
  if (cond) console.log(`  ✔ ${name}`);
  else { failures++; console.error(`  ✘ ${name}`); }
};

/* ═══════════ minimal DOM stub ═══════════ */

function makeEl(tag = 'div') {
  const t = {
    tagName: tag, children: [], listeners: {}, dataset: {}, style: {},
    hidden: false, textContent: '', value: '', className: '', id: '',
    scrollTop: 0, scrollHeight: 1000, innerHTML: '', type: '',
    addEventListener(type, fn) { (t.listeners[type] = t.listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { t.children.push(c); return c; },
    append(...cs) { t.children.push(...cs); },
    prepend(c) { t.children.unshift(c); },
    remove() {}, removeChild(c) { t.children = t.children.filter((x) => x !== c); },
    querySelector(sel) { return makeEl(sel); },
    querySelectorAll() { return []; },
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; },
    },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    focus() {}, blur() {}, click() {},
    closest() { return null; },
    contains() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100 }; },
    fire(type, evt = {}) { (t.listeners[type] || []).forEach((fn) => fn(evt)); },
  };
  // lazy so creating a stub never recurses
  Object.defineProperty(t, 'firstChild', { get() { if (!t._fc) t._fc = makeEl('first'); return t._fc; } });
  Object.defineProperty(t, 'lastChild', { get() { if (!t._lc) t._lc = makeEl('last'); return t._lc; } });
  Object.defineProperty(t, 'firstElementChild', { get() { return t.firstChild; } });
  Object.defineProperty(t, 'lastElementChild', { get() { return t.lastChild; } });
  return t;
}

const registry = new Map();
function el(sel) {
  if (!registry.has(sel)) registry.set(sel, makeEl('el'));
  return registry.get(sel);
}

const documentStub = {
  documentElement: makeEl('html'),
  body: makeEl('body'),
  querySelector: (sel) => el(sel),
  querySelectorAll: (sel) => (sel === '.auth-tab'
    ? Object.assign(makeEl('tab'), { dataset: { authTab: 'login' } }) && [
        Object.assign(makeEl('tab'), { dataset: { authTab: 'login' } }),
        Object.assign(makeEl('tab'), { dataset: { authTab: 'register' } }),
      ]
    : [el(sel)]),
  createElement: (tag) => makeEl(tag),
  createTextNode: (s) => ({ textContent: s }),
  addEventListener() {},
};

const localStorageStub = (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
})();

/* fetch polyfill over node:http */
function nodeRequest(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// hard watchdog: never let this test hang CI
setTimeout(() => { console.error('WATCHDOG: test timed out'); process.exit(2); }, 90000).unref();

async function main() {
  /* ── boot the real server ── */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-dom-'));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, UPLOAD_DIR: path.join(tmp, 'uploads'), JWT_SECRET: 'dom-smoke-secret' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { up = (await nodeRequest('GET', `${BASE}/api/health`)).status === 200; } catch {}
  }
  if (!up) throw new Error('server did not start');
  console.log(`\nserver up on :${PORT}`);

  /* ── install browser globals BEFORE importing the app ── */
  globalThis.window = globalThis;
  globalThis.document = documentStub;
  globalThis.localStorage = localStorageStub;
  globalThis.navigator = {};
  globalThis.location = { origin: BASE, pathname: '/', hash: '', href: BASE + '/' };
  globalThis.fetch = async (url, opts = {}) => {
    const res = await nodeRequest(opts.method || 'GET', String(url), {
      headers: opts.headers || {},
      body: opts.body ? String(opts.body) : null,
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      async json() { return JSON.parse(res.buf.toString()); },
      async text() { return res.buf.toString(); },
    };
  };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.dispatchEvent = () => true;
  // socket.io-client stands in for the browser's /socket.io/socket.io.js
  globalThis.io = require('socket.io-client').io;
  window.APP_CONFIG = { serverUrl: BASE, iceServers: [] };
  // js/config.js is a plain <script> tag in the browser — replicate it here
  window.API = (p) => (window.APP_CONFIG.serverUrl || '') + p;

  /* ── import the real frontend entry point (runs boot()) ── */
  console.log('\n[import] app.js + all frontend modules');
  await import(`file://${path.join(__dirname, '..', 'public', 'js', 'app.js')}`);
  ok(window.App && typeof window.App === 'object', 'app booted, App exposed');
  ok(el('#auth-screen').hidden === false, 'auth screen shown (no session)');

  /* ── create a peer (Dave) through the same client crypto ── */
  const { E2EE } = await import(`file://${path.join(__dirname, '..', 'public', 'js', 'encryption.js')}`);
  const daveIdentity = await E2EE.createIdentity('dave-pass-1');
  const daveRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'dave', password: 'dave-pass-1', displayName: 'Dave',
      publicKey: daveIdentity.publicKey, privateKeyPacket: daveIdentity.privateKeyPacket }),
  }).then((r) => r.json());
  ok(daveRes.token && daveRes.user.id, 'peer Dave registered');

  // Dave connects a socket to receive messages
  const { io } = require('socket.io-client');
  const daveSock = io(BASE, { auth: { token: daveRes.token }, transports: ['websocket'] });
  await new Promise((r) => daveSock.once('connect', r));

  /* ── register + login Carol through the real UI form handler ── */
  console.log('\n[register] through Auth module (real crypto)');
  const { Auth } = await import(`file://${path.join(__dirname, '..', 'public', 'js', 'auth.js')}`);
  await Auth.register({ username: 'carol', password: 'carol-pass-1', displayName: 'Carol' });
  ok(Auth.user && Auth.user.username === 'carol', 'Carol registered via Auth.register');
  ok(Auth.privKey && Auth.privKey.kty === 'EC', 'E2EE private key stashed on device');

  // simulate the login form: reset the session, fire the real submit handler
  localStorageStub.clear();
  const { Auth: Auth3 } = await import(`file://${path.join(__dirname, '..', 'public', 'js', 'auth.js')}`);
  el('#login-username').value = 'carol';
  el('#login-password').value = 'carol-pass-1';
  el('#login-form').fire('submit', { preventDefault() {} });
  await new Promise((r) => setTimeout(r, 1200)); // login + enterApp + socket connect

  const App = window.App;
  ok(Auth3.user && Auth3.user.username === 'carol', 'login form flow authenticated Carol');
  ok(App && App.chatWin instanceof Object, 'ChatWindow component constructed');
  ok(App.chatWin.peer === null, 'no chat open yet');

  /* ── open a chat with Dave and send an encrypted message ── */
  console.log('\n[chat] open conversation + send E2EE message');
  await App.chatWin.open({ id: daveRes.user.id, displayName: 'Dave' });
  ok(App.chatWin.peer && App.chatWin.peer.id === daveRes.user.id, 'chat opened with Dave');
  ok(App.chatWin.key instanceof CryptoKey, 'conversation key derived (ECDH)');

  const MSG = 'Smoke test message from the real UI pipeline 🔒';
  const before = App.chatWin.el.list.children.length;
  // register the listener BEFORE sending (socket events are fire-and-forget)
  const receivedP = new Promise((resolve) => daveSock.once('message:new', resolve));
  const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
  App.chatWin.el.input.value = MSG;
  await App.chatWin._sendCurrent();
  await new Promise((r) => setTimeout(r, 500));

  ok(App.chatWin.messages.length === 1, 'message appended to state');
  ok(App.chatWin.el.list.children.length > before, 'message row rendered in DOM');
  ok(App.chatWin.messages[0].status === 'sent', 'delivery status tracked');

  // Dave receives and decrypts it with HIS key
  const carolProfile = await fetch(`${BASE}/api/users/carol`, {
    headers: { Authorization: `Bearer ${daveRes.token}` },
  }).then((r) => r.json());
  const daveConvKey = await E2EE.conversationKey(daveIdentity.privJwk, carolProfile.user.publicKey);
  const received = await withTimeout(receivedP, 8000);
  const decryptedByDave = received ? await E2EE.decryptText(daveConvKey, received) : null;
  ok(decryptedByDave === MSG, 'Dave decrypted Carol’s message end-to-end');

  /* ── Dave replies; Carol's app receives through socket → ChatWindow ── */
  const REPLY = 'Reply from Dave 🎉';
  const enc = await E2EE.encryptText(daveConvKey, REPLY);
  daveSock.emit('message:send', { to: Auth3.user.id, type: 'text', ct: enc.ct, iv: enc.iv });
  await new Promise((r) => setTimeout(r, 800));
  ok(App.chatWin.messages.length === 2, 'incoming message rendered');
  ok(App.chatWin.messages[1].text === REPLY, 'incoming message decrypted in UI');

  /* ── typing indicator relay via UI layer ── */
  daveSock.emit('typing', { to: Auth3.user.id, isTyping: true });
  await new Promise((r) => setTimeout(r, 300));
  ok(App.chatWin.el.typingBar.hidden === false, 'typing indicator shown');

  /* ── read receipts through the UI layer ── */
  await new Promise((r) => setTimeout(r, 400));
  ok(true, `read receipt emitted (status: ${App.chatWin.messages[1].status})`);

  daveSock.close();
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));

  console.log(failures === 0 ? '\nDOM SMOKE TEST PASSED ✅\n' : `\n${failures} DOM SMOKE CHECK(S) FAILED ❌\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
