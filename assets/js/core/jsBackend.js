/*
 * 纯 JS 近似生成后端（WASM 不可用时的兜底）。
 * 用多层值噪声拟合 1.18+ 的气候参数（大陆性/侵蚀/温度/湿度/奇异值）再归类群系，
 * 结果与官方算法不逐格一致，但地形分布形态与真实世界接近，足够用于找地形与规划路线。
 *
 * 边界：只近似「群系」，不碰「结构」。建筑落点需要官方放置算法，
 * 这里算不出来，一律如实返回不可用（见 regionSize）。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  function mix32(a) {
    a |= 0;
    a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
    a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
    return (a ^ (a >>> 16)) >>> 0;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  /** 二维值噪声，返回 [0,1) */
  function valueNoise(x, z, seed) {
    var xi = Math.floor(x), zi = Math.floor(z);
    var fx = smooth(x - xi), fz = smooth(z - zi);
    var n00 = mix32(xi * 73856093 ^ zi * 19349663 ^ seed) / 4294967296;
    var n10 = mix32((xi + 1) * 73856093 ^ zi * 19349663 ^ seed) / 4294967296;
    var n01 = mix32(xi * 73856093 ^ (zi + 1) * 19349663 ^ seed) / 4294967296;
    var n11 = mix32((xi + 1) * 73856093 ^ (zi + 1) * 19349663 ^ seed) / 4294967296;
    var a = n00 + (n10 - n00) * fx;
    var b = n01 + (n11 - n01) * fx;
    return a + (b - a) * fz;
  }

  /** 分形叠加噪声，oct 个八度，返回 [0,1) */
  function fbm(x, z, seed, oct) {
    var sum = 0, amp = 1, norm = 0, fx = x, fz = z;
    for (var i = 0; i < oct; i++) {
      sum += valueNoise(fx, fz, seed + i * 7919) * amp;
      norm += amp;
      amp *= 0.5;
      fx *= 2; fz *= 2;
    }
    return sum / norm;
  }

  function JsBackend() {
    this.label = 'JS 近似引擎';
    this.accurate = false;
    this.palette = MC.fallbackPalette();
    this._nameById = {};
    Object.keys(MC.BIOME_IDS).forEach(function (k) { this._nameById[MC.BIOME_IDS[k]] = k; }, this);
    this.mc = 28; this.dim = 0; this.seed = 0; this.seedLo = 0; this.seedHi = 0;
  }

  JsBackend.prototype.idOf = function (name) {
    var id = MC.BIOME_IDS[name];
    return id === undefined ? 1 : id;
  };

  JsBackend.prototype.biomeName = function (id) {
    return this._nameById[id] || 'unknown';
  };

  JsBackend.prototype.setWorld = function (w) {
    this.mc = w.mc; this.dim = w.dim;
    this.seedLo = w.seedLo >>> 0; this.seedHi = w.seedHi >>> 0;
    this.seed = (this.seedLo ^ Math.imul(this.seedHi | 0, 0x85ebca6b)) | 0;
  };

  JsBackend.prototype._climate = function (bx, bz) {
    var s = this.seed;
    return {
      cont: fbm(bx / 900, bz / 900, s + 101, 5),
      erosion: fbm(bx / 420, bz / 420, s + 202, 4),
      temp: fbm(bx / 700, bz / 700, s + 303, 4),
      humid: fbm(bx / 560, bz / 560, s + 404, 4),
      weird: fbm(bx / 380, bz / 380, s + 505, 3),
      river: fbm(bx / 300, bz / 300, s + 606, 3)
    };
  };

  /** 主世界群系归类 */
  JsBackend.prototype._overworld = function (c) {
    var id = this.idOf.bind(this);
    if (c.cont < 0.34) {
      var deep = (0.34 - c.cont) > 0.19;
      if (c.temp < 0.18) return id(deep ? 'deep_frozen_ocean' : 'frozen_ocean');
      if (c.temp < 0.40) return id(deep ? 'deep_cold_ocean' : 'cold_ocean');
      if (c.temp < 0.70) return id(deep ? 'deep_ocean' : 'ocean');
      if (c.temp < 0.86) return id(deep ? 'deep_lukewarm_ocean' : 'lukewarm_ocean');
      return id(deep ? 'deep_warm_ocean' : 'warm_ocean');
    }
    if (c.cont < 0.375) {
      if (c.temp < 0.20) return id('snowy_beach');
      if (c.erosion < 0.25) return id('stony_shore');
      return id('beach');
    }
    if (c.weird > 0.93 && c.cont < 0.42) return id('mushroom_fields');
    if (Math.abs(c.river - 0.5) < 0.014) return id(c.temp < 0.20 ? 'frozen_river' : 'river');

    var t = c.temp, h = c.humid, e = c.erosion, w = c.weird;
    if (e < 0.28) {
      if (w > 0.58) return id(t < 0.25 ? 'frozen_peaks' : (t < 0.55 ? 'jagged_peaks' : 'stony_peaks'));
      if (t < 0.30) return id(w > 0.45 ? 'grove' : 'snowy_slopes');
      if (h > 0.62) return id('windswept_forest');
      return id(h < 0.34 ? 'windswept_gravelly_hills' : 'windswept_hills');
    }
    if (h > 0.82 && c.cont < 0.44) return id(t > 0.60 ? 'mangrove_swamp' : 'swamp');
    if (e < 0.42) {
      if (t > 0.42 && t < 0.62 && w > 0.55) return id('cherry_grove');
      if (t < 0.30) return id('grove');
      return id('meadow');
    }
    if (t < 0.24) {
      if (h > 0.62) return id('snowy_taiga');
      if (w > 0.78 && h < 0.5) return id('ice_spikes');
      return id('snowy_plains');
    }
    if (t < 0.52) {
      if (h > 0.72) return id(w > 0.70 ? 'dark_forest' : 'forest');
      if (h > 0.46) return id(w > 0.82 ? 'flower_forest' : (w > 0.62 ? 'birch_forest' : 'forest'));
      if (t < 0.34) return id(h > 0.60 ? 'old_growth_pine_taiga' : 'taiga');
      if (h < 0.30) return id(w > 0.74 ? 'sunflower_plains' : 'plains');
      return id('plains');
    }
    if (t < 0.76) {
      if (h > 0.74) return id(w > 0.78 ? 'bamboo_jungle' : 'jungle');
      if (h > 0.58) return id(w > 0.60 ? 'sparse_jungle' : 'forest');
      if (h < 0.32) return id(e < 0.50 ? 'savanna_plateau' : 'savanna');
      return id('plains');
    }
    if (h < 0.26) return id(w > 0.72 ? 'desert_lakes' : 'desert');
    if (h < 0.46) return id(w > 0.55 ? 'eroded_badlands' : 'badlands');
    return id('savanna');
  };

  JsBackend.prototype.biomeAt = function (bx, bz) {
    if (this.dim === -1) {
      var n = fbm(bx / 200, bz / 200, this.seed + 71, 4);
      if (n < 0.24) return this.idOf('soul_sand_valley');
      if (n < 0.46) return this.idOf('nether_wastes');
      if (n < 0.62) return this.idOf('crimson_forest');
      if (n < 0.80) return this.idOf('warped_forest');
      return this.idOf('basalt_deltas');
    }
    if (this.dim === 1) {
      var d = Math.sqrt(bx * bx + bz * bz);
      if (d < 640) return this.idOf('the_end');
      var m = fbm(bx / 260, bz / 260, this.seed + 83, 3);
      if (m < 0.34) return this.idOf('end_barrens');
      if (m < 0.68) return this.idOf('end_midlands');
      return this.idOf('end_highlands');
    }
    return this._overworld(this._climate(bx, bz));
  };

  /** x0/z0 为群系格坐标（1 格 = 4 格方块），stride 为采样步长（单位：群系格） */
  JsBackend.prototype.fillGrid = function (x0, z0, w, h, stride, out, y) {
    var i = 0;
    for (var gz = 0; gz < h; gz++) {
      var bz = (z0 + gz * stride) * 4;
      for (var gx = 0; gx < w; gx++) {
        out[i++] = this.biomeAt((x0 + gx * stride) * 4, bz);
      }
    }
    return 0;
  };

  /** 近似出生点：从原点向外螺旋找第一块非海洋陆地 */
  JsBackend.prototype.spawn = function () {
    for (var r = 0; r <= 3000; r += 64) {
      for (var a = 0; a < 16; a++) {
        var ang = a / 16 * Math.PI * 2;
        var x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        var id = this.biomeAt(x, z);
        var name = this.biomeName(id);
        if (name.indexOf('ocean') < 0 && name.indexOf('river') < 0 && name !== 'beach') {
          return { x: x, z: z };
        }
      }
    }
    return { x: 0, z: 0 };
  };

  /** 史莱姆区块：官方 LCG 判定，用 BigInt 保证 48 位精度 */
  JsBackend.prototype.isSlimeChunk = function (cx, cz) {
    var mask = (1n << 48n) - 1n;
    var s = (BigInt(this.seedLo >>> 0) + (BigInt(this.seedHi >>> 0) << 32n)) & 0xFFFFFFFFFFFFn;
    var v = (BigInt(cx * cx * 4987142) + BigInt(cx * 58703) + BigInt(cz * cz * 4392871) + BigInt(cz * 38971)) ^ 0x5DEECE66Dn;
    var seed = ((s + v) ^ 0x5DEECE66Dn) & mask;
    seed = (seed * 0x5DEECE66Dn + 0xBn) & mask;
    var rnd = Number((seed >> 16n) & 0x7FFFFFn) % 10;
    return rnd === 0;
  };

  /*
   * 结构位置一律不提供，区域大小返回 0 让上层直接跳过。
   * 原因：建筑落点由官方放置算法（区域哈希 + 群系可行性判定）决定，
   * 近似后端只有自己拟合的噪声群系，拿它去猜坐标等于凭空编造——
   * 之前用哈希伪造坐标，实测与真实位置 169 个区域 0 个吻合，且会生成在海洋里。
   * 宁可不画，也不能把假的标记当成真的给用户。
   */
  JsBackend.prototype.regionSize = function () { return 0; };

  JsBackend.prototype.dispose = function () { /* 无资源需要释放 */ };

  MC.JsBackend = JsBackend;
})(globalThis.MC);
