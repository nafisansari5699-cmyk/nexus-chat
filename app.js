/**
 * js/app.js — application bootstrap & module initialization.
 * Wires together: auth → socket → chat list → ChatWindow → WebRTC calls
 * → PWA service worker → share-link routing (#/u/<id>).
 */
import { $, $$, api, toast, copyText, styleAvatar, fmtListTime, fmtDayChip } from './utils.js';
import { Auth } from './auth.js';
import { Socket } from './socketClient.js';
import { WebRTC } from './webrtc.js';
import { E2EE } from './encryption.js';
import { ChatWindow } from '../components/ChatWindow.js';
import { CallScreen } from '../components/CallScreen.js';

const App = window.App = {
  chats: [],
  onlineIds: new Set(),
  chatWin: null,
  callScreen: null,
  notifEnabled: false,
};

/* ════════════════ boot ════════════════ */

async function boot() {
  applyTheme(localStorage.getItem('cfg:theme') || 'dark');
  bindAuthUI();
  bindGlobalUI();
  registerServiceWorker();

  const ok = await Auth.restore();
  if (ok) await enterApp();
  else showAuthScreen();
}

function showAuthScreen() {
  $('#auth-screen').hidden = false;
  $('#app').hidden = true;
}

async function enterApp() {
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;

  renderMyProfileUI();

  App.chatWin = new ChatWindow({ myId: Auth.user.id, privKey: Auth.privKey });
  App.callScreen = new CallScreen();

  try {
    await Socket.connect(Auth.token);
  } catch (e) {
    toast('Real-time connection failed — check the server URL in Settings', 'err', 5000);
  }

  wireSocketEvents();
  wireCalls();

  await refreshChats();
  handleRoute();
  setInterval(refreshChats, 30000); // light background refresh
}

/* ════════════════ auth UI ════════════════ */

function bindAuthUI() {
  $$('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.auth-tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('#login-form').hidden = tab.dataset.authTab !== 'login';
      $('#register-form').hidden = tab.dataset.authTab !== 'register';
    });
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-submit');
    setBusy(btn, true);
    try {
      await Auth.login({
        username: $('#login-username').value.trim(),
        password: $('#login-password').value,
      });
      await enterApp();
    } catch (err) {
      showAuthError('#login-form', err.message);
    } finally { setBusy(btn, false); }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = $('#register-password').value, p2 = $('#register-password2').value;
    if (p1 !== p2) return showAuthError('#register-form', 'Passwords do not match');
    const btn = $('#register-submit');
    setBusy(btn, true);
    try {
      await Auth.register({
        username: $('#register-username').value.trim(),
        password: p1,
        displayName: $('#register-display').value.trim() || $('#register-username').value.trim(),
      });
      toast(`Welcome to Nexus! Your ID is ${Auth.user.id}`, 'ok', 4500);
      await enterApp();
    } catch (err) {
      showAuthError('#register-form', err.message);
    } finally { setBusy(btn, false); }
  });
}

function showAuthError(formSel, msg) {
  const p = $(`${formSel} .auth-error`);
  p.textContent = msg;
  p.hidden = false;
  setTimeout(() => { p.hidden = true; }, 6000);
}

function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.style.opacity = busy ? .6 : 1;
}

/* ════════════════ profile / global UI ════════════════ */

function renderMyProfileUI() {
  const u = Auth.user;
  styleAvatar($('#my-avatar'), u.displayName, u.id);
  $('#my-name').textContent = u.displayName;
  $('#my-id-chip').textContent = `ID ${u.id}`;
  styleAvatar($('#modal-avatar'), u.displayName, u.id);
  $('#modal-my-id').textContent = u.id;
  $('#modal-my-username').textContent = '@' + u.username;
  $('#profile-display').value = u.displayName;
  $('#profile-about').value = u.about || '';
  $('#modal-share-link').textContent = shareLink();
}

function shareLink() {
  return `${location.origin}${location.pathname}#/u/${Auth.user?.id ?? ''}`;
}

