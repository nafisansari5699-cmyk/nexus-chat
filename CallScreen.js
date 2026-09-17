/**
 * components/CallScreen.js — full-screen call UI: incoming/outgoing/active
 * states, remote & local video, mute/camera controls, ringtone.
 */
import { $, fmtDuration, styleAvatar } from '../js/utils.js';

export class CallScreen {
  constructor() {
    this.root = $('#call-screen');
    this.remote = $('#remote-video');
    this.local = $('#local-video');
    this.avatar = $('#call-avatar');
    this.name = $('#call-name');
    this.status = $('#call-status');
    this.timer = $('#call-timer');
    this.muteBtn = $('#btn-mute');
    this.camBtn = $('#btn-cam');
    this.hangupBtn = $('#btn-hangup');
    this.acceptBtn = $('#btn-accept');
    this.rejectBtn = $('#btn-reject');
    this.ringtone = $('#ringtone');
    this.hooks = {
      onAccept: () => {},
      onReject: () => {},
      onHangup: () => {},
      onToggleMute: () => {},
      onToggleCam: () => {},
    };

    this.acceptBtn.addEventListener('click', () => this.hooks.onAccept());
    this.rejectBtn.addEventListener('click', () => this.hooks.onReject());
    this.hangupBtn.addEventListener('click', () => this.hooks.onHangup());
    this.muteBtn.addEventListener('click', () => {
      const on = this.hooks.onToggleMute();
      this.muteBtn.classList.toggle('off', !on);
      this.muteBtn.textContent = on ? '🎙️' : '🔇';
    });
    this.camBtn.addEventListener('click', () => {
      const on = this.hooks.onToggleCam();
      this.camBtn.classList.toggle('off', !on);
      this.camBtn.textContent = on ? '📷' : '🚫';
    });
  }

  /** state: idle | outgoing | incoming | active */
  setState(state, statusText = '') {
    const isAudioish = state === 'incoming';
    this.root.hidden = state === 'idle';
    if (state === 'idle') {
      this._stopRingtone();
      clearInterval(this._ticker);
      this.timer.hidden = true;
      this.local.srcObject = null;
      this.remote.srcObject = null;
      this.muteBtn.classList.remove('off');
      this.muteBtn.textContent = '🎙️';
      this.camBtn.classList.remove('off');
      this.camBtn.textContent = '📷';
      return;
    }
    if (statusText) this.status.textContent = statusText;

    // incoming: show accept/reject, ring
    this.acceptBtn.hidden = state !== 'incoming';
    this.rejectBtn.hidden = state !== 'incoming';
    this.muteBtn.hidden = this.camBtn.hidden = this.hangupBtn.hidden = state === 'incoming';

    if (state === 'incoming') this._playRingtone(); else this._stopRingtone();

    if (state === 'active') {
      clearInterval(this._ticker);
      const start = Date.now();
      this.timer.hidden = false;
      this._ticker = setInterval(() => {
        this.timer.textContent = fmtDuration((Date.now() - start) / 1000);
      }, 1000);
    }
  }

  setPeerInfo(peer) {
    if (!peer) return;
    styleAvatar(this.avatar, peer.displayName || `User ${peer.id}`, peer.id);
    this.name.textContent = peer.displayName || `User ${peer.id}`;
  }

  setLocalStream(stream) {
    this.local.srcObject = stream || null;
  }

  setRemoteStream(stream) {
    this.remote.srcObject = stream || null;
  }

  clearStreams() {
    this.setLocalStream(null);
    this.setRemoteStream(null);
  }

  _playRingtone() {
    // browsers require a user gesture before audio can play; if this call
    // fails we fall back silently (the on-screen UI still shows the call)
    this.ringtone.currentTime = 0;
    this.ringtone.play().catch(() => {});
    if (!this._vibe) this._vibe = navigator.vibrate?.bind(navigator);
    this._vibe?.([600, 400, 600, 400, 600]);
  }

  _stopRingtone() {
    try { this.ringtone.pause(); } catch {}
    navigator.vibrate?.(0);
  }
}
