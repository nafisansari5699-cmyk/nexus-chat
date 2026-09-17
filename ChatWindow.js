/**
 * components/ChatWindow.js — the chat interface: history, bubbles, media,
 * voice notes, typing, receipts, composer.
 */
import { api, toast, fmtTime, fmtDayChip, fmtBytes, linkify, isEmojiOnly, styleAvatar, $, escapeHtml } from '../js/utils.js';
import { Socket } from '../js/socketClient.js';
import { E2EE } from '../js/encryption.js';

const EMOJIS = ['😀','😂','🥹','😊','😍','🤔','😴','🤗','😅','🙄','😎','🥳','😢','😭','😡','🤯','🥺','😬','👍','👎','🙏','👏','💪','🤝','✌️','🫶','❤️','🧡','💚','💙','💜','🔥','✨','🎉','🎂','🎁','☕','🍕','⚽','🏏','🎮','🎵','📱','💻','🌍','☀️','🌙','⚡','💡','💰','✅','❌','⏰','🚀','🛸','🌈','🦋','🌸','🐶','🐱','👩','👨'];

export class ChatWindow {
  constructor(deps) {
    this.deps = deps;         // { myId, privKey, onPeerInfo }
    this.peer = null;
    this.key = null;          // AES-GCM conversation key
    this.messages = [];
    this.oldestTs = null;
    this.hasMore = true;
    this.typingTimer = null;
    this.el = {
      empty: $('#chat-empty'),
      active: $('#chat-active'),
      header: $('#chat-header'),
      avatar: $('#peer-avatar'),
      name: $('#peer-name'),
      status: $('#peer-status'),
      list: $('#messages'),
      typingBar: $('#typing-bar'),
      typingAvatar: $('#typing-avatar'),
      input: $('#composer-input'),
      send: $('#btn-send'),
      mic: $('#btn-mic'),
      emoji: $('#btn-emoji'),
      emojiPanel: $('#emoji-panel'),
      attach: $('#btn-attach'),
      attachMenu: $('#attach-menu'),
      recBar: $('#recording-bar'),
      recTimer: $('#rec-timer'),
      recCancel: $('#btn-rec-cancel'),
      recSend: $('#btn-rec-send'),
    };

    this._buildEmojiPanel();
    this._bindComposer();
    this._bindScroll();
  }

  /* ─────────────── open / close ─────────────── */

  async open(peer) {
    this.peer = peer;
    this.messages = [];
    this.el.list.innerHTML = '';
    this.oldestTs = null;
    this.hasMore = true;
    document.body.classList.add('chat-open');

    this.el.empty.hidden = true;
    this.el.active.hidden = false;
    styleAvatar(this.el.avatar, peer.displayName, peer.id);
    this.el.name.textContent = peer.displayName;
    this._updateStatus(peer.online, peer.lastSeen);
    this.el.input.focus();

    if (!peer.publicKey) {
      // fetch fresh profile (publicKey required to derive the chat key)
      const res = await api(`/api/users/${peer.id}`);
      Object.assign(peer, res.user);
    }
    this.key = await E2EE.conversationKey(this.deps.privKey, peer.publicKey);

    await this.loadHistory();
    this._markRead();
  }

  close() {
    document.body.classList.remove('chat-open');
    this.el.active.hidden = true;
    this.el.empty.hidden = false;
    this.peer = null;
    this.key = null;
    this._stopRecording(true);
  }

  async loadHistory() {
    if (!this.peer || !this.hasMore) return;
    const q = this.oldestTs ? `?before=${this.oldestTs}` : '';
    const res = await api(`/api/chats/${this.peer.id}${q}`);
    this.hasMore = res.messages.length >= 50;
    if (!res.messages.length) return;
    this.oldestTs = res.messages[0].ts;
    const page = await this._decryptPage(res.messages);
    this.messages = [...page, ...this.messages];

    const nearTop = this.el.list.scrollTop < 200;
    const prevHeight = this.el.list.scrollHeight;
    for (const m of page) this._renderMessage(m, { prepend: true });
    if (nearTop && this.oldestTs) {
      this.el.list.scrollTop = this.el.list.scrollHeight - prevHeight;
    } else {
      this._scrollBottom();
    }
  }

