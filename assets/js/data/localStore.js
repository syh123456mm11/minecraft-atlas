/*
 * 本地数据仓库：种子收藏与服务器查询历史只存在访问者自己的浏览器里，不上传任何服务器。
 * 对外沿用 Promise 接口，上层不需要知道底层是 localStorage 还是别的（依赖抽象而非具体实现）。
 *
 * 三条必须守住的底线：
 *   1. localStorage 在隐私模式、file:// 打开、被策略禁用时读写会直接抛错，必须降级到内存，
 *      保证面板还能用（只是关掉页面就没了），而不是整块功能崩掉。
 *   2. 读出来的内容一律不可信：可能被手工改过、也可能是旧版本写坏的，
 *      解析失败或结构不对就当空数据处理，绝不让异常冒泡到界面。
 *   3. 写入有配额上限，超限时给出看得懂的提示并保留原数据，不能静默丢用户的收藏。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var NS = 'mc-atlas:v1:';
  var K_MARKS = NS + 'marks';
  var K_HISTORY = NS + 'history';
  var MAX_ROWS = 200;

  /** 存储后端：能用 localStorage 就用，否则退化为内存 */
  var store = (function () {
    try {
      var ls = globalThis.localStorage;
      if (!ls) throw new Error('浏览器未提供 localStorage');
      // 光判断对象存在不够：Safari 无痕模式下能取到对象，但一写就抛配额错，必须实测一次
      var probe = NS + 'probe';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return {
        persistent: true,
        get: function (k) { return ls.getItem(k); },
        set: function (k, v) { ls.setItem(k, v); }
      };
    } catch (e) {
      var mem = Object.create(null);
      return {
        persistent: false,
        reason: (e && e.message) || '未知原因',
        get: function (k) {
          return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
        },
        set: function (k, v) { mem[k] = String(v); }
      };
    }
  })();

  function isQuotaError(e) {
    if (!e) return false;
    return e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 || e.code === 1014;
  }

  function read(key) {
    var raw = null;
    try {
      raw = store.get(key);
    } catch (e) {
      return [];
    }
    if (!raw) return [];
    try {
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      // 只留对象形态的记录：null / 数字 / 字符串这类脏数据直接丢掉，
      // 否则后面取字段就会抛错，把整个面板拖崩。
      return list.filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); });
    } catch (e) {
      console.warn('[store] 本地数据无法解析，按空处理：', key);
      return [];
    }
  }

  function write(key, list) {
    try {
      store.set(key, JSON.stringify(list));
    } catch (e) {
      var err = new Error(isQuotaError(e)
        ? '本机存储空间已满，请先删除一些旧记录'
        : '写入本地存储失败');
      err.storage = true;
      throw err;
    }
  }

  /** 统一包一层：同步抛出的错误也要变成 rejected promise，调用方的 .catch 才接得住 */
  function job(fn) {
    return Promise.resolve().then(fn);
  }

  function byNewest(a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }

  /** 补默认值，避免旧数据缺字段时界面出现 undefined */
  function normMark(row) {
    return {
      id: Number(row.id) || 0,
      seedText: String(row.seedText || ''),
      version: String(row.version || ''),
      dim: Number(row.dim) || 0,
      x: Number(row.x) || 0,
      z: Number(row.z) || 0,
      zoom: Number(row.zoom) || 4,
      label: String(row.label || ''),
      note: String(row.note || ''),
      createdAt: row.createdAt || ''
    };
  }

  function normHistory(row) {
    return {
      id: Number(row.id) || 0,
      host: String(row.host || ''),
      version: String(row.version || ''),
      online: (row.online === null || row.online === undefined) ? null : Number(row.online),
      max: (row.max === null || row.max === undefined) ? null : Number(row.max),
      motd: String(row.motd || ''),
      account: String(row.account || ''),
      createdAt: row.createdAt || ''
    };
  }

  function nextId(list) {
    var now = Date.now();
    var max = 0;
    list.forEach(function (r) {
      var v = Number(r.id) || 0;
      if (v > max) max = v;
    });
    // 同一毫秒内连点取 max+1，保证严格递增且不重复
    return max >= now ? max + 1 : now;
  }

  function insert(key, row) {
    var list = read(key);
    list.unshift(row);
    write(key, list.slice(0, MAX_ROWS));
    return row;
  }

  function drop(key, id) {
    var list = read(key);
    var kept = list.filter(function (r) { return Number(r.id) !== Number(id); });
    if (kept.length === list.length) throw new Error('没有这条记录，它可能已被删除');
    write(key, kept);
    return true;
  }

  MC.data = {
    listMarks: function () {
      return job(function () { return read(K_MARKS).map(normMark).sort(byNewest); });
    },

    addMark: function (mark) {
      return job(function () {
        var list = read(K_MARKS).map(normMark);
        return insert(K_MARKS, normMark({
          id: nextId(list),
          seedText: mark.seedText,
          version: mark.version,
          dim: mark.dim,
          x: Math.round(Number(mark.x) || 0),
          z: Math.round(Number(mark.z) || 0),
          zoom: Number(mark.zoom) || 4,
          label: String(mark.label || '').slice(0, 60),
          note: String(mark.note || '').slice(0, 200),
          createdAt: new Date().toISOString()
        }));
      });
    },

    removeMark: function (id) {
      return job(function () { return drop(K_MARKS, id); });
    },

    listHistory: function () {
      return job(function () { return read(K_HISTORY).map(normHistory).sort(byNewest); });
    },

    /** 同一地址重复查询只保留最新一条，避免列表被刷屏 */
    recordHistory: function (entry) {
      return job(function () {
        var host = String(entry.host || '').slice(0, 120);
        var list = read(K_HISTORY).map(normHistory).filter(function (r) { return r.host !== host; });
        write(K_HISTORY, list);
        return insert(K_HISTORY, normHistory({
          id: nextId(list),
          host: host,
          version: String(entry.version || '').slice(0, 40),
          online: (entry.online === null || entry.online === undefined) ? null : Number(entry.online),
          max: (entry.max === null || entry.max === undefined) ? null : Number(entry.max),
          motd: String(entry.motd || '').slice(0, 300),
          account: String(entry.account || '').slice(0, 32),
          createdAt: new Date().toISOString()
        }));
      });
    },

    removeHistory: function (id) {
      return job(function () { return drop(K_HISTORY, id); });
    },

    /** 界面据此说明数据存在哪、能不能留到下次；不暴露具体路径（浏览器不提供） */
    storageInfo: function () {
      var info = {
        persistent: store.persistent,
        reason: store.reason || '',
        scope: (typeof location !== 'undefined' && location.origin) ? location.origin : '本机',
        marks: read(K_MARKS).length,
        history: read(K_HISTORY).length,
        maxRows: MAX_ROWS
      };
      return info;
    }
  };
})(globalThis.MC);