function bindGlobalUI() {
  // my ID chip → copy
  $('#my-id-chip').addEventListener('click', async () => {
    const ok = await copyText(String(Auth.user.id));
    toast(ok ? 'Your ID copied — share it so people can reach you' : 'Copy failed', ok ? 'ok' : 'err');
  });

  // sidebar buttons
  $('#btn-profile').addEventListener('click', () => openModal('profile-modal'));
  $('#btn-settings').addEventListener('click', () => {
    $('#server-url').value = window.APP_CONFIG.serverUrl;
    $('#notif-toggle').checked = App.notifEnabled;
    openModal('settings-modal');
  });
  $('#btn-theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });
  $('#btn-new-chat').addEventListener('click', () => {
    $('#new-chat-key').value = '';
    $('#new-chat-result').hidden = true;
    openModal('new-chat-modal');
    setTimeout(() => $('#new-chat-key').focus(), 60);
  });

  // modal close
  $$('[data-close-modal]').forEach((el) =>
    el.addEventListener('click', () => closeModal()));

  // profile save
  $('#btn-save-profile').addEventListener('click', async () => {
    try {
      await Auth.updateProfile({
        displayName: $('#profile-display').value.trim(),
        about: $('#profile-about').value.trim(),
      });
      renderMyProfileUI();
      closeModal();
      toast('Profile saved', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  });

  $('#btn-copy-link').addEventListener('click', async () => {
    const ok = await copyText(shareLink());
    toast(ok ? 'Share link copied' : 'Copy failed', ok ? 'ok' : 'err');
  });

  // new chat
  $('#btn-find-user').addEventListener('click', findAndOpenUser);
  $('#new-chat-key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') findAndOpenUser();
  });

  // settings
  $('#btn-save-settings').addEventListener('click', () => {
    const url = $('#server-url').value.trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//.test(url)) return toast('Server URL must start with http:// or https://', 'err');
    localStorage.setItem('cfg:server', url);
    if ($('#notif-toggle').checked) enableNotifications();
    closeModal();
    setTimeout(() => location.reload(), 350);
  });

  // chat header actions
  $('#btn-back').addEventListener('click', () => { App.chatWin?.close(); location.hash = ''; });
  $('#btn-chat-info').addEventListener('click', () => {
    const p = App.chatWin?.peer;
    if (!p) return;
    toast(`${p.displayName} · @${p.username} · ID ${p.id}`, '', 4000);
  });
  $('#btn-call-audio').addEventListener('click', () => startCall(false));
  $('#btn-call-video').addEventListener('click', () => startCall(true));

  // lightbox
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'lightbox' || e.target.id === 'lightbox-close') $('#lightbox').hidden = true;
  });

  // search
  $('#search-input').addEventListener('input', (e) => renderChatList(e.target.value.trim().toLowerCase()));

  // logout via double-click on theme? no — keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#lightbox').hidden) $('#lightbox').hidden = true;
      else closeModal();
    }
  });

  window.addEventListener('hashchange', handleRoute);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('cfg:theme', theme);
  $('#btn-theme').textContent = theme === 'light' ? '🌙' : '☀️';
}

function openModal(id) {
  $('#modal-root').hidden = false;
  for (const m of $$('.modal')) m.hidden = m.id !== id;
}
function closeModal() { $('#modal-root').hidden = true; }

/* ════════════════ socket wiring ════════════════ */

function wireSocketEvents() {
  Socket.on('presence:init', ({ online }) => {
    App.onlineIds = new Set(online);
    renderChatList($('#search-input').value.trim().toLowerCase());
  });
  Socket.on('presence', ({ id, online }) => {
    if (online) App.onlineIds.add(id); else App.onlineIds.delete(id);
    if (App.chatWin?.peer?.id === id) App.chatWin.onPresence({ id, online });
    renderChatList($('#search-input').value.trim().toLowerCase());
  });

  Socket.on('message:new', async (m) => {
    if (m.from === Auth.user.id) return; // own echo
    const isActive = App.chatWin?.peer && m.from === App.chatWin.peer.id;
    if (isActive) {
      await App.chatWin.onNewMessage(m);
      refreshChats();
    } else {
      notifyIncoming(m);
      refreshChats();
    }
  });

  Socket.on('message:delivered', ({ peer }) => {
    if (App.chatWin?.peer?.id === peer) App.chatWin.onStatus('delivered');
    updateChatPreviewStatus(peer, 'delivered');
  });
  Socket.on('message:read', ({ peer }) => {
    if (App.chatWin?.peer?.id === peer) App.chatWin.onStatus('read');
    updateChatPreviewStatus(peer, 'read');
  });

  Socket.on('typing', (p) => App.chatWin?.onTyping(p));
}

