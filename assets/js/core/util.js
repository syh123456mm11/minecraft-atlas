/* 通用工具 + 事件总线（模块间通过事件解耦，避免直接互相持有引用） */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var listeners = new Map();

  MC.bus = {
    /** 订阅事件，返回取消订阅函数 */
    on: function (type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return function () { listeners.get(type).delete(fn); };
    },
    /** 发布事件；单个监听器异常不影响其它监听器 */
    emit: function (type, payload) {
      var set = listeners.get(type);
      if (!set) return;
      set.forEach(function (fn) {
        try { fn(payload); } catch (e) { console.error('[bus:' + type + ']', e); }
      });
    }
  };

  /*
   * 站点根地址。从本脚本自身的 URL 反推（util.js 位于 <根>/assets/js/core/），
   * 不能用 location.href —— 页面地址是 <根>/index.html，基准目录会差一级，
   * 一旦站点部署到子路径（GitHub Pages 的 /仓库名/）就会解析到根域上去。
   */
  var ROOT = (function () {
    var script = (typeof document !== 'undefined') ? document.currentScript : null;
    try {
      return script && script.src
        ? new URL('../../../', script.src).href
        : new URL('./', location.href).href;
    } catch (e) {
      return './';
    }
  })();

  MC.util = {
    /** 把「相对站点根」的路径解析成绝对 URL，供 Worker / WASM 等需要绝对地址的地方使用 */
    asset: function (rel) {
      return new URL(String(rel).replace(/^\.?\//, ''), ROOT).href;
    },

    qs: function (sel, root) { return (root || document).querySelector(sel); },
    qsa: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },

    clamp: function (v, min, max) { return v < min ? min : (v > max ? max : v); },

    debounce: function (fn, ms) {
      var timer = null;
      return function () {
        var args = arguments, self = this;
        clearTimeout(timer);
        timer = setTimeout(function () { fn.apply(self, args); }, ms);
      };
    },

    /** 下一帧让出主线程，用于分片渲染 */
    nextFrame: function () {
      return new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); });
    },

    /** Java String.hashCode：文本种子按官方规则转成数值种子 */
    javaHash: function (str) {
      var h = 0;
      for (var i = 0; i < str.length; i++) {
        h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
      }
      return h | 0;
    },

    /** 解析种子：支持整数（含负数/64 位）与文本，拆成两个 32 位半字供 WASM 使用 */
    parseSeed: function (input) {
      var raw = (input === null || input === undefined) ? '' : String(input).trim();
      if (!raw) return { lo: 0, hi: 0, value: 0, isText: false, display: '0' };
      if (/^-?\d{1,20}$/.test(raw)) {
        var big = BigInt(raw);
        var lo = Number(BigInt.asUintN(32, big));
        var hi = Number(BigInt.asUintN(32, big >> 32n));
        return { lo: lo, hi: hi, value: Number(big), isText: false, display: raw };
      }
      var h = MC.util.javaHash(raw);
      return { lo: h >>> 0, hi: h < 0 ? 0xFFFFFFFF : 0, value: h, isText: true, display: raw + '（文本种子 → ' + h + '）' };
    },

    randomSeed: function () {
      var v = Math.floor(Math.random() * 0xFFFFFFFF) - 0x80000000;
      return String(v);
    },

    fmt: function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); },

    copy: function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
      return Promise.reject(new Error('clipboard unavailable'));
    },

    /** 极简 HTML 转义，所有外部数据来源（服务器 MOTD 等）渲染前必须经过 */
    escape: function (s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /**
     * 带超时与分类的 fetch，避免第三方接口挂起导致界面卡在加载态。
     * 错误带 kind 字段：http（带 status）/ timeout / network / parse，
     * 调用方据此区分“数据源给了明确答复”和“压根没连上”。
     * opts.retries 只对 timeout/network 生效，4xx 是明确结论，重试没有意义。
     */
    fetchJson: function (url, timeoutMs, opts) {
      opts = opts || {};
      var timeout = timeoutMs || 8000;

      function read(r) {
        if (!r.ok) {
          var err = new Error('HTTP ' + r.status);
          err.kind = 'http';
          err.status = r.status;
          // 尽量带上响应体：4xx 常是数据源的明确答复（如“查无此人”），不能一律当故障
          return r.json().then(
            function (body) { err.body = body; throw err; },
            function () { throw err; }
          );
        }
        return r.json().catch(function () {
          var pe = new Error('响应不是合法 JSON');
          pe.kind = 'parse';
          throw pe;
        });
      }

      function once() {
        if (typeof AbortController === 'undefined') {
          return fetch(url, { headers: { 'Accept': 'application/json' } }).then(read);
        }
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, timeout);
        return fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } })
          .then(read)
          .catch(function (e) {
            if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
              var te = new Error('请求超时');
              te.kind = 'timeout';
              throw te;
            }
            throw e;
          })
          .finally(function () { clearTimeout(timer); });
      }

      function attempt(left) {
        return once().catch(function (e) {
          if (!e || !e.kind) {
            // fetch 的网络层失败（DNS、断网、CORS 被拒）都走这里
            e = new Error((e && e.message) || '网络请求失败');
            e.kind = 'network';
          }
          var transient = e.kind === 'timeout' || e.kind === 'network';
          if (transient && left > 0) {
            return new Promise(function (res) { setTimeout(res, 400); })
              .then(function () { return attempt(left - 1); });
          }
          throw e;
        });
      }

      return attempt(opts.retries || 0);
    }
  };
})(globalThis.MC);
