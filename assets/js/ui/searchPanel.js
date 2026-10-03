/* 搜索面板：支持按名称过滤地形/建筑，并定位到距当前视图中心最近的一处 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var kind = 'biome';
  var cache = { biome: [], structure: [] };
  var results = [];
  var resultIndex = 0;
  var lastQuery = null;

  function rebuildCache(ctx) {
    cache.biome = MC.Finder.listBiomes(ctx.engine);
    cache.structure = ctx.engine.availableStructures().filter(function (s) {
      return s.dim === ctx.state.dim;
    });
    render(ctx, MC.util.qs('#searchInput').value);
  }

  function render(ctx, text) {
    var box = MC.util.qs('#searchResults');
    var q = String(text || '').trim().toLowerCase();
    box.innerHTML = '';
    var source = cache[kind];
    var list = !q ? source : source.filter(function (it) {
      var zh = (it.zh || '').toLowerCase();
      var en = (it.name || it.key || '').toLowerCase();
      return zh.indexOf(q) >= 0 || en.indexOf(q) >= 0;
    });
    if (!list.length) {
      // 近似引擎不提供结构，列表会整个空掉——得说清原因，否则像是搜索坏了
      var noEngine = kind === 'structure' && !ctx.engine.usesWasm();
      box.innerHTML = noEngine
        ? '<div class="result-empty">未加载 cubiomes 精确引擎，无法计算建筑位置。<br>' +
          MC.util.escape(ctx.engine.fallbackReason || '') + '</div>'
        : '<div class="result-empty">没有匹配项，换个关键词试试。</div>';
      return;
    }
    list.slice(0, 60).forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'result-item';
      var color = kind === 'biome' ? biomeColor(ctx, it.id) : it.color;
      row.innerHTML = '<span class="swatch" style="background:' + color + '"></span>' +
        '<span>' + MC.util.escape(it.zh) + '</span>' +
        '<span class="meta">' + MC.util.escape(it.name || it.key || '') + '</span>';
      row.addEventListener('click', function () { run(ctx, it); });
      box.appendChild(row);
    });
    if (list.length > 60) {
      var more = document.createElement('div');
      more.className = 'result-empty';
      more.textContent = '仅显示前 60 条，输入关键词以缩小范围。';
      box.appendChild(more);
    }
  }

  function biomeColor(ctx, id) {
    var pal = ctx.engine.palette();
    var base = (id >= 0 && id < 256 ? id : 0) * 3;
    return 'rgb(' + pal[base] + ',' + pal[base + 1] + ',' + pal[base + 2] + ')';
  }

  function run(ctx, item) {
    var status = MC.util.qs('#searchStatus');
    lastQuery = item;
    status.className = 'status';
    status.innerHTML = '<span class="spinner"></span> 正在搜索最近的' + (kind === 'biome' ? '地形' : '建筑') + '…';
    // 让出一帧，避免扫描期间界面无响应
    setTimeout(function () {
      var cx = ctx.map.centerX, cz = ctx.map.centerZ;
      try {
        results = kind === 'biome'
          ? MC.Finder.nearestBiome(ctx.engine, item.id, cx, cz, { maxRadius: 16000, limit: 5 })
          : MC.Finder.nearestStructure(ctx.engine, item.key, cx, cz, { maxRadius: 40000, limit: 5 });
      } catch (e) {
        results = [];
        console.error('[search]', e);
      }
      if (!results.length) {
        status.className = 'status is-error';
        status.textContent = '在搜索范围内没有找到「' + item.zh + '」，可以放大地图范围后重试。';
        return;
      }
      resultIndex = 0;
      showResult(ctx, item);
    }, 30);
  }

  function showResult(ctx, item) {
    var status = MC.util.qs('#searchStatus');
    var r = results[resultIndex];
    ctx.map.focus(r.x, r.z);
    ctx.map.setMarkers([{ x: r.x, z: r.z, kind: 'target', color: '#ff9500', label: item.zh }]);
    var extra = kind === 'structure' && r.viable === false ? '（生成尝试点，实际可能不会生成）' : '';
    status.className = 'status';
    status.innerHTML =
      '<div class="result-card">' +
      '<div class="title">' + MC.util.escape(item.zh) + ' #' + (resultIndex + 1) + extra + '</div>' +
      '<div class="coord">X ' + Math.round(r.x) + ' ，Z ' + Math.round(r.z) +
      ' ，距离 ' + MC.util.fmt(r.dist) + ' 格</div>' +
      '<div class="actions">' +
      '<button data-act="copy">复制坐标</button>' +
      (results.length > 1 ? '<button data-act="next">下一个（' + results.length + '）</button>' : '') +
      '</div></div>';
    MC.util.qsa('button', status).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.act === 'copy') {
          MC.util.copy('/tp ' + Math.round(r.x) + ' 120 ' + Math.round(r.z)).then(function () {
            btn.textContent = '已复制';
            setTimeout(function () { btn.textContent = '复制坐标'; }, 1200);
          }).catch(function () { btn.textContent = '复制失败'; });
        } else {
          resultIndex = (resultIndex + 1) % results.length;
          showResult(ctx, lastQuery);
        }
      });
    });
  }

  MC.SearchPanel = {
    init: function (ctx) {
      var seg = MC.util.qs('#searchSeg');
      MC.util.qsa('button', seg).forEach(function (b) {
        b.addEventListener('click', function () {
          kind = b.dataset.kind;
          MC.util.qsa('button', seg).forEach(function (x) { x.classList.remove('is-active'); });
          b.classList.add('is-active');
          MC.util.qs('#searchInput').placeholder = kind === 'biome' ? '搜索地形，如 樱花林 / cherry' : '搜索建筑，如 村庄 / village';
          render(ctx, MC.util.qs('#searchInput').value);
        });
      });
      MC.util.qs('#searchInput').addEventListener('input', function (e) {
        render(ctx, e.target.value);
      });
      MC.bus.on('world:changed', function () { rebuildCache(ctx); });
      rebuildCache(ctx);
    }
  };
})(globalThis.MC);