  async _decryptPage(rows) {
    const out = [];
    for (const m of rows) {
      try {
        m.text = m.ct ? await E2EE.decryptText(this.key, m) : '';
      } catch { m.text = ''; m.failed = true; }
      out.push(m);
    }
    return out;
  }

  /* ─────────────── rendering ─────────────── */

  _renderMessage(m, { prepend = false } = {}) {
    if (m.type === 'text' && isEmojiOnly(m.text)) return this._renderEmojiMsg(m, prepend);
    const row = document.createElement('div');
    row.className = `msg-row ${m.from === this.deps.myId ? 'out' : 'in'}`;
    row.dataset.id = m.id;

    const bubble = document.createElement('div');
    bubble.className = 'msg';
    bubble.dataset.status = m.status || 'sent';

    if (m.attachment) this._renderAttachment(bubble, m);
    if (m.text && !m.attachment) {
      const body = document.createElement('span');
      body.innerHTML = linkify(m.text);
      bubble.appendChild(body);
    }

    const meta = document.createElement('span');
    meta.className = 'msg-meta';
    meta.innerHTML = `${fmtTime(m.ts)} ${m.from === this.deps.myId ? this._ticks() : ''}`;
    bubble.appendChild(meta);

    row.appendChild(bubble);
    this._place(row, m, prepend);
  }

  _ticks() {
    return `
      <svg class="ico ico-single" viewBox="0 0 16 11"><path d="M5.2 8.6L1.8 5.2.7 6.3l4.5 4.5L12.4 3 11.3 1.9z"/></svg>
      <svg class="ico ico-double" viewBox="0 0 20 11"><path d="M4.2 8.6L.8 5.2-.3 6.3l4.5 4.5L11.4 3 10.3 1.9z"/><path d="M11.2 8.6L7.8 5.2 6.7 6.3l4.5 4.5L18.4 3 17.3 1.9z"/></svg>`;
  }

  _renderEmojiMsg(m, prepend) {
    const row = document.createElement('div');
    row.className = `msg-row ${m.from === this.deps.myId ? 'out' : 'in'}`;
    row.dataset.id = m.id;
    const bubble = document.createElement('div');
    bubble.className = 'msg';
    bubble.dataset.status = m.status || 'sent';
    bubble.innerHTML = `<b class="emoji-only">${escapeHtml(m.text)}</b>
      <span class="msg-meta">${fmtTime(m.ts)} ${m.from === this.deps.myId ? this._ticks() : ''}</span>`;
    row.appendChild(bubble);
    this._place(row, m, prepend);
  }

  _renderAttachment(bubble, m) {
    const a = m.attachment || {};
    if (m.type === 'image' && a.url) {
      const holder = document.createElement('span');
      holder.className = 'msg-attachment';
      holder.innerHTML = `<img alt="Encrypted image" loading="lazy">`;
      const img = holder.firstChild;
      bubble.appendChild(holder);
      this._loadImage(a, img, m);
    } else if (m.type === 'voice' && a.url) {
      const wrap = document.createElement('span');
      wrap.className = 'voice-note';
      wrap.innerHTML = `
        <button class="play" title="Play">▶</button>
        <span class="wave">🎙️ Voice message</span>
        <span class="meta dur">${a.dur ? a.dur : ''}</span>`;
      bubble.appendChild(wrap);
      this._loadVoice(a, wrap, m);
    } else if (a.url) {
      const link = document.createElement('a');
      link.className = 'file-card';
      link.target = '_blank';
      link.rel = 'noopener';
      link.innerHTML = `
        <span class="file-ico">📄</span>
        <span class="fmeta"><div class="fname">${escapeHtml(a.name || 'file')}</div>
        <div class="fsize">${fmtBytes(a.size || 0)}</div></span>
        <span style="margin-left:auto;font-size:20px">⬇</span>`;
      bubble.appendChild(link);
      this._loadFile(a, link, m);
    }
    if (m.text) {
      const cap = document.createElement('span');
      cap.innerHTML = linkify(m.text);
      bubble.appendChild(cap);
    }
  }

