/*
 * 云服务客户端（单例）。
 * 四个模块（Auth / Database / Storage / LLM）共用一个 client，初始化一次即可；
 * 登录后共享请求层会自动把会话带给 Database，业务代码不需要手动传任何令牌。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var client = null;
  var pending = null;

  /** 按需加载 CDN IIFE 构建；index.html 里的 script 标签已加载时直接跳过 */
  function loadSdk(url) {
    if (globalThis.WorkBuddyCloud && globalThis.WorkBuddyCloud.createWorkBuddyCloud) {
      return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = url;
      tag.async = true;
      tag.onload = function () { resolve(); };
      tag.onerror = function () { reject(new Error('云服务 SDK 加载失败，请检查网络后重试')); };
      document.head.appendChild(tag);
    });
  }

  function init() {
    if (client) return Promise.resolve(client);
    if (pending) return pending;

    pending = loadSdk(MC.cloudConfig.sdkUrl).then(function () {
      var factory = globalThis.WorkBuddyCloud && globalThis.WorkBuddyCloud.createWorkBuddyCloud;
      if (!factory) throw new Error('云服务 SDK 未就绪');
      client = factory({
        endpoint: MC.cloudConfig.endpoint,
        publishableKey: MC.cloudConfig.publishableKey
      });
      return client;
    });

    // 失败时清空 pending，允许下一次操作重试，而不是把整个应用锁死在失败态
    return pending.catch(function (err) {
      pending = null;
      throw err;
    });
  }

  MC.cloud = {
    init: init,
    /** 已初始化则返回 client，否则返回 null——调用方负责先 init */
    get: function () { return client; }
  };
})(globalThis.MC);
