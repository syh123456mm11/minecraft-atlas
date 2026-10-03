/*
 * 服务器状态查询调度。浏览器无法直连 25565 端口，只能问公共查询接口，
 * 因此这里同时问多路数据源（详见 providers.js），再按“谁给了明确答复”判定。
 *
 * 关键设计：把三种结论区分开，不能混为一谈：
 *   1. 在线      —— 至少有一路明确返回 online
 *   2. 确认离线  —— 至少有一路明确返回“不在线”
 *   3. 不可达    —— 所有路都请求失败（网络/CORS/超时/限流），此时“没问到”不等于“服务器不存在”
 * 旧实现把 2 和 3 都当成“服务器不可达”，会冤枉真实存在的服务器。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var TIMEOUT = 7000;

  /** 归一化地址：去掉协议与路径，拆分主机与端口 */
  function parseAddress(input) {
    var raw = String(input || '').trim();
    raw = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
    raw = raw.replace(/\/.*$/, '');
    if (!raw) return null;
    var host = raw, port = 25565, explicitPort = false;
    var m = raw.match(/^(.*):(\d{1,5})$/);
    if (m) {
      host = m[1];
      port = parseInt(m[2], 10);
      explicitPort = true;
      if (!(port >= 1 && port <= 65535)) return null;
    }
    if (!host) return null;
    return {
      host: host, port: port, explicitPort: explicitPort,
      display: host + (explicitPort && port !== 25565 ? ':' + port : '')
    };
  }

  function offline() {
    return { online: false, players: { online: 0, max: 0, list: [] } };
  }

  /** 打一路数据源，永不 reject：失败记成 state:'error'，供界面诊断 */
  function probe(provider, addr) {
    var entry = { id: provider.id, label: provider.label, state: 'pending', detail: '', data: null };
    return MC.util.fetchJson(provider.build(addr), TIMEOUT).then(function (j) {
      var out;
      try {
        out = provider.parse(j, addr);
      } catch (e) {
        entry.state = 'error';
        entry.detail = '响应无法解析';
        return entry;
      }
      if (!out) {
        entry.state = 'error';
        entry.detail = '响应格式未知';
        return entry;
      }
      entry.state = out.online ? 'online' : 'offline';
      entry.data = out;
      return entry;
    }).catch(function (e) {
      entry.state = 'error';
      entry.detail = reason(e);
      return entry;
    });
  }

  /** 把错误翻成人话，界面直接展示 */
  function reason(e) {
    if (!e) return '未知错误';
    if (e.kind === 'timeout') return '超时';
    if (e.kind === 'network') return '网络不可达（可能被拦截或跨域被拒）';
    if (e.kind === 'parse') return '响应不是 JSON';
    if (e.kind === 'http') {
      if (e.status === 429) return '被限流（429）';
      if (e.status === 403) return '被拒绝（403）';
      return 'HTTP ' + e.status;
    }
    return e.message || '未知错误';
  }

  /** 多路结果里挑一个最好的：优先带玩家名单的，其次第一个在线的 */
  function pickBest(entries) {
    var onlineEntries = entries.filter(function (e) { return e.state === 'online'; });
    if (!onlineEntries.length) return null;
    var withList = onlineEntries.filter(function (e) {
      return e.data && e.data.players && e.data.players.list && e.data.players.list.length;
    });
    return withList[0] || onlineEntries[0];
  }

  MC.serverApi = {
    parseAddress: parseAddress,

    /**
     * 并行查询所有数据源。
     * 返回 { ok, online, unreachable, providers, ...在线时的归一化字段 }
     *   ok          是否至少拿到一路明确答复
     *   unreachable 所有路都请求失败（结论不可信，不能判成“服务器不存在”）
     */
    query: function (input) {
      var addr = parseAddress(input);
      if (!addr) {
        return Promise.resolve({ ok: false, unreachable: true, online: false, providers: [], error: '地址格式不正确' });
      }

      var list = MC.serverProviders || [];
      return Promise.all(list.map(function (p) { return probe(p, addr); }))
        .then(function (providers) {
          var allError = providers.length > 0 && providers.every(function (e) { return e.state === 'error'; });
          var best = pickBest(providers);

          var base = {
            ok: !allError,
            online: !!best,
            unreachable: allError,
            host: addr.host,
            port: addr.port,
            providers: providers
          };
          if (allError) {
            base.error = '所有查询通道均不可达';
            return Object.assign(base, offline());
          }
          if (!best) {
            return Object.assign(base, offline());
          }
          var d = best.data;
          return Object.assign(base, {
            provider: best.label,
            ip: d.ip || addr.host,
            port: d.port || addr.port,
            hostname: addr.host,
            version: d.version || '',
            protocol: d.protocol || 0,
            motd: d.motd || '',
            players: d.players || { online: 0, max: 0, list: [] },
            icon: d.icon || ''
          });
        });
    }
  };
})(globalThis.MC);
