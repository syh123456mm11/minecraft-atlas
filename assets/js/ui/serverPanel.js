/*
 * 服务器查询面板：查询服务器公开状态 → 展示在线玩家 → 定位指定账号。
 * 坐标需要服务端配合（插件/API）；未接入坐标服务时使用稳定派生坐标并明确标注为演示值。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var MSG_DEAD = '哦不～这个服务器是滚木🪵Σ( ° △ °|||)︴';
  var MSG_NEVER = '您似乎没有登录过这个服务器呢o(￣ヘ￣o#)';
  /* 与 MSG_DEAD 分开：这是“我没问到人”，不是“服务器没了”，两者不能混为一谈 */
  var MSG_UNREACH = '没能问到这个服务器…Σ(っ °Д °;)っ 先别急着下结论';
  var POS_API_KEY = 'mc-atlas-position-api';

  var lastResult = null;
  var playerMarkers = [];

  function setStatus(sel, text, cls) {
    var el = MC.util.qs(sel);
    el.className = 'status' + (cls ? ' ' + cls : '');
    el.textContent = text || '';
  }

  /** 通过可选的第三方接口获取真实坐标；未配置或失败时返回稳定派生坐标 */
  function resolvePosition(res, name) {
    var tpl = (localStorage.getItem(POS_API_KEY) || '').trim();
    if (tpl) {
      var url = tpl.replace('{server}', encodeURIComponent(res.host)).replace('{player}', encodeURIComponent(name));
      return MC.util.fetchJson(url, 6000).then(function (j) {
        if (j && typeof j.x === 'number' && typeof j.z === 'number') {
          return { x: j.x, z: j.z, real: true };
        }
        throw new Error('bad payload');
      }).catch(function () {
        return demoPosition(res, name);
      });
    }
    return Promise.resolve(demoPosition(res, name));
  }

  function demoPosition(res, name) {
    var h = MC.util.javaHash(res.host + '/' + name);
    return { x: (h % 6000) - 3000, z: ((h >>> 8) % 6000) - 3000, real: false };
  }

  function banner(text, cls) {
    return '<div class="banner ' + (cls || '') + '">' + MC.util.escape(text) + '</div>';
  }

  /** 逐通道诊断：把每一路的实际结果摊开，避免“查不到”被误读成“服务器不存在” */
  function diagnostics(res) {
    var list = (res && res.providers) || [];
    if (!list.length) return '';
    var rows = list.map(function (p) {
      var mark = p.state === 'online' ? '答复：在线' : (p.state === 'offline' ? '答复：不在线' : '请求失败');
      var cls = p.state === 'online' ? 'is-ok' : (p.state === 'offline' ? 'is-warn' : 'is-error');
      return '<div class="diag-row">' +
        '<span class="diag-name">' + MC.util.escape(p.label) + '</span>' +
        '<span class="diag-state ' + cls + '">' + mark + '</span>' +
        '<span class="diag-detail">' + MC.util.escape(p.detail || '') + '</span></div>';
    }).join('');
    return '<div class="diag"><div class="diag-title">通道诊断</div>' + rows + '</div>';
  }

  function renderServerCard(res) {
    var card = MC.util.qs('#serverCard');
    if (res && res.unreachable) {
      card.innerHTML = '<h3>服务器信息</h3>' + banner(MSG_UNREACH, 'is-warn') +
        '<div class="hint">这是<b>本页没能问到任何查询服务</b>，不等于服务器不存在。' +
        '常见原因是网络拦截、跨域被拒或接口限流，请看下方诊断。</div>' + diagnostics(res);
      return;
    }
    if (!res.ok || !res.online) {
      card.innerHTML = '<h3>服务器信息</h3>' + banner(MSG_DEAD, 'is-error') +
        '<div class="hint">已确认服务器不在线。若你确定它是开着的，检查地址或端口是否写对。</div>' +
        diagnostics(res);
      return;
    }
    var icon = res.icon
      ? '<img class="server-icon" src="' + MC.util.escape(res.icon) + '" alt="">'
      : '<div class="server-icon"></div>';
    card.innerHTML =
      '<h3>服务器信息</h3>' +
      '<div class="server-head">' + icon +
      '<div><div class="server-title">' + MC.util.escape(res.hostname || res.host) + '</div>' +
      '<div class="server-sub">' + MC.util.escape(res.ip ? res.ip + ':' + res.port : res.host + ':' + res.port) + '</div></div></div>' +
      '<dl class="kv">' +
      '<dt>版本</dt><dd>' + MC.util.escape(res.version || '未知') + '</dd>' +
      '<dt>在线</dt><dd>' + MC.util.fmt(res.players.online) + ' / ' + MC.util.fmt(res.players.max) + '</dd>' +
      '<dt>来源</dt><dd>' + MC.util.escape(res.provider || '') + '</dd>' +
      '</dl>' +
      (res.motd ? '<div class="motd">' + MC.util.escape(res.motd) + '</div>' : '');
  }

  function renderPlayersCard(res, meName) {
    var card = MC.util.qs('#playersCard');
    if (!res.ok || !res.online) {
      card.innerHTML = '<h3>在线玩家</h3><div class="empty-state">—</div>';
      return;
    }
    var list = res.players.list || [];
    if (!list.length) {
      var why = res.players.online > 0
        ? '服务器公开的名单里没有可识别的玩家名（常见情况是名单被 MOTD 广告占满）。'
        : '当前没有人在线。';
      card.innerHTML = '<h3>在线玩家</h3><div class="empty-state">' + why + '</div>';
      return;
    }
    var html = '<h3>在线玩家（' + list.length + '）</h3><div class="players">';
    list.forEach(function (p) {
      var me = meName && p.name.toLowerCase() === meName.toLowerCase();
      html += '<div class="player-row' + (me ? ' is-me' : '') + '" data-name="' + MC.util.escape(p.name) + '">' +
        '<img class="player-avatar" src="' + MC.util.escape(MC.accountApi.avatarUrl(p.name, 40)) + '" alt="" ' +
        'onerror="this.style.visibility=\'hidden\'">' +
        '<span class="player-name">' + MC.util.escape(p.name) + (me ? '（你）' : '') + '</span>' +
        '<span class="player-coord" data-coord="' + MC.util.escape(p.name) + '"></span></div>';
    });
    html += '</div>';
    card.innerHTML = html;
    MC.util.qsa('.player-row', card).forEach(function (row) {
      row.addEventListener('click', function () {
        var name = row.dataset.name;
        var m = playerMarkers.filter(function (x) { return x.label === name; })[0];
        if (m) MC.bus.emit('server:focus', { x: m.x, z: m.z });
      });
    });
  }

  function renderPlayerCard(res, name, pos, inList) {
    var card = MC.util.qs('#playerCard');
    if (!res.ok || !res.online) {
      card.innerHTML = '<h3>我的位置</h3><div class="empty-state">—</div>';
      return;
    }
    if (!inList) {
      card.innerHTML = '<h3>我的位置</h3>' + banner(MSG_NEVER, 'is-warn') +
        '<div class="hint">该账号不在服务器公开的在线名单里。若服务器不公开名单，将无法确认登录记录。</div>' +
        apiRow();
      bindApiRow();
      return;
    }
    card.innerHTML = '<h3>我的位置</h3>' +
      '<div class="result-card">' +
      '<div class="title">' + MC.util.escape(name) + '</div>' +
      '<div class="coord">X ' + Math.round(pos.x) + ' ，Z ' + Math.round(pos.z) + '</div>' +
      '<div class="actions"><button data-act="focus">在地图上定位</button>' +
      '<button data-act="copy">复制坐标</button></div></div>' +
      (pos.real ? '' : '<div class="hint">当前未接入服务端坐标接口，显示的是演示坐标（由服务器地址与账号派生，稳定不变）。' +
        '接入你自己的坐标接口后即可显示真实位置。</div>') +
      apiRow();

    MC.util.qsa('button', card).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.act === 'focus') MC.bus.emit('server:focus', { x: pos.x, z: pos.z });
        else MC.util.copy('/tp ' + Math.round(pos.x) + ' 120 ' + Math.round(pos.z));
      });
    });
    bindApiRow();
  }

  function apiRow() {
    var val = (localStorage.getItem(POS_API_KEY) || '');
    return '<div style="margin-top:12px"><label><span>坐标接口（可选，需服务端配合）</span>' +
      '<div class="row"><input type="text" id="posApi" placeholder="https://your.api/pos?server={server}&player={player}" value="' +
      MC.util.escape(val) + '"><button data-act="save">保存</button></div></label>' +
      '<p class="hint">留空则使用演示坐标。接口需返回 JSON：<code>{"x":123,"z":-45}</code>，并允许跨域访问。</p></div>';
  }

  function bindApiRow() {
    var btn = MC.util.qs('#playerCard button[data-act="save"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      localStorage.setItem(POS_API_KEY, MC.util.qs('#posApi').value.trim());
      btn.textContent = '已保存';
      setTimeout(function () { btn.textContent = '保存'; }, 1200);
    });
  }

  /** 在服务器世界视图上放置所有在线玩家标记 */
  function placeMarkers(res, meName) {
    var list = (res.players && res.players.list) || [];
    var jobs = list.map(function (p) {
      return resolvePosition(res, p.name).then(function (pos) {
        return {
          x: pos.x, z: pos.z, label: p.name,
          color: (meName && p.name.toLowerCase() === meName.toLowerCase()) ? '#ff3b30' : '#0071e3'
        };
      });
    });
    return Promise.all(jobs).then(function (markers) {
      playerMarkers = markers;
      MC.bus.emit('server:markers', markers);
      // 回填列表中的坐标
      var spans = MC.util.qsa('#playersCard .player-coord');
      markers.forEach(function (m) {
        spans.forEach(function (el) {
          if (el.dataset.coord === m.label) el.textContent = 'X ' + Math.round(m.x) + ' Z ' + Math.round(m.z);
        });
      });
      return markers;
    });
  }

  function locate(ctx, res) {
    var name = MC.accountApi.normalizeName(MC.util.qs('#accountName').value);
    var preview = MC.util.qs('#previewOnly').checked;
    if (!name) {
      renderPlayersCard(res, '');
      if (preview) {
        MC.util.qs('#playerCard').innerHTML = '<h3>我的位置</h3>' +
          '<div class="empty-state">仅预览模式：不绑定账号，仅查看服务器与在线玩家。</div>';
      } else {
        MC.util.qs('#playerCard').innerHTML = '<h3>我的位置</h3>' +
          '<div class="empty-state">填写账号后即可查询你的位置；没有正版账号可勾选「仅预览」。</div>';
      }
      return placeMarkers(res, '');
    }

    var inList = (res.players.list || []).some(function (p) {
      return p.name.toLowerCase() === name.toLowerCase();
    });
    return resolvePosition(res, name).then(function (pos) {
      renderPlayersCard(res, name);
      renderPlayerCard(res, name, pos, inList);
      return placeMarkers(res, name).then(function (markers) {
        if (inList) MC.bus.emit('server:focus', { x: pos.x, z: pos.z });
        return markers;
      });
    });
  }

  MC.ServerPanel = {
    init: function (ctx) {
      var btn = MC.util.qs('#serverQuery');
      var input = MC.util.qs('#serverAddr');

      function doQuery() {
        var addr = input.value.trim();
        if (!addr) { setStatus('#serverStatus', '请输入服务器地址', 'is-error'); return; }
        btn.disabled = true;
        setStatus('#serverStatus', '查询中…');
        MC.serverApi.query(addr).then(function (res) {
          lastResult = res;
          btn.disabled = false;
          if (res.unreachable) {
            // “没问到”与“服务器离线”是两回事，文案必须分开，否则会冤枉真实服务器
            setStatus('#serverStatus', '查询失败：所有通道均不可达（见诊断）', 'is-error');
            renderServerCard(res);
            renderPlayersCard(res, '');
            MC.util.qs('#playerCard').innerHTML = '<h3>我的位置</h3><div class="empty-state">—</div>';
            MC.bus.emit('server:markers', []);
            return;
          }
          if (!res.online) {
            setStatus('#serverStatus', '查询完成：服务器不在线', 'is-error');
            renderServerCard(res);
            renderPlayersCard(res, '');
            MC.util.qs('#playerCard').innerHTML = '<h3>我的位置</h3><div class="empty-state">—</div>';
            MC.bus.emit('server:markers', []);
            return;
          }
          setStatus('#serverStatus', '查询完成', 'is-ok');
          MC.bus.emit('server:world', res);
          MC.bus.emit('server:queried', res);
          renderServerCard(res);
          return locate(ctx, res);
        }).catch(function (e) {
          btn.disabled = false;
          console.error('[server]', e);
          setStatus('#serverStatus', '查询失败：' + ((e && e.message) || '未知错误'), 'is-error');
          renderServerCard({ ok: false });
        });
      }

      btn.addEventListener('click', doQuery);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doQuery(); });

      MC.util.qs('#accountVerify').addEventListener('click', function () {
        var name = MC.accountApi.normalizeName(MC.util.qs('#accountName').value);
        if (!name) { setStatus('#accountStatus', '请输入账号名', 'is-error'); return; }
        if (!MC.accountApi.isValidName(name)) {
          setStatus('#accountStatus', '账号名不合法（3-16 位字母、数字或下划线）', 'is-error');
          return;
        }
        setStatus('#accountStatus', '校验中…');
        MC.accountApi.verify(name).then(function (r) {
          if (r.ok && r.premium) {
            setStatus('#accountStatus', '已确认正版账号：' + r.name + '（' + r.source + '）', 'is-ok');
          } else if (r.ok && r.notFound) {
            // 数据源明确答复“查无此人”，这是结论不是故障，别报成连不上
            setStatus('#accountStatus', '数据源明确答复：查不到「' + name + '」这个账号（' + r.source + '）。' +
              '确认拼写无误，或勾选「仅预览」继续。', 'is-error');
          } else {
            setStatus('#accountStatus', '无法完成正版校验（' + (r.error || '未知') + '），可勾选「仅预览」继续。', 'is-error');
          }
        });
      });

      MC.util.qs('#previewOnly').addEventListener('change', function () {
        if (!lastResult || !lastResult.online) return;
        locate(ctx, lastResult);
      });
    },
    MSG_DEAD: MSG_DEAD,
    MSG_NEVER: MSG_NEVER,
    MSG_UNREACH: MSG_UNREACH
  };
})(globalThis.MC);
