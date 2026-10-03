/*
 * 云服务公开配置。
 * 两个值都来自 workbuddy_cloud_service 激活环境后返回的 publicConfig，是唯一允许写进前端的字段：
 *   endpoint        —— 本应用发布域的数据面地址，重新发布后由平台维护
 *   publishableKey  —— 只标识应用、自身不带权限，服务端还校验 Origin
 * 环境 ID 与供应商密钥留在服务端，这里不出现，也不得出现。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  MC.cloudConfig = {
    endpoint: 'https://mc-atlas.app.workbuddy.host',
    publishableKey: 'wbpk_LydiVtMLzPmv6XdaQV3TMb_sn443XSEui150Qc77AgJQ72kHrmWbVNI',
    sdkUrl: 'https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js'
  };
})(globalThis.MC);
