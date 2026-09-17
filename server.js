/**
 * server.js — Nexus communication app: Express API + Socket.io + static PWA.
 * Single process serves everything, so one `npm start` runs the full product.
 */
require('dotenv')?.config?.();
const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { initSocket } = require('./socketServer');
const authRoutes = require('./routes/authRoutes');
const chatRoutes = require('./routes/chatRoutes');
const authVerify = require('./middleware/authVerify');
const { makeRateLimiter } = require('./middleware/rateLimiter');
const { storageAdapter } = require('./config/cloudStorage');
const { save } = require('./dbConfig');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim());
const UPLOAD_DIR = require('./utils/mediaUpload').dest;

initSocket(server, CORS_ORIGINS.includes('*') ? true : CORS_ORIGINS);

/* ------------------------- security & parsing ------------------------- */

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(CORS_ORIGINS.includes('*') ? require('cors')() : require('cors')({ origin: CORS_ORIGINS }));

/* ------------------------------- API ------------------------------- */

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'Nexus', ts: Date.now() }));

// brute-force protection on credential endpoints
app.use('/api/auth', makeRateLimiter({ windowMs: 60_000, max: 20 }));
app.use('/api/auth', authRoutes);
app.use('/api', chatRoutes);

// gentle rate limit on uploads
app.use('/api/upload', makeRateLimiter({ windowMs: 60_000, max: 30 }));

/* ------------------------- static & uploads ------------------------- */

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR, { setHeaders: setStaticCache }));
function setStaticCache(res, filePath) {
  if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('manifest.json')) {
    res.set('Cache-Control', 'no-cache');
  } else if (/\/assets?\//.test(filePath)) {
    res.set('Cache-Control', 'public, max-age=604800');
  }
}

// hash-router SPA fallback (e.g. /u/1000001 -> index.html)
app.get(/^\/(?!api|uploads|socket\.io).*/, (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* ------------------------------- boot ------------------------------- */

server.listen(PORT, () => {
  console.log(`✔ Nexus running on http://localhost:${PORT}`);
  console.log(`  data dir : ${require('./dbConfig').DATA_DIR}`);
  console.log(`  uploads  : ${UPLOAD_DIR}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} received — flushing DB and shutting down…`);
    save();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

module.exports = { app, server }; // used by tests