async function notifyIncoming(m) {
  const peer = App.chats.find((c) => c.peer.id === m.from)?.peer;
  if (peer && App.notifEnabled && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const title = `${peer.displayName} · Nexus`;
      if (reg) reg.showNotification(title, { body: '🔒 New encrypted message', tag: `nexus-${m.from}` });
      else new Notification(title, { body: '🔒 New encrypted message' });
    } catch { /* ignore */ }
  }
  beep();
}

/** Short UI blip for incoming messages when notifications are off. */
function beep() {
  try {
    App._ac = App._ac || new (window.AudioContext || window.webkitAudioContext)();
    const o = App._ac.createOscillator(), g = App._ac.createGain();
    o.frequency.value = 880; g.gain.value = .07;
    o.connect(g).connect(App._ac.destination);
    o.start();
    o.stop(App._ac.currentTime + .12);
  } catch { /* autoplay blocked */ }
}

async function enableNotifications() {
  if (!('Notification' in window)) return toast('Notifications not supported', 'err');
  const perm = await Notification.requestPermission();
  App.notifEnabled = perm === 'granted';
  toast(App.notifEnabled ? 'Notifications on' : 'Notifications blocked by browser', App.notifEnabled ? 'ok' : 'err');
}

/* ════════════════ chat list ════════════════ */

async function refreshChats() {
  try {
    const res = await api('/api/chats');
    App.chats = res.chats;
    renderChatList($('#search-input').value.trim().toLowerCase());
  } catch (e) {
    if (e.status === 401) { Auth.logout(false); showAuthScreen(); }
  }
}

function previewOf(c) {
  if (!c.last) return 'Say hi 👋';
  const mine = c.last.from === Auth.user.id;
  const tag = mine ? 'You: ' : '';
  if (c.last.type === 'text') return tag + (previewCache[c.last.id] || 'Encrypted message');
  if (c.last.type === 'image') return tag + '🖼️ Photo';
  if (c.last.type === 'voice') return tag + '🎙️ Voice note';
  return tag + '📎 ' + (c.last.attachment?.name || 'File');
}

/** The last-message preview is only decryptable from history; fetch it lazily once. */
const previewCache = {};
async function hydratePreviews() {
  for (const c of App.chats) {
    if (c.last?.type === 'text' && !previewCache[c.last.id]) {
      try {
        const res = await api(`/api/chats/${c.peer.id}?limit=1`);
        const last = res.messages[res.messages.length - 1];
        if (last) {
          const key = await E2EE.conversationKey(Auth.privKey, c.peer.publicKey || res.peer.publicKey);
          try { previewCache[last.id] = (await E2EE.decryptText(key, last)).slice(0, 60); } catch {}
          c.peer = { ...c.peer, publicKey: c.peer.publicKey || res.peer.publicKey };
        }
      } catch { /* offline */ }
    }
  }
  renderChatList($('#search-input').value.trim().toLowerCase());
}

