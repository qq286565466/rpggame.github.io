/* 时空猪 · 原创俯视角生存游戏
 * util.js — 数学、随机数、存储等基础设施（可脱离浏览器运行）
 * 本文件为原创代码，未复制任何第三方站点资源。
 */
(function (global) {
  'use strict';
  var SP = global.SP || (global.SP = {});

  var TAU = Math.PI * 2;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist2(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; }
  function dist(ax, ay, bx, by) { return Math.sqrt(dist2(ax, ay, bx, by)); }
  function len(x, y) { return Math.sqrt(x * x + y * y); }

  /** 归一化到 (-PI, PI] 的角度差 */
  function angleDiff(from, to) {
    var d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  /** 平滑朝目标角度旋转，限制每秒最大角速度 */
  function turnToward(cur, target, maxStep) {
    var d = angleDiff(cur, target);
    if (d > maxStep) d = maxStep;
    if (d < -maxStep) d = -maxStep;
    return cur + d;
  }

  /** xorshift32 可复现随机数生成器，保证同种子同结果（便于自动化测试） */
  function makeRng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    var rng = function () {
      s ^= (s << 13); s >>>= 0;
      s ^= (s >>> 17);
      s ^= (s << 5); s >>>= 0;
      return s / 4294967296;
    };
    rng.range = function (a, b) { return a + rng() * (b - a); };
    rng.int = function (a, b) { return Math.floor(rng.range(a, b + 1)); };
    rng.pick = function (arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; };
    rng.chance = function (p) { return rng() < p; };
    return rng;
  }

  /** 按权重挑选，items 需提供 weight 字段 */
  function weightedPick(rng, items) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += (items[i].weight || 1);
    var r = rng() * total;
    for (i = 0; i < items.length; i++) {
      r -= (items[i].weight || 1);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** 轻量非加密散列：仅用于本地演示账号，不用于任何真实安全场景 */
  function hashPassword(user, pass) {
    var str = 'spm|' + String(user).toLowerCase() + '|' + String(pass);
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 ^= c; h1 = (h1 * 0x01000193) >>> 0;
      h2 = ((h2 << 5) - h2 + c) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  /** file:// 下 localStorage 可能被禁用，统一降级到内存存储，保证游戏仍可运行 */
  function makeStorage() {
    var mem = {};
    var real = null;
    try {
      var k = '__spm_probe__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      real = global.localStorage;
    } catch (e) { real = null; }
    return {
      persistent: !!real,
      get: function (key) {
        try { return real ? real.getItem(key) : (key in mem ? mem[key] : null); }
        catch (e) { return key in mem ? mem[key] : null; }
      },
      set: function (key, value) {
        mem[key] = value;
        try { if (real) real.setItem(key, value); } catch (e) { /* 配额或隐私模式，忽略 */ }
      },
      remove: function (key) {
        delete mem[key];
        try { if (real) real.removeItem(key); } catch (e) { /* 忽略 */ }
      }
    };
  }

  SP.TAU = TAU;
  SP.clamp = clamp;
  SP.lerp = lerp;
  SP.dist = dist;
  SP.dist2 = dist2;
  SP.len = len;
  SP.angleDiff = angleDiff;
  SP.turnToward = turnToward;
  SP.makeRng = makeRng;
  SP.weightedPick = weightedPick;
  SP.fmtTime = fmtTime;
  SP.hashPassword = hashPassword;
  SP.makeStorage = makeStorage;
})(typeof globalThis !== 'undefined' ? globalThis : this);
