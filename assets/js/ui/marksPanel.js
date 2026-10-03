/*
 * 云端数据面板：种子收藏 + 服务器查询历史。
 * 只做「渲染 + 调用数据服务」，不碰地图与世界状态——跳转变由事件交给宿主处理，
 * 写操作一律先过 MC.data 的登录闸门，未登录时引导登录而不是静默落本地。
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

  function loginHint(action) {
    return '<div class="empty-state">登录后即可' + action + '，数据保存在你的账号下。<br>' +
      '<button class="ghost small" data-act="login">去登录</button></div>';
  }

  function renderMarks() {
    var box = MC.util.qs('#markList');
    if (!MC.auth.isSignedIn()) { box.innerHTML = loginHint('收藏种子与坐标'); return; }
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
    if (!MC.auth.isSignedIn()) { box.innerHTML = loginHint('保存查询历史'); return; }
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

  function loadMarks() {
    if (!MC.auth.isSignedIn()) { marks = []; renderMarks(); return Promise.resolve(); }
    return MC.data.listMarks().then(function (list) {
      marks = list;
      renderMarks();
    }).catch(function (err) {
      marks = [];
      MC.util.qs('#markList').innerHTML = '<div class="empty-state">' + MC.util.escape(err.message) + '</div>';
    });
  }

  function loadHistory() {
    if (!MC.auth.isSignedIn()) { history = []; renderHistory(); return Promise.resolve(); }
    return MC.data.listHistory().then(function (list) {
      history = list;
      renderHistory();
    }).catch(function (err) {
      history = [];
      MC.util.qs('#historyList').innerHTML = '<div class="empty-state">' + MC.util.escape(err.message) + '</div>';
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
      MC.toast('已保存到云端收藏', 'ok');
      return loadMarks();
    }).catch(function (err) {
      if (err.needLogin) MC.AccountPanel.open('password');
      MC.toast(err.message, 'error');
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

  function onListClick(e, box, isMark) {
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;
    var row = btn.closest('.mark-row');
    if (!row) return;
    var id = Number(row.dataset.id);
    var act = btn.dataset.act;

    if (act === 'login') { MC.AccountPanel.open('password'); return; }

    if (act === 'del') {
      if (!btn.classList.contains('is-armed')) { armConfirm(btn, id, 'del'); return; }
      clearTimeout(confirmTimers.get(id));
      confirmTimers.delete(id);
      var job = isMark ? MC.data.removeMark(id) : MC.data.removeHistory(id);
      job.then(function () {
        MC.toast('已删除', 'ok');
        return isMark ? loadMarks() : loadHistory();
      }).catch(function (err) { MC.toast(err.message, 'error'); });
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
      MC.util.qs('#markList').addEventListener('click', function (e) { onListClick(e, this, true); });
      MC.util.qs('#historyList').addEventListener('click', function (e) { onListClick(e, this, false); });

      MC.bus.on('auth:changed', function () { loadMarks(); loadHistory(); });

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
        }).then(function (row) {
          if (row) loadHistory();
        }).catch(function (err) { MC.toast(err.message, 'error'); });
      });

      renderMarks();
      renderHistory();
    },
    refresh: function () { loadMarks(); loadHistory(); }
  };
})(globalThis.MC);
