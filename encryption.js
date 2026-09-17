/**
 * js/encryption.js — END-TO-END ENCRYPTION (Web Crypto API).
 *
 * Identity model (Telegram-style IDs + WhatsApp-style E2EE):
 *   1. Each device generates an ECDH P-256 keypair for the account.
 *   2. The PRIVATE key is wrapped (encrypted) with a key derived from the
 *      user's password via PBKDF2, and only the wrapped blob is stored on
 *      the server — the server never sees plaintext private keys.
 *   3. For every peer, both sides derive the same AES-GCM conversation key
 *      from ECDH(myPrivate, peerPublic). The server only relays ciphertext.
 *
 *   text  : AES-GCM(plaintext)
 *   media : file bytes encrypted with the same conversation key before upload
 */

const te = new TextEncoder();
const td = new TextDecoder();

const subtle = () => {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('This browser has no WebCrypto — E2EE unavailable. Use a modern browser.');
  }
  return window.crypto.subtle;
};

/* ── base64url helpers (for JWK fields) ── */
const b64 = {
  enc(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); },
  dec(str) { return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)).buffer; },
};

/* ── password-derived wrapping key ── */
async function passwordKey(password, salt) {
  const base = await subtle().importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export const E2EE = {
  /** Create a fresh E2EE identity: keypair + password-wrapped private key. */
  async createIdentity(password) {
    const kp = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
    const pubJwk = await subtle().exportKey('jwk', kp.publicKey);
    const privJwk = await subtle().exportKey('jwk', kp.privateKey);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wk = await passwordKey(password, salt);
    const wrapped = await subtle().encrypt(
      { name: 'AES-GCM', iv }, wk, te.encode(JSON.stringify(privJwk))
    );

    return {
      publicKey: pubJwk,
      privJwk,
      privateKeyPacket: {
        wrapped: b64.enc(wrapped),
        iv: b64.enc(iv),
        salt: b64.enc(salt),
      },
    };
  },

  /** Unwrap the stored private key with the password (at login). */
  async unwrapIdentity(packet, password) {
    const wk = await passwordKey(password, b64.dec(packet.salt));
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(b64.dec(packet.iv)) },
      wk, b64.dec(packet.wrapped)
    );
    return JSON.parse(td.decode(plain)); // private JWK
  },

  /** Cache the private JWK on this device for the session. */
  stashPrivateKey(privJwk) {
    localStorage.setItem('e2ee:privkey', JSON.stringify(privJwk));
  },
  getStashedPrivateKey() {
    try { return JSON.parse(localStorage.getItem('e2ee:privkey')); } catch { return null; }
  },
  clear() {
    localStorage.removeItem('e2ee:privkey');
  },

  /** Derive the AES-GCM conversation key shared with a peer. */
  async conversationKey(privJwk, peerPubJwk) {
    const priv = await subtle().importKey('jwk', privJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
    const pub = await subtle().importKey('jwk', peerPubJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return subtle().deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },

  /** Encrypt a message string -> {ct, iv} (base64). */
  async encryptText(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext));
    return { ct: b64.enc(ct), iv: b64.enc(iv) };
  },

  /** Decrypt a message {ct, iv} -> plaintext string. */
  async decryptText(key, { ct, iv }) {
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(b64.dec(iv)) },
      key, b64.dec(ct)
    );
    return td.decode(pt);
  },

  /** Encrypt raw media bytes -> {blob, iv} for uploading. */
  async encryptBytes(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { blob: new Blob([ct], { type: 'application/octet-stream' }), iv: b64.enc(iv) };
  },

  /** Decrypt downloaded media bytes. */
  async decryptBytes(key, buffer, ivB64) {
    return subtle().decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(b64.dec(ivB64)) },
      key, buffer
    );
  },
};