  async _fetchBytes(url) {
    const res = await fetch(window.API(url));
    if (!res.ok) throw new Error('Download failed');
    return res.arrayBuffer();
  }

  async _loadImage(a, img, m) {
    try {
      const [buf] = await Promise.all([this._fetchBytes(a.url)]);
      const plain = await E2EE.decryptBytes(this.key, buf, a.iv);
      const blob = new Blob([plain], { type: a.mime || 'image/jpeg' });
      img.src = URL.createObjectURL(blob);
      img.addEventListener('click', () => {
        const lb = $('#lightbox'), big = $('#lightbox-img');
        big.src = img.src;
        lb.hidden = false;
      });
    } catch { img.alt = 'Could not decrypt image'; img.removeAttribute('src'); }
  }

  async _loadVoice(a, wrap, m) {
    const btn = wrap.querySelector('.play');
    btn.addEventListener('click', async () => {
      try {
        if (!this._voiceEl || this._voiceEl.dataset.url !== a.url) {
          const buf = await this._fetchBytes(a.url);
          const plain = await E2EE.decryptBytes(this.key, buf, a.iv);
          const blob = new Blob([plain], { type: a.mime || 'audio/webm' });
          const url = URL.createObjectURL(blob);
          if (!this._voiceEl) this._voiceEl = new Audio();
          this._voiceEl.src = url;
          this._voiceEl.dataset.url = a.url;
        }
        if (this._voiceEl.paused) { this._voiceEl.currentTime = 0; this._voiceEl.play(); btn.textContent = '⏸'; }
        else { this._voiceEl.pause(); btn.textContent = '▶'; }
      } catch { toast('Could not play voice note', 'err'); }
    });
  }

  async _loadFile(a, link, m) {
    link.href = '#';
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        toast('Decrypting file…', '');
        const buf = await this._fetchBytes(a.url);
        const plain = await E2EE.decryptBytes(this.key, buf, a.iv);
        const blob = new Blob([plain], { type: a.mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const dl = document.createElement('a');
        dl.href = url; dl.download = a.name || 'file';
        dl.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch { toast('Could not decrypt file', 'err'); }
    });
  }

  _place(row, m, prepend) {
    // day separator handling
    const list = this.el.list;
    const first = list.firstElementChild;
    if (prepend) {
      if (!first || !first.dataset?.day || first.dataset.day !== this._dayKey(m.ts)) {
        const chip = document.createElement('div');
        chip.className = 'day-chip';
        chip.dataset.day = this._dayKey(m.ts);
        chip.textContent = fmtDayChip(m.ts);
        list.prepend(chip);
      }
      list.prepend(row);
    } else {
      const last = list.lastElementChild;
      if (!last || !last.dataset?.day || last.dataset.day !== this._dayKey(m.ts)) {
        const chip = document.createElement('div');
        chip.className = 'day-chip';
        chip.dataset.day = this._dayKey(m.ts);
        chip.textContent = fmtDayChip(m.ts);
        list.appendChild(chip);
      }
      list.appendChild(row);
      this._scrollBottom();
    }
  }

  _dayKey(ts) { return new Date(ts).toDateString(); }
  _scrollBottom() { this.el.list.scrollTop = this.el.list.scrollHeight; }

  _updateStatus(online, lastSeen) {
    if (online) {
      this.el.status.textContent = 'online';
      this.el.status.classList.add('online');
      this.el.avatar.dataset.online = '1';
    } else {
      const ls = lastSeen ? `last seen ${fmtDayChip(lastSeen).toLowerCase()}` : 'offline';
      this.el.status.textContent = ls;
      this.el.status.classList.remove('online');
      delete this.el.avatar.dataset.online;
    }
  }

