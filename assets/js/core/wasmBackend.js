/*
 * cubiomes WASM 后端：直接调用官方级别的 Java 版世界生成算法。
 * 负责：群系查询/批量生成、出生点、史莱姆区块、建筑位置与可生成性判定、官方调色板。
 * 所有对 WASM 内存的访问都集中在类内部，外部只拿到普通数组，避免内存泄漏与悬垂视图。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  /** 群系采样高度：主世界取海平面附近，下界/末地取中层 */
  function sampleY(dim) { return dim === 0 ? 15 : 8; }

  function WasmBackend(mod) {
    this.m = mod;
    this.label = 'cubiomes WASM';
    this.accurate = true;
    this.palette = new Uint8Array(256 * 3);
    this._ctxs = new Map();
    this._mc = -1;
    this._dim = 0;
    this._lo = 0;
    this._hi = 0;
    this._gridPtr = 0;
    this._gridCap = 0;
    this._outPtr = 0;
    this._structIndex = null;
    this._biomeNames = new Map();
    this._loadPalette();
  }

  WasmBackend.prototype._loadPalette = function () {
    var p = this.m._malloc(768);
    if (p && this.m._wasm_biome_colors(p) === 0) {
      this.palette.set(this.m.HEAPU8.subarray(p, p + 768));
    }
    if (p) this.m._free(p);
  };

  WasmBackend.prototype._cstr = function (s) {
    var n = this.m.lengthBytesUTF8(s) + 1;
    var p = this.m._malloc(n);
    this.m.stringToUTF8(s, p, n);
    return p;
  };

  WasmBackend.prototype._readName = function (lenFn, ptrFn) {
    var len = lenFn();
    if (!len) return '';
    return this.m.UTF8ToString(ptrFn(), len);
  };

  WasmBackend.prototype._ctx = function (dim) {
    var key = this._mc + ':' + dim;
    var h = this._ctxs.get(key);
    if (h === undefined) {
      h = this.m._wasm_create(this._mc, dim, this._lo, this._hi);
      if (!h) return 0;
      this._ctxs.set(key, h);
    }
    return h;
  };

  WasmBackend.prototype.setWorld = function (w) {
    var mcChanged = (w.mc !== this._mc);
    if (mcChanged) {
      this._ctxs.forEach(function (h) { this.m._wasm_destroy(h); }, this);
      this._ctxs.clear();
      this._biomeNames.clear();
      this._mc = w.mc;
    }
    this._lo = w.seedLo >>> 0;
    this._hi = w.seedHi >>> 0;
    this._dim = w.dim;
    this._ctxs.forEach(function (h) { this.m._wasm_set_seed(h, this._lo, this._hi); }, this);
  };

  WasmBackend.prototype._ensureGrid = function (cells) {
    if (cells > this._gridCap) {
      if (this._gridPtr) this.m._free(this._gridPtr);
      this._gridPtr = this.m._malloc(cells * 4);
      this._gridCap = cells;
    }
    return this._gridPtr;
  };

  WasmBackend.prototype.biomeName = function (id) {
    var key = this._mc + ':' + id;
    var cached = this._biomeNames.get(key);
    if (cached !== undefined) return cached;
    var m = this.m, mc = this._mc;
    var name = '';
    var len = m._wasm_biome_name_length(mc, id);
    if (len > 0) name = m.UTF8ToString(m._wasm_biome_name_ptr(mc, id), len);
    this._biomeNames.set(key, name);
    return name;
  };

  WasmBackend.prototype.structureNameAt = function (idx) {
    var m = this.m;
    var len = m._wasm_structure_name_length(idx);
    return len > 0 ? m.UTF8ToString(m._wasm_structure_name_ptr(idx), len) : '';
  };

  WasmBackend.prototype.idOf = function (name) {
    var p = this._cstr(name);
    var id = this.m._wasm_biome_id(this._mc, p);
    this.m._free(p);
    return id;
  };

  WasmBackend.prototype.biomeAt = function (bx, bz) {
    var h = this._ctx(this._dim);
    if (!h) return -1;
    return this.m._wasm_ctx_get_biome(h, 4, Math.floor(bx / 4), sampleY(this._dim), Math.floor(bz / 4));
  };

  /** x0/z0 为群系格坐标，stride 为采样步长；stride=1 时走批量接口，否则逐点采样 */
  WasmBackend.prototype.fillGrid = function (x0, z0, w, h, stride, out, y) {
    var ctx = this._ctx(this._dim);
    if (!ctx) return -1;
    var yy = (y === undefined || y === null) ? sampleY(this._dim) : y;
    if (stride <= 1) {
      var ptr = this._ensureGrid(w * h);
      if (!ptr) return -1;
      if (this.m._wasm_ctx_generate_biomes(ctx, x0, z0, w, h, 4, yy, ptr) !== 0) return -1;
      out.set(this.m.HEAP32.subarray(ptr / 4, ptr / 4 + w * h));
      return 0;
    }
    var i = 0;
    for (var gz = 0; gz < h; gz++) {
      var gbz = z0 + gz * stride;
      for (var gx = 0; gx < w; gx++) {
        out[i++] = this.m._wasm_ctx_get_biome(ctx, 4, x0 + gx * stride, yy, gbz);
      }
    }
    return 0;
  };

  WasmBackend.prototype.spawn = function () {
    var h = this._ctx(this._dim);
    if (!h) return null;
    if (!this._outPtr) this._outPtr = this.m._malloc(16);
    var p = this._outPtr;
    if (this.m._wasm_ctx_get_spawn(h, p) === 1) {
      return { x: this.m.HEAP32[p / 4], z: this.m.HEAP32[p / 4 + 1] };
    }
    if (this.m._wasm_ctx_estimate_spawn(h, p) === 1) {
      return { x: this.m.HEAP32[p / 4], z: this.m.HEAP32[p / 4 + 1] };
    }
    return null;
  };

  WasmBackend.prototype.isSlimeChunk = function (cx, cz) {
    return this.m._wasm_slime_chunk(this._lo, this._hi, cx, cz) === 1;
  };

  /** 引擎结构名 → 枚举下标；返回 -1 表示该版本不支持 */
  WasmBackend.prototype.structureIndex = function (engineName) {
    if (!this._structIndex) {
      var map = {};
      var count = this.m._wasm_structure_type_count();
      for (var i = 0; i < count; i++) {
        var name = this.structureNameAt(i);
        if (name) map[name] = i;
      }
      this._structIndex = map;
    }
    var v = this._structIndex[engineName];
    return v === undefined ? -1 : v;
  };

  WasmBackend.prototype.regionSize = function (key) {
    var def = MC.structureByKey(key);
    if (!def) return 0;
    var idx = this.structureIndex(def.engine);
    if (idx < 0) return 0;
    return this.m._wasm_structure_region_size(idx, this._mc);
  };

  WasmBackend.prototype.structureAttempt = function (key, rx, rz) {
    var def = MC.structureByKey(key);
    if (!def) return null;
    var idx = this.structureIndex(def.engine);
    if (idx < 0) return null;
    if (!this._outPtr) this._outPtr = this.m._malloc(16);
    var p = this._outPtr;
    if (this.m._wasm_structure_pos(idx, this._mc, this._lo, this._hi, rx, rz, p) !== 1) return null;
    // cubiomes 返回的是【区块坐标】，地图投影与搜索距离都用【方块坐标】，
    // 这里统一换算到方块（区块中心）避免标记整体差 16 倍、贴到原点附近
    var chunkX = this.m.HEAP32[p / 4], chunkZ = this.m.HEAP32[p / 4 + 1];
    return { x: chunkX * 16 + 8, z: chunkZ * 16 + 8 };
  };

  WasmBackend.prototype.structureViable = function (key, bx, bz) {
    var def = MC.structureByKey(key);
    if (!def) return false;
    var idx = this.structureIndex(def.engine);
    if (idx < 0) return false;
    var h = this._ctx(def.dim);
    if (!h) return false;
    // 入参是方块坐标（与 structureAttempt / 地图保持一致），cubiomes 的 viable 检查要区块坐标
    return this.m._wasm_ctx_structure_viable(h, idx, Math.floor(bx / 16), Math.floor(bz / 16)) === 1;
  };

  WasmBackend.prototype.dispose = function () {
    this._ctxs.forEach(function (h) { this.m._wasm_destroy(h); }, this);
    this._ctxs.clear();
    if (this._gridPtr) this.m._free(this._gridPtr);
    if (this._outPtr) this.m._free(this._outPtr);
    this._gridPtr = 0; this._outPtr = 0;
  };

  /** 动态加载 Emscripten 模块；失败时抛出，由上层降级 */
  WasmBackend.load = function (jsUrl) {
    var base = jsUrl.replace(/[^\/]*$/, '');
    return import(jsUrl).then(function (mod) {
      var factory = mod.default || mod;
      return factory({
        locateFile: function (path) {
          return /\.wasm$/.test(path) ? base + path : base + path;
        }
      });
    }).then(function (m) {
      if (!m || typeof m._wasm_create !== 'function') throw new Error('引擎接口缺失');
      return new WasmBackend(m);
    });
  };

  MC.WasmBackend = WasmBackend;
  MC.sampleY = sampleY;
})(globalThis.MC);
