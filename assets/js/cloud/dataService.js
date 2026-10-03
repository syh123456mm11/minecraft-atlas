/*
 * 数据服务：种子收藏（seed_marks）与服务器查询历史（server_history）的云端读写。
 *
 * 两条硬规则：
 *   1. 写操作前先过登录闸门——没真实会话就不发请求，避免拿到被 RLS 拦掉的假成功。
 *   2. 插入时绝不传 owner_id，由列默认值 auth.uid() 填；数据库侧 RLS 才是真正的边界。
 * UPDATE/DELETE 返回空数组意味着 RLS 过滤掉了这些行，必须向上报告而不是当作成功。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var T_MARKS = 'seed_marks';
  var T_HISTORY = 'server_history';
  var MAX_ROWS = 100;

  function client() {
    var c = MC.cloud.get();
    if (!c) throw new Error('云服务未初始化');
    return c;
  }

  function guard() {
    if (!MC.auth.isSignedIn()) {
      var err = new Error('请先登录，收藏与历史会保存在你的账号下');
      err.needLogin = true;
      return Promise.reject(err);
    }
    return Promise.resolve();
  }

  function unwrap(res) {
    if (res && res.error) throw res.error;
    return res ? res.data : null;
  }

  /** 把数据库错误翻译成用户看得懂的话 */
  function explain(err, fallback) {
    var msg = (err && err.message) || fallback || '操作失败';
    if (err && err.code === '42P01') return '云端数据表尚未就绪，请稍后重试';
    if (err && err.code === '42501') return '没有权限执行该操作，请重新登录后重试';
    if (err && err.code === '23505') return '已存在相同记录';
    if (MC.auth.isAuthError(err)) return '登录状态已失效，请重新登录';
    return msg;
  }

  function toMark(row) {
    return {
      id: row.id,
      seedText: row.seed_text,
      version: row.version,
      dim: row.dim,
      x: Number(row.pos_x) || 0,
      z: Number(row.pos_z) || 0,
      zoom: Number(row.zoom) || 4,
      label: row.label || '',
      note: row.note || '',
      createdAt: row.created_at
    };
  }

  function toHistory(row) {
    return {
      id: row.id,
      host: row.host,
      version: row.version || '',
      online: row.players_online == null ? null : Number(row.players_online),
      max: row.players_max == null ? null : Number(row.players_max),
      motd: row.motd || '',
      account: row.account || '',
      createdAt: row.created_at
    };
  }

  function listMarks() {
    return guard()
      .then(function () {
        return client().database.from(T_MARKS)
          .select('*').order('created_at', { ascending: false }).limit(MAX_ROWS);
      })
      .then(function (res) { return (unwrap(res) || []).map(toMark); })
      .catch(function (err) { throw new Error(explain(err, '读取收藏失败')); });
  }

  function addMark(mark) {
    return guard()
      .then(function () {
        return client().database.from(T_MARKS).insert({
          seed_text: String(mark.seedText || ''),
          version: String(mark.version || ''),
          dim: Number(mark.dim) || 0,
          pos_x: Math.round(Number(mark.x) || 0),
          pos_z: Math.round(Number(mark.z) || 0),
          zoom: Number(mark.zoom) || 4,
          label: String(mark.label || '').slice(0, 60),
          note: String(mark.note || '').slice(0, 200)
        }).select();
      })
      .then(function (res) {
        var rows = unwrap(res) || [];
        if (!rows.length) throw new Error('保存失败：云端未返回记录，请重新登录后重试');
        return toMark(rows[0]);
      })
      .catch(function (err) { throw new Error(explain(err, '保存收藏失败')); });
  }

  function renameMark(id, label) {
    return guard()
      .then(function () {
        return client().database.from(T_MARKS)
          .update({ label: String(label || '').slice(0, 60) }).eq('id', id).select();
      })
      .then(function (res) {
        var rows = unwrap(res) || [];
        if (!rows.length) throw new Error('没有可修改的记录，它可能已被删除');
        return toMark(rows[0]);
      })
      .catch(function (err) { throw new Error(explain(err, '修改失败')); });
  }

  function removeMark(id) {
    return guard()
      .then(function () {
        return client().database.from(T_MARKS).delete().eq('id', id).select();
      })
      .then(function (res) {
        if (!(unwrap(res) || []).length) throw new Error('没有可删除的记录，它可能已被删除');
        return true;
      })
      .catch(function (err) { throw new Error(explain(err, '删除失败')); });
  }

  function listHistory() {
    return guard()
      .then(function () {
        return client().database.from(T_HISTORY)
          .select('*').order('created_at', { ascending: false }).limit(MAX_ROWS);
      })
      .then(function (res) { return (unwrap(res) || []).map(toHistory); })
      .catch(function (err) { throw new Error(explain(err, '读取历史失败')); });
  }

  /** 查询成功后写入一条历史；同一地址重复查询只保留最新一条，避免列表被刷屏 */
  function recordHistory(entry) {
    return guard()
      .then(function () {
        return client().database.from(T_HISTORY).insert({
          host: String(entry.host || '').slice(0, 120),
          version: String(entry.version || '').slice(0, 40),
          players_online: entry.online == null ? null : Number(entry.online),
          players_max: entry.max == null ? null : Number(entry.max),
          motd: String(entry.motd || '').slice(0, 300),
          account: String(entry.account || '').slice(0, 32)
        }).select();
      })
      .then(function (res) {
        var rows = unwrap(res) || [];
        if (!rows.length) throw new Error('写入历史失败，请重新登录后重试');
        return toHistory(rows[0]);
      })
      .catch(function (err) {
        // 历史只是附加记录，写失败不应该打断查询主流程
        console.warn('[history]', err && err.message);
        return null;
      });
  }

  function removeHistory(id) {
    return guard()
      .then(function () {
        return client().database.from(T_HISTORY).delete().eq('id', id).select();
      })
      .then(function (res) {
        if (!(unwrap(res) || []).length) throw new Error('没有可删除的记录，它可能已被删除');
        return true;
      })
      .catch(function (err) { throw new Error(explain(err, '删除失败')); });
  }

  MC.data = {
    listMarks: listMarks,
    addMark: addMark,
    renameMark: renameMark,
    removeMark: removeMark,
    listHistory: listHistory,
    recordHistory: recordHistory,
    removeHistory: removeHistory
  };
})(globalThis.MC);
