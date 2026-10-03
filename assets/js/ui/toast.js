/* 轻提示：底部浮出一条消息，自动消失。用于云同步等不需要打断操作的反馈 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var timer = null;

  MC.toast = function (text, kind) {
    var el = MC.util.qs('#toast');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'toast is-visible' + (kind ? ' is-' + kind : '');
    clearTimeout(timer);
    timer = setTimeout(function () { el.className = 'toast'; }, 2600);
  };
})(globalThis.MC);
