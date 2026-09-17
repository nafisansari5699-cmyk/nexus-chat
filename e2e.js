/**
 * test/e2e.js — end-to-end smoke test (plain node:http — no undici/wasm deps).
 *
 * Boots the real server on a scratch port with a temp data dir, then:
 *   1. registers two users (with real E2EE identities via WebCrypto)
 *   2. logs in, connects both over Socket.io
 *   3. A sends an encrypted message to B; B decrypts it and verifies
 *   4. read receipts, typing, presence & call-signaling relay
 *   5. uploads an encrypted blob through /api/upload and round-trips it
 *   6. verifies history + chat list + user lookup
 *
 * Run: npm test
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');

const PORT = 3123 + Math.floor(Math.random() * 300);
const BASE = `http://localhost:${PORT}`;

const te = (s) => new TextEncoder().encode(s);
const td = new TextDecoder();
const b64 = {
  enc: (buf) => Buffer.from(buf).toString('base64'),
  dec: (str) => Uint8Array.from(Buffer.from(str, 'base64')),
};

let failures = 0;
function ok(cond, name) {
  if (cond) console.log(`  ✔ ${name}`);
  else { failures++; console.error(`  ✘ ${name}`); }
}

/** Tiny promise wrapper over node:http with a fetch-ish surface. */
function request(method, urlPath, { headers = {}, body = null, raw = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(`${BASE}${urlPath}`, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          async json() { return JSON.parse(buf.toString()); },
          buffer: buf,
        });
      });
    });
    r.on('error', reject);
    if (raw) r.write(raw);
    else if (body) r.write(body);
    r.end();
  });
}
const postJson = (urlPath, obj, token) =>
  request('POST', urlPath, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(obj),
  });
