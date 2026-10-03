/* 左侧「世界设定 / 显示选项」面板：只负责采集输入并回调宿主，不直接操作地图 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var enabledStructures = null; // null = 全部可用
  var els = {};

  function buildVersion(ctx) {
    var sel = MC.util.qs('#versionSelect');
    sel.innerHTML = '';
    MC.VERSIONS.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v.label;
      o.textContent = 'Java ' + v.label;
      sel.appendChild(o);
    });
    sel.value = ctx.state.version;
    sel.addEventListener('change', function () {
      ctx.state.version = sel.value;
      ctx.updateWorld();
    });
    els.version = sel;
  }

  function buildDimensions(ctx) {
    var seg = MC.util.qs('#dimSeg');
    seg.innerHTML = '';
    MC.DIMENSIONS.forEach(function (d) {
      var b = document.createElement('button');
      b.textContent = d.label;
      b.dataset.dim = String(d.id);
      b.className = d.id === ctx.state.dim ? 'is-active' : '';
      b.addEventListener('click', function () {
        ctx.state.dim = d.id;
        MC.util.qsa('button', seg).forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
        ctx.updateWorld();
      });
      seg.appendChild(b);
    });
  }

  function buildSeed(ctx) {
    var input = MC.util.qs('#seedInput');
    var random = MC.util.qs('#seedRandom');
    input.value = ctx.state.seedText;
    input.addEventListener('input', MC.util.debounce(function () {
      ctx.state.seedText = input.value;
      ctx.updateWorld();
    }, 350));
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { ctx.state.seedText = input.value; ctx.updateWorld(); }
    });
    random.addEventListener('click', function () {
      input.value = MC.util.randomSeed();
      ctx.state.seedText = input.value;
      ctx.updateWorld();
    });
    els.seed = input;
  }

  function buildOptions(ctx) {
    bindCheck('#optStructures', 'showStructures');
    bindCheck('#optAttempts', 'showAttempts');
    bindCheck('#optGrid', 'showGrid');
    bindCheck('#optSlime', 'showSlime');

    function bindCheck(sel, key) {
      var box = MC.util.qs(sel);
      box.checked = ctx.map.options[key];
      box.addEventListener('change', function () {
        var patch = {};
        patch[key] = box.checked;
        ctx.map.setOptions(patch);
      });
    }

    var q = MC.util.qs('#qualitySelect');
    q.value = String(ctx.map.options.quality);
    q.addEventListener('change', function () {
      ctx.map.setOptions({ quality: parseInt(q.value, 10) });
    });
  }

  /** 版本/维度变化后重建建筑开关（不同版本可用建筑不同） */
  function refreshStructures(ctx) {
    var box = MC.util.qs('#structList');
    box.innerHTML = '';
    var defs = ctx.engine.availableStructures().filter(function (s) {
      return s.dim === ctx.state.dim;
    });
    if (!defs.length) {
      box.innerHTML = '<div class="hint">该维度在当前版本没有可查询的建筑。</div>';
      return;
    }
    defs.forEach(function (def) {
      var on = !enabledStructures || enabledStructures.indexOf(def.key) >= 0;
      var chip = document.createElement('span');
      chip.className = 'chip' + (on ? '' : ' is-off');
      chip.innerHTML = '<span class="swatch" style="background:' + def.color + '"></span>' + def.zh;
      chip.addEventListener('click', function () {
        var all = defs.map(function (d) { return d.key; });
        if (!enabledStructures) enabledStructures = all.slice();
        var i = enabledStructures.indexOf(def.key);
        if (i >= 0) enabledStructures.splice(i, 1);
        else enabledStructures.push(def.key);
        ctx.map.setEnabledStructures(enabledStructures.slice());
        refreshStructures(ctx);
      });
      box.appendChild(chip);
    });
  }

  function refreshHint(ctx) {
    var hint = MC.util.qs('#seedHint');
    if (!ctx.state.seed) { hint.textContent = ''; return; }
    hint.textContent = ctx.state.seed.isText
      ? '文本种子按 Java hashCode 转换，与游戏内一致：' + ctx.state.seed.value
      : '数值种子：' + ctx.state.seed.display;
  }

  /**
   * 从外部套用一整套世界设定（云端收藏跳转）：
   * 只改写面板自己的输入控件并同步 state，再交给宿主的 updateWorld，
   * 这样下拉框、维度按钮、种子输入框不会出现「界面与状态不一致」。
   */
  function apply(ctx, mark) {
    if (els.version && mark.version && MC.VERSIONS.some(function (v) { return v.label === mark.version; })) {
      els.version.value = mark.version;
      ctx.state.version = mark.version;
    }
    var dim = Number(mark.dim) || 0;
    MC.util.qsa('#dimSeg button').forEach(function (b) {
      b.classList.toggle('is-active', Number(b.dataset.dim) === dim);
    });
    ctx.state.dim = dim;

    if (els.seed && mark.seedText) {
      els.seed.value = mark.seedText;
      ctx.state.seedText = mark.seedText;
    }
    ctx.updateWorld();

    // 世界切换是异步的，等一拍再定位，保证用的是新世界
    setTimeout(function () {
      ctx.map.focus(mark.x, mark.z, mark.zoom > 0 ? mark.zoom : undefined);
    }, 60);
  }

  MC.SeedPanel = {
    init: function (ctx) {
      buildVersion(ctx);
      buildDimensions(ctx);
      buildSeed(ctx);
      buildOptions(ctx);
      MC.bus.on('world:changed', function () {
        refreshHint(ctx);
        refreshStructures(ctx);
      });
    },
    apply: apply,
    refreshHint: refreshHint,
    refreshStructures: refreshStructures
  };
})(globalThis.MC);
