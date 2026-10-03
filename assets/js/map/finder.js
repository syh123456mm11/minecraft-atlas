/*
 * 搜索器：从指定中心向外按环扫描，找出最近的建筑 / 群系。
 * 扫描量按结构区域大小自适应，避免小间隔结构（矿井、宝藏）把搜索范围撑爆。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var MAX_SCAN = 6000; // 单次搜索最多扫描的区域格数

  function ringCells(r) {
    var cells = [];
    if (r === 0) return [{ x: 0, z: 0 }];
    for (var dx = -r; dx <= r; dx++) {
      for (var dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r || Math.abs(dz) === r) cells.push({ x: dx, z: dz });
      }
    }
    return cells;
  }

  var Finder = {
    /** 当前版本可用群系列表（用于搜索面板） */
    listBiomes: function (engine) {
      var out = [], seen = new Set();
      for (var id = 0; id < 256; id++) {
        var name = engine.biomeName(id);
        if (!name || name === 'unknown' || seen.has(name)) continue;
        seen.add(name);
        out.push({ id: id, name: name, zh: MC.BIOME_ZH[name] || name });
      }
      out.sort(function (a, b) { return a.zh.localeCompare(b.zh, 'zh-CN'); });
      return out;
    },

    /**
     * 最近的建筑。返回 [{x,z,viable,dist}]，按距离升序。
     * 只统计 viable 的可生成点；attempts 为 true 时同时返回失败尝试点。
     */
    nearestStructure: function (engine, key, cx, cz, opts) {
      opts = opts || {};
      var limit = opts.limit || 8;
      var rs = engine.regionSize(key);
      if (!rs) return [];
      var rb = rs * 16;
      var maxRing = Math.min(Math.ceil((opts.maxRadius || 30000) / rb), Math.floor(Math.sqrt(MAX_SCAN) / 2));
      var cRx = Math.round(cx / rb), cRz = Math.round(cz / rb);
      var hits = [];
      for (var r = 0; r <= maxRing; r++) {
        var cells = ringCells(r);
        for (var i = 0; i < cells.length; i++) {
          var pos = engine.structureAttempt(key, cRx + cells[i].x, cRz + cells[i].z);
          if (!pos) continue;
          var viable = engine.structureViable(key, pos.x, pos.z);
          if (!viable && !opts.attempts) continue;
          var d = Math.hypot(pos.x - cx, pos.z - cz);
          if (opts.maxRadius && d > opts.maxRadius) continue;
          hits.push({ x: pos.x, z: pos.z, viable: viable, dist: d });
        }
        if (hits.length >= limit * 4) break;
      }
      hits.sort(function (a, b) { return a.dist - b.dist; });
      return hits.slice(0, limit);
    },

    /** 最近的指定群系。先粗扫定位，再在命中点附近细化，兼顾速度与精度 */
    nearestBiome: function (engine, id, cx, cz, opts) {
      opts = opts || {};
      var limit = opts.limit || 8;
      var radius = opts.maxRadius || 8000;
      var step = Math.max(16, Math.ceil(radius / 80 / 16) * 16);
      var rings = Math.ceil(radius / step);
      var found = [];
      for (var r = 0; r <= rings && found.length < limit * 3; r++) {
        var cells = ringCells(r);
        for (var i = 0; i < cells.length; i++) {
          var x = Math.round(cx / step) * step + cells[i].x * step;
          var z = Math.round(cz / step) * step + cells[i].z * step;
          if (engine.biomeAt(x, z) !== id) continue;
          var p = refine(engine, id, x, z, step);
          found.push({ x: p.x, z: p.z, dist: Math.hypot(p.x - cx, p.z - cz) });
        }
      }
      found.sort(function (a, b) { return a.dist - b.dist; });
      return found.slice(0, limit);
    }
  };

  /** 在粗扫命中点的 ±step 范围内以 step/4 细化，取最近的同群系点 */
  function refine(engine, id, x, z, step) {
    var sub = Math.max(4, Math.floor(step / 4));
    var best = { x: x, z: z, d: Infinity };
    for (var dx = -step; dx <= step; dx += sub) {
      for (var dz = -step; dz <= step; dz += sub) {
        if (engine.biomeAt(x + dx, z + dz) !== id) continue;
        var d = dx * dx + dz * dz;
        if (d < best.d) best = { x: x + dx, z: z + dz, d: d };
      }
    }
    return best;
  }

  MC.Finder = Finder;
})(globalThis.MC);
