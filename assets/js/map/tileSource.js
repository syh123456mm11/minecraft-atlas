/*
 * 网格数据源：优先用 Worker 池并行计算；不可用时退化为主线程分片渲染（不阻塞界面）。
 * 上层只调用 request()，不关心底层是并行还是分片。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  function TileSource(engine) {
    this.engine = engine;
    this.workers = [];
    this.mode = 'main';
    this.gen = 0;
  }

  /** 尝试建立 Worker 池（模块 Worker + WASM）；任一环节失败都不影响主流程 */
  TileSource.prototype.init = function (wasmUrl) {
    var self = this;
    if (location.protocol === 'file:' || typeof Worker === 'undefined') return Promise.resolve(this);
    var count = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
    var url = MC.util.asset('assets/js/map/tileWorker.js');
    var jobs = [];
    for (var i = 0; i < count; i++) {
      jobs.push(this._spawn(url, wasmUrl));
    }
    return Promise.all(jobs).then(function (list) {
      list.forEach(function (w) { if (w) self.workers.push(w); });
      if (self.workers.length) self.mode = 'worker';
      return self;
    });
  };

  TileSource.prototype._spawn = function (workerUrl, wasmUrl) {
    return new Promise(function (resolve) {
      var w = null;
      try {
        w = new Worker(workerUrl, { type: 'module' });
      } catch (e) {
        resolve(null);
        return;
      }
      var timer = setTimeout(function () { resolve(null); }, 15000);
      w.onmessage = function (ev) {
        if (ev.data && ev.data.type === 'ready') {
          clearTimeout(timer);
          if (ev.data.ok) resolve(w);
          else { w.terminate(); resolve(null); }
        }
      };
      w.onerror = function () { clearTimeout(timer); resolve(null); };
      w.postMessage({ type: 'init', url: wasmUrl });
    });
  };

  /**
   * 请求一整块网格。job: {mc,dim,seedLo,seedHi,x0,z0,w,h,stride,y}
   * 返回 Int32Array（长度 w*h）或 null（被更新请求取消）
   */
  TileSource.prototype.request = function (job, onProgress) {
    var myGen = ++this.gen;
    var self = this;
    if (this.mode === 'worker') {
      return this._requestWorkers(job, myGen).catch(function (e) {
        console.warn('[tile] Worker 渲染失败，回退主线程：', e && e.message);
        self.mode = 'main';
        return self._requestMain(job, onProgress, myGen);
      });
    }
    return this._requestMain(job, onProgress, myGen);
  };

  TileSource.prototype._requestWorkers = function (job, myGen) {
    var bands = Math.min(this.workers.length, Math.max(1, Math.ceil(job.h / 4)));
    var rowsPer = Math.ceil(job.h / bands);
    var out = new Int32Array(job.w * job.h);
    var pending = [];
    for (var b = 0; b < bands; b++) {
      var r0 = b * rowsPer;
      var r1 = Math.min(job.h, r0 + rowsPer);
      if (r0 >= r1) continue;
      pending.push(this._runBand(this.workers[b % this.workers.length], job, r0, r1, out));
    }
    return Promise.all(pending).then(function () {
      return myGen === this.gen ? out : null;
    }.bind(this));
  };

  TileSource.prototype._runBand = function (worker, job, r0, r1, out) {
    return new Promise(function (resolve, reject) {
      var id = Math.random().toString(36).slice(2);
      var timer = setTimeout(function () { cleanup(); reject(new Error('worker timeout')); }, 30000);
      function cleanup() {
        clearTimeout(timer);
        worker.removeEventListener('message', onMsg);
      }
      function onMsg(ev) {
        var d = ev.data;
        if (!d || d.type !== 'tile' || d.id !== id) return;
        cleanup();
        if (d.error) { reject(new Error(d.error)); return; }
        out.set(d.data, r0 * job.w);
        resolve();
      }
      worker.addEventListener('message', onMsg);
      worker.postMessage({
        type: 'tile', id: id,
        mc: job.mc, dim: job.dim, seedLo: job.seedLo, seedHi: job.seedHi,
        x0: job.x0, z0: job.z0 + r0 * job.stride, w: job.w, h: r1 - r0,
        stride: job.stride, y: job.y
      });
    });
  };

  /** 主线程分片渲染：每 12ms 让出一次，保证拖动/缩放时界面不卡死 */
  TileSource.prototype._requestMain = function (job, onProgress, myGen) {
    var out = new Int32Array(job.w * job.h);
    var self = this;
    var rowsPerChunk = Math.max(4, Math.floor(4000 / Math.max(1, job.w)));
    var r = 0;
    return (function step() {
      var t0 = performance.now();
      var engine = job.engine || self.engine;
      while (r < job.h && performance.now() - t0 < 12) {
        var rows = Math.min(rowsPerChunk, job.h - r);
        var view = out.subarray(r * job.w, (r + rows) * job.w);
        engine.fillGrid(job.x0, job.z0 + r * job.stride, job.w, rows, job.stride, view, job.y);
        r += rows;
      }
      if (onProgress) onProgress(r / job.h);
      if (r < job.h) {
        return MC.util.nextFrame().then(step);
      }
      return myGen === self.gen ? out : null;
    })();
  };

  MC.TileSource = TileSource;
})(globalThis.MC);