function renderChatList(filter = '') {
  const list = $('#chat-list');
  const chats = App.chats.filter((c) => {
    if (!filter) return true;
    return (c.peer.displayName || '').toLowerCase().includes(filter)
      || (c.peer.username || '').toLowerCase().includes(filter)
      || String(c.peer.id).includes(filter);
  });

  if (!App.chats.length) {
    list.innerHTML = `<div id="chat-list-empty" class="list-empty">
      <p>No chats yet</p><span>Share your ID ${Auth.user?.id ?? ''} or add someone by theirs to start talking.</span></div>`;
    return;
  }

  list.innerHTML = '';
  for (const c of chats) {
    const item = document.createElement('div');
    item.className = 'chat-item';
    item.dataset.peer = c.peer.id;
    if (App.chatWin?.peer?.id === c.peer.id) item.classList.add('active');
    item.innerHTML = `
      <span class="avatar" data-online="${App.onlineIds.has(c.peer.id) ? 1 : 0}"></span>
      <div class="chat-item-body">
        <div class="chat-item-top">
          <span class="chat-item-name"></span>
          <span class="chat-item-time">${fmtListTime(c.last?.ts)}</span>
        </div>
        <div class="chat-item-bottom">
          <span class="chat-item-preview">${previewOf(c)}</span>
          ${c.unread ? `<span class="badge">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
        </div>
      </div>`;
    const av = item.querySelector('.avatar');
    styleAvatar(av, c.peer.displayName, c.peer.id);
    item.querySelector('.chat-item-name').textContent = c.peer.displayName;
    item.addEventListener('click', () => openChatWith(c.peer));
    list.appendChild(item);
  }
}

function updateChatPreviewStatus(peerId, status) {
  const item = $(`#chat-list .chat-item[data-peer="${peerId}"]`);
  if (item) refreshChats();
}

async function openChatWith(peer) {
  try {
    if (!peer.publicKey || !peer.id) {
      const res = await api(`/api/users/${peer.id ?? peer}`);
      peer = res.user;
    }
    location.hash = `#/u/${peer.id}`;
    await App.chatWin.open(peer);
    renderChatList($('#search-input').value.trim().toLowerCase());
    hydratePreviews(); // non-blocking
  } catch (e) {
    toast(e.message || 'Could not open chat', 'err');
  }
}

async function findAndOpenUser() {
  const key = $('#new-chat-key').value.trim();
  if (!key) return;
  const box = $('#new-chat-result');
  box.hidden = true;
  try {
    const res = await api(`/api/users/${encodeURIComponent(key)}`);
    const u = res.user;
    if (u.id === Auth.user.id) return toast('That is you 🙂', '');
    box.hidden = false;
    box.innerHTML = '';
    const av = document.createElement('span');
    av.className = 'avatar';
    styleAvatar(av, u.displayName, u.id);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<b></b><span></span>`;
    meta.querySelector('b').textContent = u.displayName;
    meta.querySelector('span').textContent = `@${u.username} · ID ${u.id}`;
    const go = document.createElement('button');
    go.className = 'btn btn-primary';
    go.style.marginLeft = 'auto';
    go.textContent = 'Chat';
    go.addEventListener('click', () => { closeModal(); openChatWith(u); });
    box.append(av, meta, go);
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ════════════════ routing (#/u/<id>) ════════════════ */

async function handleRoute() {
  const m = location.hash.match(/^#\/u\/(\d+)$/);
  if (m && Auth.user) {
    const id = Number(m[1]);
    if (id === Auth.user.id) return;
    if (App.chatWin?.peer?.id !== id) {
      try {
        const res = await api(`/api/users/${id}`);
        await App.chatWin.open(res.user);
        renderChatList('');
        hydratePreviews();
      } catch (e) {
        toast(e.message, 'err');
        location.hash = '';
      }
    }
  }
}

/* ════════════════ calls ════════════════ */

function wireCalls() {
  WebRTC.ui = App.callScreen;
  WebRTC.init();
  WebRTC.onEnd = () => {};

  App.callScreen.hooks = {
    onAccept: () => WebRTC.accept(),
    onReject: () => WebRTC.reject(),
    onHangup: () => WebRTC.hangup(),
    onToggleMute: () => WebRTC.toggleMute(),
    onToggleCam: () => WebRTC.toggleCam(),
  };

  // fill caller info on incoming/outgoing
  const origStart = WebRTC.startCall.bind(WebRTC);
  const origOffer = WebRTC.handleOffer.bind(WebRTC);
  WebRTC.startCall = async (...a) => {
    App.callScreen.setPeerInfo(a[0]);
    await origStart(...a);
    App.callScreen.setLocalStream(WebRTC.localStream);
  };
  WebRTC.handleOffer = async (...a) => {
    await origOffer(...a);
    const peer = App.chats.find((c) => c.peer.id === WebRTC.peer?.id)?.peer;
    App.callScreen.setPeerInfo(peer || WebRTC.peer);
  };
  const origAccept = WebRTC.accept.bind(WebRTC);
  WebRTC.accept = async (...a) => {
    await origAccept(...a);
    App.callScreen.setLocalStream(WebRTC.localStream);
  };
}

async function startCall(video) {
  const peer = App.chatWin?.peer;
  if (!peer) return;
  if (WebRTC.isBusy()) return toast('Already in a call', 'err');
  try {
    await WebRTC.startCall(peer, video);
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ════════════════ PWA ════════════════ */

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // iOS PWA install hint
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    App.installEvt = e;
  });
}

boot();
