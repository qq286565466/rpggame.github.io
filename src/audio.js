/* 时空猪 · audio.js — 用 WebAudio 实时合成音效（无任何音频素材文件）
 * 浏览器要求用户手势后才能出声，因此 AudioContext 延迟到首次交互再创建。
 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});

  function Sound() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.32;
  }

  Sound.prototype.ensure = function () {
    if (this.ctx) return this.ctx;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
    return this.ctx;
  };

  Sound.prototype.resume = function () {
    var c = this.ensure();
    if (c && c.state === 'suspended') { try { c.resume(); } catch (e) { /* 忽略 */ } }
  };

  Sound.prototype.setVolume = function (v) {
    this.volume = SP.clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  };

  /** 单个振荡器音符 */
  Sound.prototype.tone = function (o) {
    var c = this.ensure();
    if (!c || !this.enabled) return;
    var t0 = c.currentTime + (o.delay || 0);
    var dur = o.dur || 0.12;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
    var peak = (o.gain === undefined ? 0.4 : o.gain);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  };

  /** 噪声脉冲（用于打击感与爆炸） */
  Sound.prototype.noise = function (o) {
    var c = this.ensure();
    if (!c || !this.enabled) return;
    o = o || {};
    var dur = o.dur || 0.18;
    var t0 = c.currentTime + (o.delay || 0);
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = c.createBufferSource();
    src.buffer = buf;
    var f = c.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 1200, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + dur);
    var g = c.createGain();
    g.gain.setValueAtTime(o.gain === undefined ? 0.3 : o.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  };

  Sound.prototype.play = function (name) {
    if (!this.enabled) return;
    var self = this;
    try {
      switch (name) {
        case 'attack':
          this.noise({ dur: 0.1, freq: 2600, to: 700, gain: 0.2, filter: 'bandpass' });
          break;
        case 'hit':
          this.tone({ freq: 420, to: 200, dur: 0.07, type: 'square', gain: 0.16 });
          break;
        case 'crit':
          this.tone({ freq: 900, to: 420, dur: 0.11, type: 'square', gain: 0.2 });
          this.noise({ dur: 0.1, freq: 3200, to: 900, gain: 0.18, filter: 'bandpass' });
          break;
        case 'kill':
          this.noise({ dur: 0.22, freq: 900, to: 180, gain: 0.24 });
          break;
        case 'quake':
          this.tone({ freq: 180, to: 42, dur: 0.5, type: 'sine', gain: 0.5 });
          this.noise({ dur: 0.42, freq: 500, to: 90, gain: 0.3 });
          break;
        case 'bless':
          [523, 659, 784, 1046].forEach(function (f, i) {
            self.tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.2, delay: i * 0.055 });
          });
          break;
        case 'coin':
          this.tone({ freq: 1046, dur: 0.07, type: 'square', gain: 0.14 });
          this.tone({ freq: 1568, dur: 0.12, type: 'square', gain: 0.12, delay: 0.055 });
          break;
        case 'stone':
          this.tone({ freq: 1318, dur: 0.5, type: 'sine', gain: 0.22 });
          this.tone({ freq: 1976, dur: 0.5, type: 'sine', gain: 0.12, delay: 0.04 });
          break;
        case 'steak':
          this.tone({ freq: 300, to: 180, dur: 0.2, type: 'triangle', gain: 0.22 });
          break;
        case 'hurt':
          this.tone({ freq: 300, to: 90, dur: 0.24, type: 'sawtooth', gain: 0.3 });
          this.noise({ dur: 0.16, freq: 800, to: 200, gain: 0.2 });
          break;
        case 'levelup':
          [523, 659, 784, 1046, 1318].forEach(function (f, i) {
            self.tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.24, delay: i * 0.07 });
          });
          break;
        case 'wave':
          [392, 523].forEach(function (f, i) {
            self.tone({ freq: f, dur: 0.4, type: 'sawtooth', gain: 0.14, delay: i * 0.08 });
          });
          break;
        case 'boss':
          this.tone({ freq: 110, to: 74, dur: 1.0, type: 'sawtooth', gain: 0.32 });
          this.tone({ freq: 165, to: 110, dur: 0.9, type: 'square', gain: 0.14 });
          break;
        case 'bossdown':
          this.tone({ freq: 440, to: 70, dur: 1.2, type: 'sawtooth', gain: 0.36 });
          this.noise({ dur: 1.0, freq: 1600, to: 120, gain: 0.3 });
          break;
        case 'death':
          [440, 349, 262, 196].forEach(function (f, i) {
            self.tone({ freq: f, dur: 0.42, type: 'triangle', gain: 0.26, delay: i * 0.13 });
          });
          break;
        case 'spit':
          this.tone({ freq: 700, to: 1300, dur: 0.1, type: 'sine', gain: 0.1 });
          break;
        case 'click':
          this.tone({ freq: 880, dur: 0.05, type: 'square', gain: 0.1 });
          break;
        case 'summon':
          this.tone({ freq: 200, to: 520, dur: 0.4, type: 'sawtooth', gain: 0.16 });
          break;
      }
    } catch (e) { /* 音频失败不应影响游戏 */ }
  };

  SP.Sound = Sound;
})(typeof globalThis !== 'undefined' ? globalThis : this);