  /* ─────────────── incoming events (from app.js) ─────────────── */

  async onNewMessage(m) {
    if (!this.peer || (m.from !== this.peer.id && m.to !== this.peer.id)) return;
    if (this.messages.find((x) => x.id === m.id)) return;
    try { m.text = m.ct ? await E2EE.decryptText(this.key, m) : ''; } catch { m.text = ''; }
    this.messages.push(m);
    this._renderMessage(m);
    if (m.from === this.peer.id) {
      Socket.emit('message:delivered', { peer: m.from });
      this._markRead();
    }
  }

  onStatus(kind) {
    // kind: 'delivered' | 'read' — update all my outgoing bubbles
    for (const row of this.el.list.querySelectorAll('.msg-row.out')) {
      row.querySelector('.msg')?.setAttribute('data-status', kind);
    }
    for (const m of this.messages) if (m.from === this.deps.myId) m.status = kind;
  }

  onTyping({ from, isTyping }) {
    if (!this.peer || from !== this.peer.id) return;
    this.el.typingBar.hidden = !isTyping;
    if (isTyping) {
      styleAvatar(this.el.typingAvatar, this.peer.displayName, this.peer.id);
      this._scrollBottom();
    }
  }

  onPresence({ id, online, lastSeen }) {
    if (this.peer && id === this.peer.id) this._updateStatus(online, lastSeen);
  }

  _markRead() {
    if (this.peer) Socket.emit('message:read', { peer: this.peer.id });
  }

  /* ─────────────── composer ─────────────── */

