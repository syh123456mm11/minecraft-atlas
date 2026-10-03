/* 游戏版本表：把界面上的版本标签映射到 cubiomes 的 MCVersion 枚举值 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  // mc 为 cubiomes MCVersion 枚举（引擎运行时可枚举到 1..28）
  MC.VERSIONS = [
    { label: '1.8.9', mc: 11 },
    { label: '1.12.2', mc: 15 },
    { label: '1.14.4', mc: 17 },
    { label: '1.15.2', mc: 18 },
    { label: '1.16.5', mc: 20 },
    { label: '1.17.1', mc: 21 },
    { label: '1.18.2', mc: 22 },
    { label: '1.19.4', mc: 24 },
    { label: '1.20.1', mc: 25 },
    { label: '1.20.4', mc: 25 },
    { label: '1.21.1', mc: 26 },
    { label: '1.21.3', mc: 27 },
    { label: '1.21.4', mc: 28 },
    { label: '1.21.8', mc: 28 }
  ];

  MC.DEFAULT_VERSION = '1.21.4';

  /** 版本标签 → cubiomes 枚举值；未知标签回退到 1.18 */
  MC.resolveMc = function (label) {
    for (var i = 0; i < MC.VERSIONS.length; i++) {
      if (MC.VERSIONS[i].label === label) return MC.VERSIONS[i].mc;
    }
    return 22;
  };

  MC.DIMENSIONS = [
    { id: 0, key: 'overworld', label: '主世界' },
    { id: -1, key: 'nether', label: '下界' },
    { id: 1, key: 'end', label: '末地' }
  ];
})(globalThis.MC);
