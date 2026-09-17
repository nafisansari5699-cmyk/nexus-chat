/**
 * js/webrtc.js — peer-to-peer voice & video calls.
 *
 * Signaling rides on the authenticated Socket.io connection; media flows
 * directly between browsers (WebRTC). STUN servers are configured in
 * js/config.js; add a TURN server there for strict NATs/carriers.
 */
import { Socket } from './socketClient.js';

export const WebRTC = {
  state: 'idle',      // idle | outgoing | incoming | active
  peer: null,        // { id, displayName }
  video: false,
  pc: null,           // RTCPeerConnection
  localStream: null,
  remoteStream: null,
  pendingCandidates: [],
  remoteReady: false,

  ui: null,          // CallScreen component (set by app.js)
  onEnd: null,       // callback(peerId)

  _setUIState(state, status) {
    this.state = state;
    if (this.ui) this.ui.setState(state, status);
  },

  isBusy() { return this.state !== 'idle'; },

  /* ─────────── outgoing call ─────────── */

  async startCall(peer, video) {
    if (this.isBusy()) return;
    this.peer = peer;
    this.video = video;
    this._setUIState('outgoing', video ? 'Video calling…' : 'Calling…');

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      this._teardown();
      this._setUIState('idle');
      throw new Error('Microphone/camera permission denied');
    }

    this._createPC();
    for (const track of this.localStream.getTracks()) this.pc.addTrack(track, this.localStream);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    Socket.emit('call:offer', { to: peer.id, video, sdp: offer });
  },

  /* ─────────── incoming call (from socketServer relay) ─────────── */

  async handleOffer({ from, video, sdp }) {
    if (this.isBusy()) {
      // glare: already in a call — auto-decline
      Socket.emit('call:reject', { to: from, reason: 'busy' });
      return;
    }
    this.peer = { id: from }; // name resolved by CallScreen via lookup
    this.video = video;
    this.incomingSdp = sdp;
    this._setUIState('incoming', 'Incoming call');
    // ringtone playback is handled by CallScreen (autoplay policies)
  },

  async accept() {
    if (this.state !== 'incoming') return;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: this.video });
    } catch {
      Socket.emit('call:reject', { to: this.peer.id, reason: 'no-media' });
      this._teardown();
      return;
    }
    this._createPC();
    for (const track of this.localStream.getTracks()) this.pc.addTrack(track, this.localStream);
    await this.pc.setRemoteDescription(this.incomingSdp);
    this.remoteReady = true;
    for (const c of this.pendingCandidates) this.pc.addIceCandidate(c).catch(() => {});
    this.pendingCandidates = [];

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    Socket.emit('call:answer', { to: this.peer.id, sdp: answer });
    this._setUIState('active', 'Connected');
  },

  reject(reason = 'declined') {
    if (this.peer) Socket.emit('call:reject', { to: this.peer.id, reason });
    this._teardown();
    this._setUIState('idle');
  },

  hangup() {
    if (this.peer) Socket.emit('call:end', { to: this.peer.id });
    this._teardown();
    this._setUIState('idle');
  },

  /* ─────────── signaling events ─────────── */

  async handleAnswer({ from, sdp }) {
    if (!this.pc || this.peer?.id !== from) return;
    await this.pc.setRemoteDescription(sdp);
    this.remoteReady = true;
    for (const c of this.pendingCandidates) this.pc.addIceCandidate(c).catch(() => {});
    this.pendingCandidates = [];
    this._setUIState('active', 'Connected');
  },

  async handleIce({ from, candidate }) {
    if (this.peer?.id !== from) return;
    if (!this.pc || !this.remoteReady) { this.pendingCandidates.push(candidate); return; }
    try { await this.pc.addIceCandidate(candidate); } catch { /* late candidate */ }
  },

  handleRemoteReject() { this._teardown(); this._setUIState('idle'); },
  handleRemoteEnd() { this._teardown(); this._setUIState('idle'); },

  /* ─────────── media controls ─────────── */

  toggleMute() {
    if (!this.localStream) return false;
    const t = this.localStream.getAudioTracks()[0];
    if (t) t.enabled = !t.enabled;
    return t ? t.enabled : false;
  },

  toggleCam() {
    if (!this.localStream) return false;
    const t = this.localStream.getVideoTracks()[0];
    if (t) t.enabled = !t.enabled;
    return t ? t.enabled : false;
  },

  /* ─────────── internals ─────────── */

  _createPC() {
    this.pc = new RTCPeerConnection({ iceServers: window.APP_CONFIG.iceServers || [] });
    this.remoteStream = new MediaStream();
    if (this.ui) this.ui.setRemoteStream(this.remoteStream);

    this.pc.ontrack = (e) => {
      for (const track of e.streams[0].getTracks()) this.remoteStream.addTrack(track);
    };

    this.pc.onicecandidate = (e) => {
      if (e.candidate && this.peer) {
        Socket.emit('call:ice', { to: this.peer.id, candidate: e.candidate });
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(this.pc.connectionState)) {
        if (this.state !== 'idle') {
          if (this.peer) Socket.emit('call:end', { to: this.peer.id });
          this._teardown();
          this._setUIState('idle');
        }
      }
    };
  },

  _teardown() {
    if (this.pc) { try { this.pc.close(); } catch {} }
    if (this.localStream) for (const t of this.localStream.getTracks()) t.stop();
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.remoteReady = false;
    this.peer = null;
    if (this.ui) this.ui.clearStreams();
    if (this.onEnd) this.onEnd();
  },

  init() {
    Socket.on('call:offer', (p) => this.handleOffer(p));
    Socket.on('call:answer', (p) => this.handleAnswer(p));
    Socket.on('call:ice', (p) => this.handleIce(p));
    Socket.on('call:reject', () => this.handleRemoteReject());
    Socket.on('call:end', () => this.handleRemoteEnd());
  },
};