  _bindComposer() {
    const { input, send, mic } = this.el;

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 130) + 'px';
      send.hidden = !input.value.trim();
      mic.hidden = !!input.value.trim();
      this._emitTyping();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._sendCurrent(); }
    });
    send.addEventListener('click', () => this._sendCurrent());

    // emoji
    this.el.emoji.addEventListener('click', () => {
      this.el.emojiPanel.hidden = !this.el.emojiPanel.hidden;
      this.el.attachMenu.hidden = true;
    });

    // attachments
    this.el.attach.addEventListener('click', () => {
      this.el.attachMenu.hidden = !this.el.attachMenu.hidden;
      this.el.emojiPanel.hidden = true;
    });
    for (const btn of this.el.attachMenu.querySelectorAll('button')) {
      btn.addEventListener('click', () => this._pickFile(btn.dataset.attach));
    }

    // voice recording
    mic.addEventListener('click', () => this._startRecording());
    this.el.recCancel.addEventListener('click', () => this._stopRecording(true));
    this.el.recSend.addEventListener('click', () => this._stopRecording(false));

    document.addEventListener('click', (e) => {
      if (!this.el.emojiPanel.hidden && !e.target.closest('#emoji-panel,#btn-emoji')) this.el.emojiPanel.hidden = true;
      if (!this.el.attachMenu.hidden && !e.target.closest('#attach-menu,#btn-attach')) this.el.attachMenu.hidden = true;
    });
  }

  /** Pull older history pages when the user scrolls near the top. */
  _bindScroll() {
    let busy = false;
    this.el.list.addEventListener('scroll', async () => {
      if (busy || !this.hasMore) return;
      if (this.el.list.scrollTop < 120 && this.oldestTs) {
        busy = true;
        try { await this.loadHistory(); } catch { /* offline */ }
        finally { setTimeout(() => { busy = false; }, 400); }
      }
    });
  }

  _buildEmojiPanel() {
    for (const e of EMOJIS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = e;
      b.addEventListener('click', () => {
        this.el.input.value += e;
        this.el.input.dispatchEvent(new Event('input'));
        this.el.input.focus();
      });
      this.el.emojiPanel.appendChild(b);
    }
  }

  _emitTyping() {
    if (!this.peer) return;
    Socket.emit('typing', { to: this.peer.id, isTyping: true });
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
      Socket.emit('typing', { to: this.peer.id, isTyping: false });
    }, 2500);
  }

  async _sendCurrent() {
    const text = this.el.input.value.trim();
    if (!text || !this.peer || !this.key) return;
    this.el.input.value = '';
    this.el.input.style.height = 'auto';
    this.el.send.hidden = true;
    this.el.mic.hidden = false;
    await this._sendEncrypted(text, 'text', null);
  }

  async _sendEncrypted(text, type, attachment) {
    const { ct, iv } = await E2EE.encryptText(this.key, text || '');
    const ack = await Socket.emitWithAck('message:send', {
      to: this.peer.id, type, ct, iv, attachment,
    });
    if (ack.error) { toast(ack.error, 'err'); return; }
    const m = {
      id: ack.id, ts: ack.ts, from: this.deps.myId, to: this.peer.id,
      type, ct, iv, attachment, text: text || '', status: 'sent',
    };
    this.messages.push(m);
    this._renderMessage(m);
  }

  /* ─────────────── media sending ─────────────── */

  async _pickFile(kind) {
    this.el.attachMenu.hidden = true;
    const accept = kind === 'image' ? 'image/*' : undefined;
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.onchange = () => input.files[0] && this._uploadAndSend(input.files[0], kind);
    input.click();
  }

  async _uploadAndSend(file, type) {
    if (file.size > 10 * 1024 * 1024) return toast('Max file size is 10 MB', 'err');
    toast('Encrypting & uploading…', '');
    try {
      const bytes = await file.arrayBuffer();
      const { blob, iv } = await E2EE.encryptBytes(this.key, bytes);
      const fd = new FormData();
      fd.append('file', blob, 'encrypted.bin');
      const res = await fetch(window.API('/api/upload'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth:token')}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      await this._sendEncrypted('', type, {
        url: data.url, name: file.name, size: file.size,
        mime: file.type || 'application/octet-stream', iv, dur: null,
      });
    } catch (e) {
      toast(e.message || 'Upload failed', 'err');
    }
  }

  /* ─────────────── voice notes ─────────────── */

  async _startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) return toast('Recording not supported here', 'err');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      this.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      this.recChunks = [];
      this.recStart = Date.now();
      this.recorder.ondataavailable = (e) => this.recChunks.push(e.data);
      this.recorder.onstop = () => {
        for (const t of stream.getTracks()) t.stop();
      };
      this.recorder.start();
      this.el.recBar.hidden = false;
      this._recTicker = setInterval(() => {
        const s = Math.floor((Date.now() - this.recStart) / 1000);
        this.el.recTimer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }, 500);
    } catch {
      toast('Microphone permission denied', 'err');
    }
  }

  _stopRecording(cancel) {
    clearInterval(this._recTicker);
    this.el.recBar.hidden = true;
    if (!this.recorder || this.recorder.state === 'inactive') return;
    const rec = this.recorder;
    const chunks = this.recChunks;
    const dur = Math.round((Date.now() - this.recStart) / 1000);
    this.recorder = null;
    rec.onstop = async () => {
      if (cancel) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      await this._uploadVoice(blob, dur, rec.mimeType);
    };
    rec.stop();
  }

  async _uploadVoice(blob, dur, mime) {
    if (blob.size < 800) return; // too short / empty
    toast('Encrypting & sending…', '');
    try {
      const bytes = await blob.arrayBuffer();
      const enc = await E2EE.encryptBytes(this.key, bytes);
      const fd = new FormData();
      fd.append('file', enc.blob, 'voice.bin');
      const res = await fetch(window.API('/api/upload'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth:token')}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await this._sendEncrypted('', 'voice', {
        url: data.url, name: 'Voice note', size: blob.size,
        mime: mime || 'audio/webm', iv: enc.iv, dur: `${dur}s`,
      });
    } catch (e) {
      toast(e.message || 'Voice note failed', 'err');
    }
  }
}
