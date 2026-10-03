/*
 * 本地数据面板：种子收藏 + 服务器查询历史。
 * 只做「渲染 + 调用数据仓库」，不碰地图与世界状态——跳转变由事件交给宿主处理。
 * 数据全部落在访问者自己的浏览器里（见 data/localStore.js），没有账号，也不需要登录。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var ctx = null;
  var marks = [];
  var history = [];
  var confirmTimers = new Map();

  function timeText(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return sameDay ? ('今天 ' + hh + ':' + mm) : (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hh + ':' + mm;
  }

  /** 告诉用户数据到底存在哪：能用本地存储就说清楚范围，不能就明确告知会丢 */
  function renderStoreHint() {
    var info = MC.data.storageInfo();
    var text = info.persistent
      ? '保存在本机浏览器（localStorage），只对 ' + info.scope + ' 可见，不会上传到任何服务器。'
      : '当前浏览器不允许写入本地存储' + (info.reason ? '（' + info.reason + '）' : '') + '，记录只保留到关闭页面。';
    ['#markStoreHint', '#historyStoreHint'].forEach(function (sel) {
      var el = MC.util.qs(sel);
      if (el) el.textContent = text;
    });
  }

  function renderMarks() {
    var box = MC.util.qs('#markList');
    if (!marks.length) {
      box.innerHTML = '<div class="empty-state">还没有收藏。找到好地图时点上面的「收藏」保存当前视野。</div>';
      return;
    }
    box.innerHTML = marks.map(function (m) {
      return '<div class="mark-row" data-id="' + m.id + '">' +
        '<span class="mark-dot"></span>' +
        '<div class="mark-main">' +
        '<div class="mark-title">' + MC.util.escape(m.label || ('种子 ' + m.seedText)) + '</div>' +
        '<div class="mark-sub">种子 ' + MC.util.escape(m.seedText) + ' · Java ' + MC.util.escape(m.version) +
        ' · X ' + Math.round(m.x) + ' Z ' + Math.round(m.z) + '</div>' +
        '<div class="mark-sub dim">' + MC.util.escape(dimLabel(m.dim)) + ' · ' + timeText(m.createdAt) + '</div>' +
        '</div>' +
        '<button class="icon-btn" data-act="goto" title="跳转">↗</button>' +
        '<button class="icon-btn danger" data-act="del" title="删除">✕</button>' +
        '</div>';
    }).join('');
  }

  function dimLabel(dim) {
    var d = (MC.DIMENSIONS || []).filter(function (x) { return x.id === dim; })[0];
    return d ? d.label : '主世界';
  }

  function renderHistory() {
    var box = MC.util.qs('#historyList');
    if (!history.length) {
      box.innerHTML = '<div class="empty-state">暂无记录，查询过的服务器会出现在这里。</div>';
      return;
    }
    box.innerHTML = history.map(function (h) {
      var count = (h.online == null) ? '' : (' · 在线 ' + h.online + (h.max != null ? '/' + h.max : ''));
      return '<div class="mark-row" data-id="' + h.id + '">' +
        '<span class="mark-dot alt"></span>' +
        '<div class="mark-main">' +
        '<div class="mark-title">' + MC.util.escape(h.host) + '</div>' +
        '<div class="mark-sub">' + (h.version ? MC.util.escape(h.version) + ' · ' : '') + timeText(h.createdAt) + count + '</div>' +
        '</div>' +
        '<button class="icon-btn" data-act="requery" title="重新查询">↻</button>' +
        '<button class="icon-btn danger" data-act="del" title="删除">✕</button>' +
        '</div>';
    }).join('');
  }

  function showError(boxSel, err) {
    MC.util.qs(boxSel).innerHTML = '<div class="empty-state">' + MC.util.escape(err.message || '读取失败') + '</div>';
  }

  function loadMarks() {
    return MC.data.listMarks().then(function (list) {
      marks = list;
      renderMarks();
      renderStoreHint();
    }).catch(function (err) {
      marks = [];
      showError('#markList', err);
    });
  }

  function loadHistory() {
    return MC.data.listHistory().then(function (list) {
      history = list;
      renderHistory();
      renderStoreHint();
    }).catch(function (err) {
      history = [];
      showError('#historyList', err);
    });
  }

  function currentMark(label) {
    var m = ctx.map;
    return {
      seedText: ctx.state.seedText,
      version: ctx.state.version,
      dim: ctx.state.dim,
      x: m.centerX,
      z: m.centerZ,
      zoom: m.bpp,
      label: label || '',
      note: ''
    };
  }

  function addMark() {
    var label = (MC.util.qs('#markLabel').value || '').trim();
    var btn = MC.util.qs('#markAdd');
    btn.disabled = true;
    MC.data.addMark(currentMark(label)).then(function () {
      MC.util.qs('#markLabel').value = '';
      MC.toast('已保存到本机收藏', 'ok');
      return loadMarks();
    }).catch(function (err) {
      MC.toast(err.message || '保存失败', 'error');
    }).then(function () { btn.disabled = false; });
  }

  /** 删除需要二次确认：第一次点击把按钮切成「确认」，3 秒未确认自动复原 */
  function armConfirm(btn, id, act) {
    btn.textContent = '确认';
    btn.classList.add('is-armed');
    var timer = setTimeout(function () {
      btn.textContent = act === 'del' ? '✕' : '↻';
      btn.classList.remove('is-armed');
      confirmTimers.delete(id);
    }, 3000);
    confirmTimers.set(id, timer);
  }

  function onListClick(e, isMark) {
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    var row = btn.closest('.mark-row');
    if (!row) return;
    var id = Number(row.dataset.id);
    var act = btn.dataset.act;

    if (act === 'del') {
      if (!btn.classList.contains('is-armed')) { armConfirm(btn, id, 'del'); return; }
      clearTimeout(confirmTimers.get(id));
      confirmTimers.delete(id);
      var job = isMark ? MC.data.removeMark(id) : MC.data.removeHistory(id);
      job.then(function () {
        MC.toast('已删除', 'ok');
        return isMark ? loadMarks() : loadHistory();
      }).catch(function (err) { MC.toast(err.message || '删除失败', 'error'); });
      return;
    }

    if (isMark && act === 'goto') {
      var m = marks.filter(function (x) { return x.id === id; })[0];
      if (m && MC.SeedPanel.apply) MC.SeedPanel.apply(ctx, m);
      return;
    }

    if (!isMark && act === 'requery') {
      var h = history.filter(function (x) { return x.id === id; })[0];
      if (!h) return;
      MC.util.qs('#serverAddr').value = h.host;
      MC.util.qs('#serverQuery').click();
    }
  }

  MC.MarksPanel = {
    init: function (appCtx) {
      ctx = appCtx;
      MC.util.qs('#markAdd').addEventListener('click', addMark);
      MC.util.qs('#markLabel').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') addMark();
      });
      MC.util.qs('#markList').addEventListener('click', function (e) { onListClick(e, true); });
      MC.util.qs('#historyList').addEventListener('click', function (e) { onListClick(e, false); });

      // 查询成功后写一条历史；写失败只提示，不打断查询
      MC.bus.on('server:queried', function (res) {
        if (!res || !res.online) return;
        MC.data.recordHistory({
          host: res.host,
          version: res.version || '',
          online: res.players ? res.players.online : null,
          max: res.players ? res.players.max : null,
          motd: res.motd || '',
          account: (MC.util.qs('#accountName').value || '').trim()
        }).then(function () {
          return loadHistory();
        }).catch(function (err) { MC.toast(err.message || '写入历史失败', 'error'); });
      });

      renderMarks();
      renderHistory();
      renderStoreHint();
      // 进入页面即把本机已存的收藏与历史读出来
      loadMarks();
      loadHistory();
    },
    refresh: function () { loadMarks(); loadHistory(); }
  };
})(globalThis.MC);