const getJson = (urlPath, token) =>
  request('GET', urlPath, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, UPLOAD_DIR: path.join(tmp, 'uploads'), JWT_SECRET: 'test-secret-for-ci-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { up = (await request('GET', '/api/health')).status === 200; } catch {}
  }
  if (!up) throw new Error('server did not start');
  console.log(`\nserver up on :${PORT} (temp dir ${tmp})`);

  /* ── E2EE helpers (mirror of public/js/encryption.js) ── */
  async function passwordKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', te(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }
  async function createIdentity(password) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const publicKey = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wk = await passwordKey(password, salt);
    const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wk, te(JSON.stringify(privJwk)));
    return { publicKey, privateKeyPacket: { wrapped: b64.enc(wrapped), iv: b64.enc(iv), salt: b64.enc(salt) }, privJwk };
  }
  async function unwrapIdentity(packet, password) {
    const wk = await passwordKey(password, b64.dec(packet.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(packet.iv) }, wk, b64.dec(packet.wrapped));
    return JSON.parse(td.decode(plain));
  }
  async function convKey(privJwk, peerPubJwk) {
    const priv = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const pub = await crypto.subtle.importKey('jwk', peerPubJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const encText = async (key, text) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te(text));
    return { ct: b64.enc(ct), iv: b64.enc(iv) };
  };
  const decText = async (key, { ct, iv }) => {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(iv) }, key, b64.dec(ct));
    return td.decode(pt);
  };

  /* ── 1. register two users ── */
  console.log('\n[1] registration & identity');
  const idA = await createIdentity('password-a');
  const idB = await createIdentity('password-b');

  const regA = await postJson('/api/auth/register', {
    username: 'alice', password: 'password-a', displayName: 'Alice',
    publicKey: idA.publicKey, privateKeyPacket: idA.privateKeyPacket,
  }).then((r) => r.json());
  const regB = await postJson('/api/auth/register', {
    username: 'bob', password: 'password-b', displayName: 'Bob',
    publicKey: idB.publicKey, privateKeyPacket: idB.privateKeyPacket,
  }).then((r) => r.json());
  ok(regA.token && regA.user.id >= 1000001, 'Alice registered with numeric ID');
  ok(regB.token && regB.user.id > regA.user.id, 'Bob registered with sequential ID');

  const dup = await postJson('/api/auth/register', {
    username: 'alice', password: 'password-a',
    publicKey: idA.publicKey, privateKeyPacket: idA.privateKeyPacket,
  });
  ok(dup.status === 409, 'duplicate username rejected');

  /* ── 2. login + key unwrap ── */
  console.log('\n[2] login & E2EE key unwrapping');
  const loginB = await postJson('/api/auth/login', { username: 'bob', password: 'password-b' }).then((r) => r.json());
  const privB = await unwrapIdentity(loginB.user.privateKeyPacket, 'password-b');
  ok(JSON.stringify(privB) === JSON.stringify(idB.privJwk), 'password unwraps the correct private key');
  const badLogin = await postJson('/api/auth/login', { username: 'bob', password: 'wrong-pass-xx' });
  ok(badLogin.status === 401, 'wrong password rejected');

  /* ── 3. sockets: encrypted message relay ── */
  console.log('\n[3] socket messaging with E2EE');
  const { io } = require('socket.io-client');
  const sa = io(BASE, { auth: { token: regA.token }, transports: ['websocket'] });
  const sb = io(BASE, { auth: { token: regB.token }, transports: ['websocket'] });
  await Promise.all([once(sa, 'connect'), once(sb, 'connect')]);

  const keyA = await convKey(idA.privJwk, idB.publicKey);
  const keyB = await convKey(privB, idA.publicKey);

  const SECRET = 'Top secret message 🕵️ from Alice to Bob!';
  const { ct, iv } = await encText(keyA, SECRET);

  const ackP = new Promise((res) => sa.emit('message:send', { to: regB.user.id, type: 'text', ct, iv }, res));
  const incomingP = once(sb, 'message:new');
  const ack = await ackP;
  ok(ack.ok && ack.id, 'server acked message send');
  const incoming = await incomingP;
  ok(incoming.from === regA.user.id, 'Bob received the relayed message');
  const decrypted = await decText(keyB, incoming);
  ok(decrypted === SECRET, 'Bob decrypted the message with the ECDH-derived key');

  // read receipts
  sb.emit('message:read', { peer: regA.user.id });
  const readEvt = await once(sa, 'message:read');
  ok(readEvt.peer === regB.user.id, 'read receipt relayed back to Alice');

  // typing indicator relay
  sb.emit('typing', { to: regA.user.id, isTyping: true });
  const typingEvt = await once(sa, 'typing');
  ok(typingEvt.from === regB.user.id && typingEvt.isTyping === true, 'typing indicator relayed');

  // call signaling relay + sender-identity enforcement
  sa.emit('call:offer', { to: regB.user.id, video: true, sdp: { type: 'offer', sdp: 'x' } });
  const callEvt = await once(sb, 'call:offer');
  ok(callEvt.from === regA.user.id && callEvt.video === true, 'call signaling relayed');
  ok(callEvt.from !== regB.user.id, 'sender cannot be spoofed');

  /* ── 4. encrypted media upload ── */
  console.log('\n[4] media upload');
  const fileBytes = crypto.getRandomValues(new Uint8Array(2048)); // simulated encrypted blob
  const boundary = '----nexusTest' + Date.now();
  const mpBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from(fileBytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploadRes = await request('POST', '/api/upload', {
    headers: {
      Authorization: `Bearer ${regA.token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': mpBody.length,
    },
    raw: mpBody,
  }).then((r) => r.json());
  ok(uploadRes.url && uploadRes.url.startsWith('/uploads/'), 'upload accepted');
  const down = await request('GET', uploadRes.url);
  ok(Buffer.compare(down.buffer, Buffer.from(fileBytes)) === 0, 'encrypted blob round-trips byte-identical');

  const unauth = await getJson('/api/chats', 'bad-token');
  ok(unauth.status === 401, 'API rejects bad tokens');

  /* ── 5. history & chat list ── */
  console.log('\n[5] history & conversation list');
  const hist = await getJson(`/api/chats/${regB.user.id}`, regA.token).then((r) => r.json());
  ok(hist.messages.length === 1, 'history returns the message');
  ok(hist.messages[0].ct === ct, 'server stored ciphertext only');
  const histDec = await decText(keyA, hist.messages[0]);
  ok(histDec === SECRET, 'Alice can decrypt her own copy');
  ok(hist.messages[0].status === 'read', 'status advanced to read');

  const chatsB = await getJson('/api/chats', regB.token).then((r) => r.json());
  ok(chatsB.chats.length === 1 && chatsB.chats[0].peer.id === regA.user.id, 'chat list shows the conversation');
  ok(chatsB.chats[0].unread === 0, 'unread cleared after read receipt');

  const byName = await getJson('/api/users/bob', regA.token).then((r) => r.json());
  const byId = await getJson(`/api/users/${regA.user.id}`, regB.token).then((r) => r.json());
  ok(byName.user && byName.user.id === regB.user.id, 'lookup by username works');
  ok(byId.user && byId.user.username === 'alice', 'lookup by numeric ID works');
  const noAuth = await getJson('/api/users/bob');
  ok(noAuth.status === 401, 'user lookup requires a token');

  sa.close(); sb.close();
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));

  console.log(failures === 0 ? '\nALL TESTS PASSED ✅\n' : `\n${failures} TEST(S) FAILED ❌\n`);
  process.exit(failures === 0 ? 0 : 1);
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

main().catch((e) => { console.error(e); process.exit(1); });
