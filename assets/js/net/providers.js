/*
 * 服务器状态数据源注册表。
 * 设计要点：新增一路数据源只需在此追加一个描述对象（开闭原则），调度与判定逻辑不需改动。
 *
 * 描述对象约定：
 *   id    唯一标识，用于界面诊断时指明是哪一路返回的结果
 *   label 展示名
 *   build (addr) => 请求地址
 *   parse (json, addr) => 归一化结果 | null
 *
 * 归一化结果：
 *   { online, ip, port, version, protocol, motd, players: { online, max, list }, icon }
 *
 * 注意：所有数据源都必须返回 Access-Control-Allow-Origin，否则浏览器读不到响应体。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  /** 去掉颜色代码（§x），部分数据源返回的是原始 MOTD */
  function stripColors(s) {
    return String(s === null || s === undefined ? '' : s).replace(/\u00A7[0-9A-Fa-fK-ORk-or]/g, '');
  }

  /**
   * 统一玩家名单。
   * 很多服务器（尤其国内服）会把 MOTD 广告塞进 sample 列表，例如“推荐版本”“主服 » 20”，
   * 这些条目带全零 UUID，或者名字压根不符合用户名规则，因此按以下三条一并滤掉：
   *   1. 去掉颜色码后为空
   *   2. UUID 全零（占位条目）
   *   3. 名字不符合正版用户名规则 [A-Za-z0-9_]{3,16}
   */
  function cleanList(raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (p) {
      if (!p) return;
      var name = stripColors(p.name || p.name_clean || p.name_raw || '').trim();
      if (!name) return;
      var uuid = String(p.uuid || p.id || '').replace(/-/g, '');
      if (uuid && /^0+$/.test(uuid)) return;
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return;
      out.push({ name: name, uuid: uuid });
    });
    return out;
  }

  function num(v) { return typeof v === 'number' ? v : 0; }

  function motdOf(src) {
    if (!src) return '';
    var clean = src.clean !== undefined ? src.clean : src;
    if (Array.isArray(clean)) return clean.join('\n');
    return stripColors(clean);
  }

  /** 带端口时才把 :port 写进查询串 —— 不带端口才会触发 SRV 解析 */
  function hostOrHostPort(addr) {
    return addr.explicitPort ? addr.host + ':' + addr.port : addr.host;
  }

  MC.serverProviders = [
    {
      id: 'mcsrvstat',
      label: 'mcsrvstat.us',
      build: function (addr) {
        return 'https://api.mcsrvstat.us/3/' + encodeURIComponent(hostOrHostPort(addr));
      },
      parse: function (j, addr) {
        if (!j || j.online !== true) {
          return { online: false, players: { online: 0, max: 0, list: [] } };
        }
        return {
          online: true,
          ip: j.ip || addr.host,
          port: num(j.port) || addr.port,
          version: j.version || '',
          protocol: num(j.protocol),
          motd: motdOf(j.motd),
          players: {
            online: j.players ? num(j.players.online) : 0,
            max: j.players ? num(j.players.max) : 0,
            list: cleanList(j.players && j.players.list)
          },
          icon: j.icon || ''
        };
      }
    },
    {
      id: 'mcstatus',
      label: 'mcstatus.io',
      build: function (addr) {
        return 'https://api.mcstatus.io/v2/status/java/' + encodeURIComponent(hostOrHostPort(addr));
      },
      parse: function (j, addr) {
        if (!j || j.online !== true) {
          return { online: false, players: { online: 0, max: 0, list: [] } };
        }
        return {
          online: true,
          ip: j.ip_address || addr.host,
          port: num(j.port) || addr.port,
          version: (j.version && (j.version.name_clean || j.version.name_raw)) || '',
          protocol: (j.version && num(j.version.protocol)) || 0,
          motd: motdOf(j.motd),
          players: {
            online: j.players ? num(j.players.online) : 0,
            max: j.players ? num(j.players.max) : 0,
            list: cleanList(j.players && j.players.list)
          },
          icon: j.icon || ''
        };
      }
    },
    {
      /* 第三路走完全不同的机房，前两路同时不可达时仍有机会拿到结果 */
      id: 'minetools',
      label: 'minetools.eu',
      build: function (addr) {
        return 'https://api.minetools.eu/ping/' + encodeURIComponent(addr.host) + '/' + addr.port;
      },
      parse: function (j) {
        if (!j || j.error || !j.players) {
          return { online: false, players: { online: 0, max: 0, list: [] } };
        }
        return {
          online: true,
          version: (j.version && j.version.name) || '',
          protocol: (j.version && num(j.version.protocol)) || 0,
          motd: stripColors(j.description),
          players: {
            online: num(j.players.online),
            max: num(j.players.max),
            list: cleanList(j.players.sample)
          },
          icon: j.favicon || ''
        };
      }
    }
  ];
})(globalThis.MC);
