/*
 * 正版账号校验。
 *
 * 重要：api.mojang.com / sessionserver.mojang.com 虽然能查到账号，但响应里
 * 不带 Access-Control-Allow-Origin，浏览器会直接拦掉响应体，前端永远读不到。
 * 旧实现把它当兜底，结果必然失败 → 界面只能报“无法连接正版校验服务”。
 * 因此这里只保留实测带 CORS 头的数据源。
 *
 * 404 / 400 表示数据源明确回答“查无此人”，这是有效结论，不是失败。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var TIMEOUT = 8000;

  var PROVIDERS = [
    {
      id: 'playerdb',
      source: 'playerdb.co',
      build: function (name) {
        return 'https://playerdb.co/api/player/minecraft/' + encodeURIComponent(name);
      },
      parse: function (j) {
        var p = j && j.data && j.data.player;
        if (!p || !p.username) return null;
        return { name: p.username, uuid: String(p.raw_id || p.id || '') };
      },
      notFound: function (j) { return !!(j && j.code === 'minecraft.invalid_username'); },
      notFoundHttp: [400, 404]
    },
    {
      id: 'ashcon',
      source: 'ashcon.app',
      build: function (name) {
        return 'https://api.ashcon.app/mojang/v2/user/' + encodeURIComponent(name);
      },
      parse: function (j) {
        if (!j || !j.username) return null;
        return { name: j.username, uuid: String(j.uuid || '').replace(/-/g, '') };
      },
      notFound: function () { return false; },
      notFoundHttp: [404]
    }
  ];

  function normalizeName(input) {
    return String(input || '').trim().replace(/\s+/g, '');
  }

  /** 判断 4xx 是否代表“数据源明确答复查无此人”，而不是故障 */
  function isNotFound(p, e) {
    if (!e || e.kind !== 'http') return false;
    if (e.body && p.notFound(e.body)) return true;
    return !!(p.notFoundHttp && p.notFoundHttp.indexOf(e.status) >= 0);
  }

  function describe(p, e) {
    if (!e) return p.source + '：失败';
    if (e.kind === 'timeout') return p.source + '：超时';
    if (e.kind === 'http') return p.source + '：' + (e.status === 429 ? '被限流' : 'HTTP ' + e.status);
    if (e.kind === 'network') return p.source + '：网络不可达';
    return p.source + '：' + (e.message || '失败');
  }

  /** 顺序尝试：拿到明确结论就返回，只有临时性失败才换下一路 */
  function attempt(index, name, errors, retriesLeft) {
    if (index >= PROVIDERS.length) {
      return Promise.resolve({
        ok: false, premium: false, name: name,
        error: errors.length ? errors.join('；') : '无法连接正版校验服务'
      });
    }
    var p = PROVIDERS[index];
    return MC.util.fetchJson(p.build(name), TIMEOUT, { retries: retriesLeft })
      .then(function (j) {
        var found = p.parse(j);
        if (found) {
          return { ok: true, premium: true, name: found.name, uuid: found.uuid, source: p.source };
        }
        if (p.notFound(j)) {
          return { ok: true, premium: false, notFound: true, name: name, source: p.source };
        }
        return attempt(index + 1, name, errors.concat(p.source + '：响应无法识别'), 0);
      })
      .catch(function (e) {
        // 数据源明确答复“查无此人”就是结论，直接返回，不要继续换路也不要报成故障
        if (isNotFound(p, e)) {
          return { ok: true, premium: false, notFound: true, name: name, source: p.source };
        }
        // 超时/断网先原地重试一次；仍失败或 4xx 其它答复则换下一路
        var transient = !(e && e.kind === 'http');
        if (transient && retriesLeft > 0) {
          return attempt(index, name, errors, retriesLeft - 1);
        }
        return attempt(index + 1, name, errors.concat(describe(p, e)), 0);
      });
  }

  MC.accountApi = {
    normalizeName: normalizeName,

    /** Mojang 正版用户名规则：3-16 位字母数字下划线 */
    isValidName: function (name) {
      return /^[A-Za-z0-9_]{3,16}$/.test(name);
    },

    /** 校验账号是否为正版；返回 {ok, premium, notFound, uuid, name, source} */
    verify: function (input) {
      var name = normalizeName(input);
      if (!name) return Promise.resolve({ ok: false, premium: false, error: '请输入账号名' });
      return attempt(0, name, [], 1);
    },

    /** 头像地址（第三方渲染服务，加载失败时界面会回退为文字头像） */
    avatarUrl: function (name, size) {
      return 'https://mc-heads.net/avatar/' + encodeURIComponent(normalizeName(name)) + '/' + (size || 40);
    }
  };
})(globalThis.MC);
