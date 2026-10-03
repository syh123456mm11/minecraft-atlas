/*
 * 世界生成引擎门面：对外只暴露一组稳定方法，内部在 cubiomes WASM 与 JS 近似后端之间切换。
 * 调用方（地图、搜索、结构查找）只依赖本门面，替换后端时无需改动上层代码。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  function Engine() {
    this.backend = null;
    this.wasmUrl = '';
    this.world = { mc: 28, dim: 0, seedLo: 0, seedHi: 0 };
    this.ready = false;
  }

  /** 优先加载 cubiomes WASM，失败（如 file:// 打开）自动降级为 JS 近似后端 */
  Engine.prototype.init = function (wasmUrl) {
    var self = this;
    this.wasmUrl = wasmUrl;
    if (location.protocol === 'file:') {
      this._useJs('以本地文件方式打开，浏览器禁止加载 WASM，已切换到近似引擎');
      return Promise.resolve(this);
    }
    return MC.WasmBackend.load(wasmUrl).then(function (b) {
      self.backend = b;
      self.ready = true;
      return self;
    }).catch(function (e) {
      console.warn('[engine] cubiomes 加载失败，降级近似引擎：', e && e.message);
      self._useJs(e && e.message);
      return self;
    });
  };

  Engine.prototype._useJs = function (reason) {
    this.backend = new MC.JsBackend();
    this.ready = true;
    this.fallbackReason = reason || '';
  };

  Engine.prototype.usesWasm = function () { return !!(this.backend && this.backend.accurate); };

  Engine.prototype.label = function () {
    return this.backend ? this.backend.label : '未加载';
  };

  Engine.prototype.setWorld = function (world) {
    this.world.mc = world.mc;
    this.world.dim = world.dim;
    this.world.seedLo = world.seedLo;
    this.world.seedHi = world.seedHi;
    if (this.backend) this.backend.setWorld(this.world);
  };

  Engine.prototype.palette = function () {
    return this.backend ? this.backend.palette : MC.fallbackPalette();
  };

  Engine.prototype.biomeName = function (id) {
    return this.backend ? this.backend.biomeName(id) : 'unknown';
  };

  Engine.prototype.biomeZh = function (id) {
    var name = this.biomeName(id);
    return MC.BIOME_ZH[name] || name || '未知';
  };

  Engine.prototype.biomeAt = function (bx, bz) {
    return this.backend ? this.backend.biomeAt(bx, bz) : -1;
  };

  Engine.prototype.fillGrid = function (x0, z0, w, h, stride, out, y) {
    if (!this.backend) { out.fill(0); return -1; }
    return this.backend.fillGrid(x0, z0, w, h, stride, out, y);
  };

  Engine.prototype.spawn = function () {
    return this.backend ? this.backend.spawn() : null;
  };

  Engine.prototype.isSlimeChunk = function (cx, cz) {
    return this.backend ? this.backend.isSlimeChunk(cx, cz) : false;
  };

  /** 当前版本+维度下可用的建筑（区域大小为 0 表示该版本不支持） */
  Engine.prototype.availableStructures = function () {
    var self = this;
    return MC.STRUCTURES.filter(function (s) {
      return self.regionSize(s.key) > 0;
    });
  };

  Engine.prototype.regionSize = function (key) {
    if (!this.backend) return 0;
    return this.backend.regionSize(key) || 0;
  };

  Engine.prototype.structureAttempt = function (key, rx, rz) {
    if (!this.backend) return null;
    return this.backend.structureAttempt(key, rx, rz);
  };

  Engine.prototype.structureViable = function (key, bx, bz) {
    if (!this.backend) return false;
    return this.backend.structureViable(key, bx, bz);
  };

  /** 结构与当前维度是否匹配（下界/末地结构只在对应维度显示） */
  Engine.prototype.structureInDimension = function (key) {
    var def = MC.structureByKey(key);
    if (!def) return false;
    return def.dim === this.world.dim && this.regionSize(key) > 0;
  };

  MC.Engine = Engine;
})(globalThis.MC);
