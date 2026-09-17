/**
 * js/auth.js — registration, login, JWT & session management.
 * On success the E2EE private key is stashed locally (never on server in plaintext).
 */
import { api, toast } from './utils.js';
import { E2EE } from './encryption.js';

const TOKEN_KEY = 'auth:token';
const USER_KEY = 'auth:user';

export const Auth = {
  user: null,       // { id, username, displayName, about, publicKey }
  privKey: null,    // private JWK (stashed)

  get token() { return localStorage.getItem(TOKEN_KEY); },

  async register({ username, password, displayName }) {
    const identity = await E2EE.createIdentity(password);
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username, password, displayName,
        publicKey: identity.publicKey,
        privateKeyPacket: identity.privateKeyPacket,
      }),
    });
    this._save(res, identity.privJwk);
    return res.user;
  },

  async login({ username, password }) {
    // step 1: authenticate -> get token + wrapped key packet
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    // step 2: unwrap the E2EE private key locally with the password
    const privJwk = await E2EE.unwrapIdentity(res.user.privateKeyPacket, password);
    this._save(res, privJwk);
    return res.user;
  },

  _save({ token, user }, privJwk) {
    const { privateKeyPacket, ...publicUser } = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(publicUser));
    this.user = publicUser;
    this.privKey = privJwk || E2EE.getStashedPrivateKey();
    if (privJwk) E2EE.stashPrivateKey(privJwk);
    if (!this.privKey) throw new Error('Encryption key missing on this device — please log in with your password once.');
  },

  /** Restore a persisted session (page reload). */
  async restore() {
    if (!this.token) return false;
    try {
      const res = await api('/api/auth/me');
      const { privateKeyPacket, ...publicUser } = res.user;
      this.user = publicUser;
      localStorage.setItem(USER_KEY, JSON.stringify(publicUser));
      this.privKey = E2EE.getStashedPrivateKey();
      return !!this.privKey;
    } catch (err) {
      if (err.status === 401) this.logout(false);
      return false;
    }
  },

  async updateProfile({ displayName, about }) {
    const res = await api('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName, about }),
    });
    this.user = { ...this.user, ...res.user };
    localStorage.setItem(USER_KEY, JSON.stringify(this.user));
    return this.user;
  },

  logout(notify = true) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    E2EE.clear();
    this.user = null;
    this.privKey = null;
    if (notify) toast('Logged out', 'ok');
    location.hash = '';
  },
};
