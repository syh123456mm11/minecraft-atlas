/*
 * 地图视图：负责视口换算、群系位图渲染、图层叠加与鼠标/触摸交互。
 * 渲染分两步：先用上一帧位图做即时反馈（平移不白屏），新网格算完再替换。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var MAX_REGIONS = 12000;  // 单个结构类型的扫描上限，超出则该类型本帧不画
  var MAX_SLIME = 3000;     // 史莱姆区块绘制上限
  var STRUCT_REFRESH_MS = 120; // 拖动中建筑列表的最小重算间隔，防止逐帧全量扫描掉帧

  function MapView(canvas, engine, tileSource, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.tiles = tileSource;
    this.opts = options || {};

    this.centerX = 0;
    this.centerZ = 0;
    this.bpp = 4;                 // 每像素代表的方块数
    this.minBpp = 0.125;
    this.maxBpp = 64;

    this.bitmap = null;           // {canvas, x0, z0, cellBlocks}
    this.markers = [];            // 外部标记（玩家、搜索结果等）
    this.structures = [];         // 当前视口内的建筑
    this.spawn = null;
    this.options = {
      showStructures: true, showAttempts: false, showGrid: false,
      showSlime: false, quality: 160000
    };
    this.enabledStructures = null; // null 表示全部可用建筑
    this.progress = 1;
    this.rendering = false;
    this._gen = 0;
    this._dpr = Math.min(2, window.devicePixelRatio || 1);
    this._bindEvents();
    this.resize();
  }

  /** 让画布分辨率跟随容器尺寸与设备像素比 */
  MapView.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(64, Math.floor(rect.width));
    var h = Math.max(64, Math.floor(rect.height));
    if (this.cssW === w && this.cssH === h) return false;
    this.cssW = w; this.cssH = h;
    this.canvas.width = Math.floor(w * this._dpr);
    this.canvas.height = Math.floor(h * this._dpr);
    return true;
  };

  MapView.prototype.setOptions = function (patch) {
    Object.keys(patch).forEach(function (k) { this.options[k] = patch[k]; }, this);
    this.requestRender(true);
  };

  MapView.prototype.setEnabledStructures = function (keys) {
    this.enabledStructures = keys;
    this.requestRender(true);
  };

  MapView.prototype.setWorld = function (world) {
    this.world = { mc: world.mc, dim: world.dim, seedLo: world.seedLo, seedHi: world.seedHi };
    this.bitmap = null;
    // 位图与建筑都属于「上一个世界」。渲染是异步的，若不清空 structures，
    // 新地形算完之前 draw() 会把旧世界的遗迹叠在新地形上（看起来就是标记乱飘）。
    this.structures = [];
    this.requestRender(true);
  };

  MapView.prototype.setSpawn = function (spawn) { this.spawn = spawn; this.draw(); };

  MapView.prototype.setMarkers = function (list) { this.markers = list || []; this.draw(); };

  MapView.prototype.focus = function (x, z, bpp) {
    this.centerX = x; this.centerZ = z;
    if (bpp) this.bpp = MC.util.clamp(bpp, this.minBpp, this.maxBpp);
    this.requestRender(true);
  };

  MapView.prototype.zoomBy = function (factor, anchorX, anchorZ) {
    var next = MC.util.clamp(this.bpp * factor, this.minBpp, this.maxBpp);
    if (next === this.bpp) return;
    if (anchorX !== undefined) {
      // 保持锚点（光标下的方块）在屏幕同一位置
      var dx = (anchorX - this.centerX) * (1 - next / this.bpp);
      var dz = (anchorZ - this.centerZ) * (1 - next / this.bpp);
      this.centerX += dx; this.centerZ += dz;
    }
    this.bpp = next;
    this.requestRender(true);
  };

  MapView.prototype.screenToWorld = function (px, py) {
    return {
      x: this.centerX + (px - this.cssW / 2) * this.bpp,
      z: this.centerZ + (py - this.cssH / 2) * this.bpp
    };
  };

  MapView.prototype.worldToScreen = function (x, z) {
    return {
      x: (x - this.centerX) / this.bpp + this.cssW / 2,
      z: (z - this.centerZ) / this.bpp + this.cssH / 2
    };
  };

  /* ---------------- 渲染 ---------------- */

  MapView.prototype.requestRender = function (immediate) {
    var self = this;
    if (immediate) {
      this._render();
      return;
    }
    if (this._pending) return;
    this._pending = setTimeout(function () { self._pending = null; self._render(); }, 90);
  };

  MapView.prototype._gridPlan = function () {
    var worldW = this.cssW * this.bpp;
    var worldH = this.cssH * this.bpp;
    var stride = 1;
    var gw, gh;
    for (;;) {
      gw = Math.ceil(worldW / (stride * 4)) + 1;
      gh = Math.ceil(worldH / (stride * 4)) + 1;
      if (gw * gh <= this.options.quality) break;
      stride *= 2;
      if (stride > 4096) break;
    }
    var cellBlocks = stride * 4;
    var x0 = Math.floor((this.centerX - worldW / 2) / cellBlocks);
    var z0 = Math.floor((this.centerZ - worldH / 2) / cellBlocks);
    return { stride: stride, gw: gw, gh: gh, cellBlocks: cellBlocks, x0: x0, z0: z0 };
  };

  MapView.prototype._render = function () {
    var self = this;
    if (!this.world) return; // 世界尚未设置（例如未查询过的服务器视图）
    var gen = ++this._gen;
    this.rendering = true;
    this.progress = 0;
    var plan = this._gridPlan();
    var job = {
      mc: this.world.mc, dim: this.world.dim,
      seedLo: this.world.seedLo, seedHi: this.world.seedHi,
      x0: plan.x0, z0: plan.z0, w: plan.gw, h: plan.gh,
      stride: plan.stride, y: MC.sampleY(this.world.dim),
      engine: this.engine
    };
    this.tiles.request(job, function (p) {
      self.progress = p;
      if (p < 1) self.draw();
    }).then(function (data) {
      if (!data || gen !== self._gen) return;
      self._applyGrid(data, plan);
      self.refreshStructures();
      self.rendering = false;
      self.progress = 1;
      self.draw();
      if (self.opts.onRendered) self.opts.onRendered();
    }).catch(function (e) {
      console.error('[map] 渲染失败', e);
      self.rendering = false;
    });
    this.draw();
  };

  MapView.prototype._applyGrid = function (data, plan) {
    var pal = this.engine.palette();
    var off = document.createElement('canvas');
    off.width = plan.gw; off.height = plan.gh;
    var octx = off.getContext('2d');
    var img = octx.createImageData(plan.gw, plan.gh);
    var px = img.data;
    for (var i = 0; i < data.length; i++) {
      var id = data[i];
      var base = (id >= 0 && id < 256 ? id : 0) * 3;
      var o = i * 4;
      px[o] = pal[base]; px[o + 1] = pal[base + 1]; px[o + 2] = pal[base + 2]; px[o + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    this.bitmap = {
      canvas: off,
      x0: plan.x0 * plan.cellBlocks,
      z0: plan.z0 * plan.cellBlocks,
      cellBlocks: plan.cellBlocks
    };
  };

  MapView.prototype.draw = function () {
    if (!this.cssW) this.resize();
    var ctx = this.ctx;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.fillStyle = '#eef1f5';
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    var b = this.bitmap;
    if (b) {
      var px0 = (b.x0 - this.centerX) / this.bpp + this.cssW / 2;
      var pz0 = (b.z0 - this.centerZ) / this.bpp + this.cssH / 2;
      var w = b.canvas.width * b.cellBlocks / this.bpp;
      var h = b.canvas.height * b.cellBlocks / this.bpp;
      ctx.imageSmoothingEnabled = (b.cellBlocks / this.bpp) > 1.6;
      ctx.drawImage(b.canvas, px0, pz0, w, h);
      ctx.imageSmoothingEnabled = true;
    }

    if (this.options.showSlime) this._drawSlime(ctx);
    if (this.options.showGrid) this._drawGrid(ctx);
    if (this.options.showStructures) this._drawStructures(ctx);
    this._drawSpawn(ctx);
    this._drawMarkers(ctx);
    this._drawScale(ctx);
    if (this.progress < 1) this._drawProgress(ctx);
  };

  MapView.prototype._drawSlime = function (ctx) {
    var worldW = this.cssW * this.bpp, worldH = this.cssH * this.bpp;
    var cx0 = Math.floor((this.centerX - worldW / 2) / 16);
    var cz0 = Math.floor((this.centerZ - worldH / 2) / 16);
    var nx = Math.ceil(worldW / 16), nz = Math.ceil(worldH / 16);
    if (nx * nz > MAX_SLIME) return;
    ctx.save();
    ctx.fillStyle = 'rgba(120, 220, 120, 0.45)';
    for (var i = 0; i < nx; i++) {
      for (var j = 0; j < nz; j++) {
        if (!this.engine.isSlimeChunk(cx0 + i, cz0 + j)) continue;
        var p = this.worldToScreen((cx0 + i) * 16, (cz0 + j) * 16);
        var s = 16 / this.bpp;
        ctx.fillRect(p.x, p.z, s, s);
      }
    }
    ctx.restore();
  };

  MapView.prototype._drawGrid = function (ctx) {
    var step = this.bpp <= 2 ? 16 : (this.bpp <= 12 ? 128 : 512);
    var worldW = this.cssW * this.bpp, worldH = this.cssH * this.bpp;
    var x0 = Math.floor((this.centerX - worldW / 2) / step) * step;
    var z0 = Math.floor((this.centerZ - worldH / 2) / step) * step;
    var x1 = this.centerX + worldW / 2, z1 = this.centerZ + worldH / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = x0; x <= x1; x += step) {
      var p = this.worldToScreen(x, 0);
      ctx.moveTo(p.x, 0); ctx.lineTo(p.x, this.cssH);
    }
    for (var z = z0; z <= z1; z += step) {
      var q = this.worldToScreen(0, z);
      ctx.moveTo(0, q.z); ctx.lineTo(this.cssW, q.z);
    }
    ctx.stroke();
    ctx.restore();
  };

  /**
   * 视口指纹：中心与缩放决定「哪些区域落在视野内」。
   * 只在这些值变化时才需要重算建筑列表（拖动/缩放/切换世界）。
   */
  MapView.prototype._viewportKey = function () {
    return this.centerX + '|' + this.centerZ + '|' + this.bpp + '|' +
      (this.world ? this.world.mc + ':' + this.world.dim + ':' + this.world.seedLo + ':' + this.world.seedHi : '');
  };

  /** 扫描视口内所有建筑的生成尝试点，并按可生成性区分显示 */
  MapView.prototype.refreshStructures = function () {
    this._structuresKey = this._viewportKey();
    this._lastStructAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var list = [];
    if (!this.world || !this.engine) { this.structures = list; return list; }
    var worldW = this.cssW * this.bpp, worldH = this.cssH * this.bpp;
    var wx0 = this.centerX - worldW / 2, wx1 = this.centerX + worldW / 2;
    var wz0 = this.centerZ - worldH / 2, wz1 = this.centerZ + worldH / 2;
    var defs = this.engine.availableStructures().filter(function (s) {
      return s.dim === this.world.dim &&
        (!this.enabledStructures || this.enabledStructures.indexOf(s.key) >= 0);
    }, this);

    // 逐类型判断扫描量：小间隔结构（矿井、宝藏等）在缩得很小时会爆炸，超预算就跳过该类型
    this.structureOverflow = false;
    var used = 0;
    defs.forEach(function (def) {
      var rs = this.engine.regionSize(def.key);
      if (!rs) return;
      var rb = rs * 16;
      var rx0 = Math.floor(wx0 / rb), rx1 = Math.floor(wx1 / rb);
      var rz0 = Math.floor(wz0 / rb), rz1 = Math.floor(wz1 / rb);
      var count = (rx1 - rx0 + 1) * (rz1 - rz0 + 1);
      if (count > MAX_REGIONS || used + count > MAX_REGIONS * 2.5) { this.structureOverflow = true; return; }
      used += count;
      for (var rx = rx0; rx <= rx1; rx++) {
        for (var rz = rz0; rz <= rz1; rz++) {
          var pos = this.engine.structureAttempt(def.key, rx, rz);
          if (!pos) continue;
          if (pos.x < wx0 - rb || pos.x > wx1 + rb || pos.z < wz0 - rb || pos.z > wz1 + rb) continue;
          var viable = this.engine.structureViable(def.key, pos.x, pos.z);
          if (!viable && !this.options.showAttempts) continue;
          list.push({ def: def, x: pos.x, z: pos.z, viable: viable });
        }
      }
    }, this);
    this.structures = list;
    return list;
  };

  MapView.prototype._drawStructures = function (ctx) {
    // 结构必须跟随当前视口：拖动/缩放后只 draw() 会用到旧视口的列表，
    // 导致边缘新进入视野的建筑不出现（忽隐忽现）。按视口键判断是否需要重算，
    // 但全量扫描约几十毫秒，拖动中逐帧重算会掉帧 —— 因此加时间节流：
    // 拖动中最多每 STRUCT_REFRESH_MS 重算一次，松手后由 requestRender 立即补齐。
    if (this._structuresKey !== this._viewportKey() &&
      (!this._lastStructAt || performance.now() - this._lastStructAt >= STRUCT_REFRESH_MS)) {
      this.refreshStructures();
    }
    var self = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    this.structures.forEach(function (s) {
      var p = self.worldToScreen(s.x, s.z);
      if (p.x < -20 || p.z < -20 || p.x > self.cssW + 20 || p.z > self.cssH + 20) return;
      var r = s.viable ? 10 : 5;
      ctx.beginPath();
      ctx.arc(p.x, p.z, r, 0, Math.PI * 2);
      if (s.viable) {
        ctx.fillStyle = s.def.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '600 11px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText(s.def.mark, p.x, p.z + 0.5);
      } else {
        ctx.fillStyle = 'rgba(90,90,90,0.35)';
        ctx.fill();
      }
      s._sx = p.x; s._sz = p.z; s._r = r;
    });
    ctx.restore();
  };

  MapView.prototype._drawSpawn = function (ctx) {
    if (!this.spawn) return;
    var p = this.worldToScreen(this.spawn.x, this.spawn.z);
    ctx.save();
    ctx.translate(p.x, p.z);
    ctx.fillStyle = '#ff3b30';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(9, 8); ctx.lineTo(-9, 8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 9px -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('出', 0, 3);
    ctx.restore();
  };

  MapView.prototype._drawMarkers = function (ctx) {
    var self = this;
    this.markers.forEach(function (m) {
      var p = self.worldToScreen(m.x, m.z);
      if (p.x < -40 || p.z < -40 || p.x > self.cssW + 40 || p.z > self.cssH + 40) return;
      ctx.save();
      if (m.kind === 'target') {
        ctx.strokeStyle = m.color || '#0071e3';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.z, 16, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - 24, p.z); ctx.lineTo(p.x + 24, p.z);
        ctx.moveTo(p.x, p.z - 24); ctx.lineTo(p.x, p.z + 24);
        ctx.stroke();
      } else {
        ctx.fillStyle = m.color || '#0071e3';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.z, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (m.label) {
          ctx.font = '600 11px -apple-system, "PingFang SC", sans-serif';
          var w = ctx.measureText(m.label).width;
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fillRect(p.x - w / 2 - 5, p.z + 12, w + 10, 16);
          ctx.fillStyle = '#1d1d1f';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(m.label, p.x, p.z + 20);
        }
      }
      m._sx = p.x; m._sz = p.z;
      ctx.restore();
    });
  };

  MapView.prototype._drawScale = function (ctx) {
    var target = 120;
    var blocks = target * this.bpp;
    var steps = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
    var chosen = steps[0];
    for (var i = 0; i < steps.length; i++) { if (steps[i] <= blocks) chosen = steps[i]; }
    var px = chosen / this.bpp;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(14, this.cssH - 30, 96, 20);
    ctx.strokeRect(14, this.cssH - 30, 96, 20);
    ctx.beginPath();
    ctx.moveTo(20, this.cssH - 14); ctx.lineTo(20, this.cssH - 22);
    ctx.lineTo(20 + px, this.cssH - 22); ctx.lineTo(20 + px, this.cssH - 14);
    ctx.stroke();
    ctx.fillStyle = '#1d1d1f';
    ctx.font = '600 10px -apple-system, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(MC.util.fmt(chosen) + ' 格', 20 + px + 6, this.cssH - 19);
    ctx.restore();
  };

  MapView.prototype._drawProgress = function (ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(this.cssW / 2 - 60, 16, 120, 4);
    ctx.fillStyle = '#0071e3';
    ctx.fillRect(this.cssW / 2 - 60, 16, 120 * MC.util.clamp(this.progress, 0, 1), 4);
    ctx.restore();
  };

  MapView.prototype.hitTest = function (px, py) {
    var best = null, bestD = 16;
    var self = this;
    (this.structures || []).forEach(function (s) {
      if (s._sx === undefined) return;
      var d = Math.hypot(s._sx - px, s._sz - py);
      if (d < bestD) { bestD = d; best = { type: 'structure', data: s }; }
    });
    (this.markers || []).forEach(function (m) {
      if (m._sx === undefined) return;
      var d = Math.hypot(m._sx - px, m._sz - py);
      if (d < bestD) { bestD = d; best = { type: 'marker', data: m }; }
    });
    if (this.spawn) {
      var p = this.worldToScreen(this.spawn.x, this.spawn.z);
      var d = Math.hypot(p.x - px, p.z - py);
      if (d < bestD) best = { type: 'spawn', data: this.spawn };
    }
    return best;
  };

  /* ---------------- 交互 ---------------- */

  MapView.prototype._bindEvents = function () {
    var self = this;
    var dragging = false, moved = false, lastX = 0, lastZ = 0;
    var pointers = new Map();
    var pinchStart = null;

    this.canvas.addEventListener('pointerdown', function (e) {
      self.canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        var pts = Array.from(pointers.values());
        pinchStart = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), bpp: self.bpp };
        dragging = false;
        return;
      }
      dragging = true; moved = false;
      lastX = e.clientX; lastZ = e.clientY;
    });

    this.canvas.addEventListener('pointermove', function (e) {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinchStart && pointers.size === 2) {
        var pts = Array.from(pointers.values());
        var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (d > 4) {
          self.bpp = MC.util.clamp(pinchStart.bpp * (pinchStart.dist / d), self.minBpp, self.maxBpp);
          self.requestRender(true);
        }
        return;
      }

      var rect = self.canvas.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      var w = self.screenToWorld(px, py);
      var hit = self.hitTest(px, py);
      if (self.opts.onHover) {
        self.opts.onHover({
          x: Math.floor(w.x), z: Math.floor(w.z),
          biome: self.engine.biomeZh(self.engine.biomeAt(w.x, w.z)),
          chunkX: Math.floor(w.x / 16), chunkZ: Math.floor(w.z / 16),
          hit: hit, px: e.clientX, py: e.clientY
        });
      }
      if (!dragging) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastZ;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      self.centerX -= dx * self.bpp;
      self.centerZ -= dy * self.bpp;
      lastX = e.clientX; lastZ = e.clientY;
      self.draw();
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (dragging) {
        dragging = false;
        if (moved) {
          // 立即按最终视口补齐建筑，别等 debounce —— 否则松手后标记会滞后/忽隐忽现
          self.refreshStructures();
          self.draw();
          self.requestRender(false);
        }
      }
    }
    this.canvas.addEventListener('pointerup', endPointer);
    this.canvas.addEventListener('pointercancel', endPointer);
    this.canvas.addEventListener('pointerleave', function () {
      if (self.opts.onHover) self.opts.onHover(null);
    });

    this.canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = self.canvas.getBoundingClientRect();
      var px = e.clientX - rect.left, py = e.clientY - rect.top;
      var w = self.screenToWorld(px, py);
      self.zoomBy(e.deltaY > 0 ? 1.18 : 0.847, w.x, w.z);
    }, { passive: false });

    this.canvas.addEventListener('click', function (e) {
      if (moved) return;
      var rect = self.canvas.getBoundingClientRect();
      var hit = self.hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hit && self.opts.onSelect) self.opts.onSelect(hit);
    });

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(MC.util.debounce(function () {
        if (self.resize()) self.requestRender(true);
      }, 120));
      this._ro.observe(this.canvas);
    }
  };

  MC.MapView = MapView;
})(globalThis.MC);
