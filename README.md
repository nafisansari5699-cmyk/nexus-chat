# Nexus — Private Messenger (PWA)

A **WhatsApp + Telegram hybrid** progressive web app:

- **Telegram-style identity** — every user gets a permanent numeric ID and a shareable profile link (`…/#/u/1000001`). No phone number needed, ever.
- **WhatsApp-style real-time chat** — instant delivery over WebSockets, typing indicators, sent/delivered/read ticks, online presence, emoji, images, documents, and voice notes.
- **True end-to-end encryption (E2EE)** — every device generates an ECDH P-256 keypair; each conversation derives its own AES-GCM key. The server stores and relays **ciphertext only** — it can never read your messages or media.
- **Peer-to-peer voice & video calls** — WebRTC with STUN servers; media flows directly between browsers, never through the app server.
- **PWA** — installs to the home screen, caches the app shell for offline loading, and shows notifications while running.

**Stack:** Vanilla JS (no build step) · Express + Socket.io · JSON file DB (zero-config, swappable) · Web Crypto API · WebRTC.

---

## 🚀 Quick start (local)

```bash
git clone <your-repo> nexus-chat && cd nexus-chat
npm install
npm start
# open http://localhost:3000 — register two accounts in two browser
# profiles/windows and start chatting + calling
```

No environment variables needed for local development.

## ☁️ Deployment

This app has a **Node backend** (WebSockets, upload API, storage). Static-only hosts (GitHub Pages, plain Netlify) **cannot run the backend**, so use one of these:

| Where | What you get | How |
|---|---|---|
| **Render** (recommended) | Full app, one URL, free tier | Push to GitHub → render.com → **New → Blueprint** → pick the repo (uses `render.yaml`). Or New Web Service: build `npm ci --omit=dev`, start `npm start`. |
| **Railway / Fly.io** | Full app | Build `npm ci --omit=dev`, start `npm start`, expose `$PORT`. |
| **Docker / VPS** | Full app | `docker build -t nexus . && docker run -p 3000:3000 -v nexus-data:/app/data -v nexus-uploads:/app/uploads nexus` (or `docker-compose up`) |
| **Netlify** | Frontend **only** | Deploys `public/` (see `netlify.toml`). Then host the backend on Render and enter its URL in the app: **Settings → Server URL**. |
| **GitHub Pages** | Frontend **only** | Publish the `public/` folder, then set the backend URL the same way (Settings → Server URL inside the app). |

> Note on Render's free tier: the service sleeps after inactivity and the disk is ephemeral — data resets on redeploys. For persistence use a paid plan (the `render.yaml` attaches a 1 GB disk) or plug a real database into `models/`.

## 🔐 Security model — what is and isn't protected

**Protected:**
- Message text and media are encrypted **in the browser** with conversation keys derived via ECDH; the server only ever sees ciphertext.
- Passwords are bcrypt-hashed; private keys are wrapped with a password-derived AES-GCM key (PBKDF2, 150k iterations) before storage.
- Uploads are opaque encrypted blobs at unguessable URLs; media is decrypted client-side.
- JWT auth on every API route and socket; rate-limiting on auth + upload endpoints.

**Known limits of this reference implementation** (hardening notes if you take it to production):
- No TURN server configured — calls can fail behind strict corporate/carrier NATs. Add one via `js/config.js` or `.env`.
- Background push requires FCM keys (see `config/fcmSetup.js` — currently notifications fire while the app is running).
- The JSON file DB is single-process; swap `models/` for MongoDB/Postgres for scale.
- Private keys are stashed in `localStorage` for the session — a hardened build would use IndexedDB + device-bound keys.
- Endpoints for message content are relayed, not authenticated end-to-end (the server could drop or replay ciphertext; it cannot forge or read it).

## 📁 Project structure

```
├── public/                    # PWA frontend (static)
│   ├── index.html             # app shell & entry point
│   ├── style.css              # UI styling & responsive rules
│   ├── manifest.json          # PWA config (name, icons, display)
│   ├── sw.js                  # service worker: offline caching
│   ├── _headers               # security headers for Netlify
│   ├── js/
│   │   ├── app.js             # bootstrap & module init
│   │   ├── auth.js            # register/login, JWT & session
│   │   ├── socketClient.js    # WebSocket connection management
│   │   ├── webrtc.js          # P2P audio/video calling
│   │   ├── encryption.js      # end-to-end encryption (Web Crypto)
│   │   ├── config.js          # runtime config (server URL, STUN)
│   │   └── utils.js           # helpers
│   ├── components/
│   │   ├── ChatWindow.js      # chat UI component
│   │   └── CallScreen.js      # call UI component
│   └── assets/                # icons & ringtone
├── server.js                  # Express entry point
├── socketServer.js            # WebSocket signaling server
├── dbConfig.js                # zero-config JSON database
├── models/User.js             # user schema & access
├── models/Message.js          # message schema & access (ciphertext)
├── routes/authRoutes.js       # /api/auth/*
├── routes/chatRoutes.js      # /api/chats, /api/users, /api/upload
├── middleware/authVerify.js   # JWT validation
├── middleware/rateLimiter.js  # anti-spam / brute-force guard
├── utils/mediaUpload.js       # multer upload handler
├── config/cloudStorage.js    # storage adapter (local + S3 sketch)
├── config/fcmSetup.js         # push notification config (stub)
├── test/e2e.js                # API + socket + E2EE test suite
├── Dockerfile · render.yaml · netlify.toml
├── .github/workflows/main.yml # CI/CD pipeline
└── .env.example               # environment variables
```

## 🔌 API summary

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | create account (gets numeric ID) |
| POST | `/api/auth/login` | obtain JWT |
| GET/PATCH | `/api/auth/me` | profile read/update |
| GET | `/api/chats` | conversation list + unread counts |
| GET | `/api/chats/:peerId` | message history (ciphertext, decrypted client-side) |
| GET | `/api/users/:idOrUsername` | public profile lookup |
| POST | `/api/upload` | upload encrypted media blob |
| WS | `message:send/new/delivered/read`, `typing`, `presence`, `call:*` | real-time events |

## 🧪 Tests

```bash
npm test
```

Runs an end-to-end suite on a throwaway server instance: registers two users, logs in, derives both E2EE keys, encrypts/decrypts messages through the real socket relay, uploads an encrypted blob, and verifies history + read receipts.

## ⚙️ Environment variables

See [`.env.example`](.env.example) — `PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `DATA_DIR`, `UPLOAD_DIR`, `CORS_ORIGINS`, `MAX_UPLOAD_MB`, `PUBLIC_URL`, optional `TURN_*`.

---

Made as a complete, deployable reference implementation of the Communication App blueprint. Fork it, rebrand it, ship it. 🚀
