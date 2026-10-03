/* 应用装配：创建引擎与两张地图、串联面板、处理视图切换与 HUD */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var state = {
    version: MC.DEFAULT_VERSION,
    dim: 0,
    seedText: '20261002',
    seed: null
  };

  var engine = new MC.Engine();
  var serverEngine = new MC.Engine();
  var tiles = null;
  var map = null;
  var serverMap = null;
  var ctx = null;
  var spawn = null;
  var serverWorld = null;

  function worldParams(seed) {
    return {
      mc: MC.resolveMc(state.version),
      dim: state.dim,
      seedLo: seed.lo,
      seedHi: seed.hi
    };
  }

  /** 版本/维度/种子变化后刷新世界 */
  function updateWorld(focusSpawn) {
    state.seed = MC.util.parseSeed(state.seedText);
    var p = worldParams(state.seed);
    engine.setWorld(p);
    map.setWorld(p);
    MC.bus.emit('world:changed');
    updateLegend();
    setTimeout(function () {
      spawn = engine.spawn();
      map.setSpawn(spawn);
      if (focusSpawn && spawn) map.focus(spawn.x, spawn.z);
    }, 20);
  }

  function updateLegend() {
    var defs = engine.availableStructures().filter(function (s) { return s.dim === state.dim; });
    var box = MC.util.qs('#legend');
    // 近似引擎算不出建筑位置，必须讲清楚，否则用户会以为这片世界没有建筑
    if (!engine.usesWasm()) {
      box.innerHTML = '<div class="legend-title">建筑位置不可用</div>' +
        '<div class="legend-items"><span class="legend-item">' +
        MC.util.escape(engine.fallbackReason || '未加载 cubiomes 精确引擎') +
        '。用本地 HTTP 服务打开可恢复。</span></div>';
      return;
    }
    if (!defs.length) { box.innerHTML = '<div class="legend-title">当前维度无可显示建筑</div>'; return; }
    var html = '<div class="legend-title">建筑图例</div><div class="legend-items">';
    defs.forEach(function (d) {
      html += '<span class="legend-item"><span class="swatch" style="background:' + d.color + '"></span>' + d.zh + '</span>';
    });
    html += '</div>';
    box.innerHTML = html;
  }

  function setBadge() {
    var badge = MC.util.qs('#engineBadge');
    var accurate = engine.usesWasm();
    badge.className = 'engine-badge ' + (accurate ? 'is-accurate' : 'is-fallback');
    MC.util.qs('#engineText').textContent = accurate ? 'cubiomes 精确引擎' : '近似引擎（离线兜底）';
    badge.title = accurate
      ? '地形与建筑位置由 cubiomes（Java 版官方算法移植）计算，结果与游戏内一致。'
      : '未加载 cubiomes：' + (engine.fallbackReason || '未知原因') + '。以 file:// 打开时浏览器禁止加载 WASM，用本地 HTTP 服务打开即可恢复精确引擎。';
  }

  function showTooltip(text, px, py, stage) {
    var tip = MC.util.qs(stage === 'server' ? '#tooltip' : '#tooltip');
    if (!tip) return;
    if (!text) { tip.classList.remove('is-visible'); return; }
    var rect = tip.parentElement.getBoundingClientRect();
    tip.textContent = text;
    tip.style.left = (px - rect.left) + 'px';
    tip.style.top = (py - rect.top) + 'px';
    tip.classList.add('is-visible');
  }

  function hudText(info) {
    return '坐标 <b>X ' + info.x + '</b><span class="sep">·</span><b>Z ' + info.z + '</b>' +
      '<span class="sep">·</span>区块 (' + info.chunkX + ', ' + info.chunkZ + ')' +
      '<span class="sep">·</span>' + MC.util.escape(info.biome);
  }

  function bindMapHud(view, hudSel) {
    view.opts.onHover = function (info) {
      if (!info) {
        MC.util.qs(hudSel).textContent = hudSel === '#serverCoordHud' ? '服务器世界视图' : '移动鼠标查看坐标';
        showTooltip('');
        return;
      }
      MC.util.qs(hudSel).innerHTML = hudText(info);
      if (info.hit) {
        var h = info.hit;
        var text = h.type === 'structure'
          ? h.data.def.zh + '（' + (h.data.viable ? '可生成' : '尝试点') + '） X ' + h.data.x + ' Z ' + h.data.z
          : h.type === 'marker' ? (h.data.label || '标记') + ' X ' + Math.round(h.data.x) + ' Z ' + Math.round(h.data.z)
            : '出生点 X ' + h.data.x + ' Z ' + h.data.z;
        showTooltip(text, info.px, info.py);
      } else {
        showTooltip('');
      }
    };
    view.opts.onSelect = function (hit) {
      if (hit.type === 'structure') {
        MC.util.copy('/tp ' + hit.data.x + ' 120 ' + hit.data.z);
      }
    };
  }

  function switchView(name) {
    MC.util.qsa('#tabs .tab').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.view === name);
    });
    MC.util.qs('#view-seed').classList.toggle('is-hidden', name !== 'seed');
    MC.util.qs('#view-server').classList.toggle('is-hidden', name !== 'server');
    // 窄屏是纵向滚动的，切页后回到顶部，否则会停在上一页的滚动位置看不到地图
    if (window.scrollTo) window.scrollTo(0, 0);
    if (name === 'server') {
      ensureServerEngine();
      if (serverMap) { serverMap.resize(); serverMap.requestRender(true); }
    } else if (map) {
      map.resize();
      map.requestRender(true);
    }
  }

  /** 服务器视图用到第二个引擎实例（世界种子不同，避免与主地图互相干扰） */
  function ensureServerEngine() {
    if (serverEngine.ready) {
      if (!serverWorld) serverWorld = { host: 'mc.example.com', version: '' };
      applyServerWorld();
      return;
    }
    var wasmUrl = MC.util.asset('assets/vendor/seedmaps-engine-wasm/seed_engine.js');
    serverEngine.init(wasmUrl).then(function () {
      if (!serverWorld) serverWorld = { host: 'mc.example.com', version: '' };
      applyServerWorld();
      if (serverMap) serverMap.requestRender(true);
    });
  }

  function applyServerWorld() {
    if (!serverWorld || !serverEngine.ready || !serverMap) return;
    var seed = MC.util.parseSeed(String(MC.util.javaHash(serverWorld.host)));
    var p = { mc: MC.resolveMc(matchVersion(serverWorld.version) || state.version), dim: 0, seedLo: seed.lo, seedHi: seed.hi };
    serverEngine.setWorld(p);
    serverMap.setWorld(p);
  }

  /** 把服务器返回的版本串尽量匹配到已知版本；匹配不到则用当前选择的版本 */
  function matchVersion(versionText) {
    var raw = String(versionText || '').trim();
    if (!raw) return null;
    for (var i = 0; i < MC.VERSIONS.length; i++) {
      if (raw.indexOf(MC.VERSIONS[i].label) === 0) return MC.VERSIONS[i].label;
    }
    var m = raw.match(/^1\.(\d+)/);
    if (!m) return null;
    var major = '1.' + m[1];
    for (var j = MC.VERSIONS.length - 1; j >= 0; j--) {
      if (MC.VERSIONS[j].label.indexOf(major + '.') === 0) return MC.VERSIONS[j].label;
    }
    return null;
  }

  /**
   * 移动端默认降到「流畅」档。
   * 原理：cubiomes 是单线程 C 代码，采样点数量直接决定渲染耗时，
   * 手机 CPU 通常比桌面慢数倍，沿用桌面的 16 万采样会明显卡顿。
   */
  function defaultQuality() {
    var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    var small = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 640;
    return (coarse || small) ? 80000 : 160000;
  }

  /** 触摸设备没有“移动鼠标”这回事，把提示换成说得通的说法 */
  function applyTouchHints() {
    if (!(window.matchMedia && window.matchMedia('(hover: none)').matches)) return;
    var hud = MC.util.qs('#coordHud');
    if (hud && hud.textContent.indexOf('鼠标') >= 0) hud.textContent = '拖动地图 · 双指缩放';
  }

  function showIntro() {
    var intro = MC.util.qs('#intro');
    if (!intro) return;
    intro.hidden = false;
    void intro.offsetWidth; // 强制 reflow，确保开场动画从头播放
    intro.classList.add('is-in');

    var enter = MC.util.qs('#introEnter');
    var touchNote = MC.util.qs('#introTouchWarn');
    if (!MC.util.isTouchDevice()) {
      // 非触屏：禁用进入并高亮注意事项（网站介绍仍可被浏览）
      if (enter) {
        enter.disabled = true;
        enter.textContent = '非触屏暂不可用 w(ﾟДﾟ)w';
        enter.classList.add('is-blocked');
      }
      if (touchNote) touchNote.classList.add('is-active');
    }
    if (enter) {
      enter.addEventListener('click', function () {
        if (!MC.util.isTouchDevice()) return; // 双保险：非触屏不可进入
        intro.classList.add('is-out');
        setTimeout(function () { intro.hidden = true; intro.classList.remove('is-out', 'is-in'); }, 420);
      });
    }
  }

  function boot() {
    // 先展示欢迎页（MC 风格 + 进入动画），触屏设备点“进入”后开始使用
    showIntro();

    var wasmUrl = MC.util.asset('assets/vendor/seedmaps-engine-wasm/seed_engine.js');
    tiles = new MC.TileSource(engine);

    map = new MC.MapView(MC.util.qs('#map'), engine, tiles, {});
    serverMap = new MC.MapView(MC.util.qs('#serverMap'), serverEngine, tiles, {});
    // 渲染选项走 setOptions（构造函数的第四个参数只承载回调，不合并渲染选项）
    var q = defaultQuality();
    map.setOptions({ quality: q });
    serverMap.setOptions({ quality: q });
    applyTouchHints();
    bindMapHud(map, '#coordHud');
    bindMapHud(serverMap, '#serverCoordHud');

    ctx = {
      engine: engine,
      serverEngine: serverEngine,
      state: state,
      map: map,
      serverMap: serverMap,
      updateWorld: updateWorld
    };

    MC.SeedPanel.init(ctx);
    MC.SearchPanel.init(ctx);
    MC.ServerPanel.init(ctx);
    MC.MarksPanel.init(ctx);

    MC.bus.on('server:world', function (res) {
      serverWorld = res;
      if (!serverMap) return;
      serverMap.focus(0, 0, 8);
      applyServerWorld();
    });
    MC.bus.on('server:markers', function (list) { serverMap.setMarkers(list); });
    MC.bus.on('server:focus', function (p) { serverMap.focus(p.x, p.z); });

    MC.util.qs('#zoomIn').addEventListener('click', function () { map.zoomBy(0.6); });
    MC.util.qs('#zoomOut').addEventListener('click', function () { map.zoomBy(1 / 0.6); });
    MC.util.qs('#goSpawn').addEventListener('click', function () {
      if (spawn) map.focus(spawn.x, spawn.z);
    });
    MC.util.qs('#goOrigin').addEventListener('click', function () { map.focus(0, 0); });
    MC.util.qs('#serverZoomIn').addEventListener('click', function () { serverMap.zoomBy(0.6); });
    MC.util.qs('#serverZoomOut').addEventListener('click', function () { serverMap.zoomBy(1 / 0.6); });
    MC.util.qs('#serverFocus').addEventListener('click', function () {
      var mine = serverMap.markers.filter(function (m) { return m.color === '#ff3b30'; })[0];
      if (mine) serverMap.focus(mine.x, mine.z);
    });

    MC.util.qsa('#tabs .tab').forEach(function (b) {
      b.addEventListener('click', function () { switchView(b.dataset.view); });
    });

    engine.init(wasmUrl)
      .then(function () { return tiles.init(wasmUrl); })
      .then(function () {
        setBadge();
        updateWorld(true);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(globalThis.MC);
