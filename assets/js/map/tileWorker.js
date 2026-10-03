/*
 * 群系渲染 Worker：每个 Worker 持有独立的 cubiomes 句柄（句柄 API 线程安全），
 * 主线程把整块网格切成若干横向条带并行计算，显著缩短大范围地图的渲染时间。
 */
let mod = null;
let ready = false;
const ctxCache = new Map();
let cur = { mc: -1, dim: 0, lo: 0, hi: 0 };
let gridPtr = 0;
let gridCap = 0;

function ensureGrid(cells) {
  if (cells > gridCap) {
    if (gridPtr) mod._free(gridPtr);
    gridPtr = mod._malloc(cells * 4);
    gridCap = cells;
  }
  return gridPtr;
}

function ctxFor(mc, dim, lo, hi) {
  if (cur.mc !== mc) {
    ctxCache.forEach(function (h) { mod._wasm_destroy(h); });
    ctxCache.clear();
    cur.mc = mc;
  }
  var key = mc + ':' + dim;
  var h = ctxCache.get(key);
  if (h === undefined) {
    h = mod._wasm_create(mc, dim, lo, hi);
    if (!h) return 0;
    ctxCache.set(key, h);
  } else if (cur.lo !== lo || cur.hi !== hi) {
    mod._wasm_set_seed(h, lo, hi);
  }
  return h;
}

function computeTile(job) {
  const { mc, dim, seedLo, seedHi, x0, z0, w, h, stride, y } = job;
  const ctx = ctxFor(mc, dim, seedLo, seedHi);
  if (!ctx) return null;
  cur.lo = seedLo; cur.hi = seedHi;
  const out = new Int32Array(w * h);
  if (stride <= 1) {
    const ptr = ensureGrid(w * h);
    if (!ptr) return null;
    if (mod._wasm_ctx_generate_biomes(ctx, x0, z0, w, h, 4, y, ptr) !== 0) return null;
    out.set(mod.HEAP32.subarray(ptr / 4, ptr / 4 + w * h));
  } else {
    let i = 0;
    for (let gz = 0; gz < h; gz++) {
      const gz2 = z0 + gz * stride;
      for (let gx = 0; gx < w; gx++) {
        out[i++] = mod._wasm_ctx_get_biome(ctx, 4, x0 + gx * stride, y, gz2);
      }
    }
  }
  return out;
}

self.onmessage = async function (ev) {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      const base = msg.url.replace(/[^\/]*$/, '');
      const glue = await import(msg.url);
      const factory = glue.default || glue;
      mod = await factory({ locateFile: (p) => base + p });
      ready = typeof mod._wasm_create === 'function';
    } catch (e) {
      ready = false;
      mod = null;
      self.postMessage({ type: 'ready', ok: false, error: String((e && e.message) || e) });
      return;
    }
    self.postMessage({ type: 'ready', ok: ready });
    return;
  }
  if (msg.type === 'tile') {
    if (!ready) {
      self.postMessage({ type: 'tile', id: msg.id, error: 'engine unavailable' });
      return;
    }
    let data = null, error = '';
    try {
      data = computeTile(msg);
      if (!data) error = 'generate failed';
    } catch (e) {
      error = String((e && e.message) || e);
    }
    if (data) {
      self.postMessage({ type: 'tile', id: msg.id, data: data }, [data.buffer]);
    } else {
      self.postMessage({ type: 'tile', id: msg.id, error: error });
    }
  }
};
