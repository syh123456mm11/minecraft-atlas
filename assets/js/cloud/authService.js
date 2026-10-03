/*
 * 账号服务：邮箱密码登录、邮箱验证码登录/注册、找回密码、会话恢复与登出。
 * Web 端只有邮箱登录（手机号/微信登录在小程序端才有），这里不做任何本地假账号兜底：
 * 没有真实会话就是未登录，受 RLS 保护的数据一律读不到——这是设计而非缺陷。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var session = null;        // 当前会话，含 user
  var pendingOtp = null;     // 已发送验证码的上下文 { email, verificationId, isExistingUser }
  var pendingReset = null;   // 找回密码流程句柄 { email, handle }

  function client() { return MC.cloud.get(); }

  function ensure() {
    if (!client()) return Promise.reject(new Error('云服务未初始化'));
    return Promise.resolve(client());
  }

  /** 统一取错误信息：SDK 返回 { data, error }，error 可能是对象也可能是 Error */
  function messageOf(err, fallback) {
    if (!err) return fallback || '操作失败';
    if (typeof err === 'string') return err;
    return err.message || fallback || '操作失败';
  }

  function fail(err, fallback) {
    var e = new Error(messageOf(err, fallback));
    e.kind = err && err.kind;
    e.code = err && err.code;
    return e;
  }

  function apply(sessionData) {
    session = sessionData || null;
    MC.bus.emit('auth:changed', user());
    return user();
  }

  function user() { return session && session.user ? session.user : null; }
  function uid() { var u = user(); return u ? (u.id || u.uid || u.sub || '') : ''; }
  function email() { var u = user(); return u && u.email ? String(u.email) : ''; }

  /** 会话恢复：刷新页面后仍能保持登录态 */
  function restore() {
    return MC.cloud.init()
      .then(ensure)
      .then(function (c) { return c.auth.getSession(); })
      .then(function (res) { return apply(res && !res.error ? res.data : null); })
      .catch(function () { return apply(null); });
  }

  function signInWithPassword(mail, password) {
    return ensure().then(function (c) { return c.auth.signInWithPassword({ email: mail, password: password }); })
      .then(function (res) {
        if (res.error) throw fail(res.error, '邮箱或密码不正确');
        return apply(res.data);
      });
  }

  /** 发送验证码：只发码，不校验。返回的上下文留给下一步提交使用 */
  function sendCode(mail) {
    return ensure().then(function (c) { return c.auth.sendOtp({ email: mail }); })
      .then(function (res) {
        if (res.error) throw fail(res.error, '验证码发送失败');
        pendingOtp = {
          email: mail,
          verificationId: res.data.verificationId,
          isExistingUser: !!res.data.isExistingUser
        };
        // 返回账号是否已存在：新邮箱注册必须带密码，界面据此决定是否补一个密码框
        return { sent: true, isExistingUser: pendingOtp.isExistingUser };
      });
  }

  /**
   * 提交验证码完成登录/注册。
   * 新邮箱必须带密码，否则账号将来无法用密码登录；已注册用户只需验证码。
   */
  function verifyCode(mail, code, password) {
    if (!pendingOtp || pendingOtp.email !== mail) {
      throw fail(null, '请先为当前邮箱获取验证码');
    }
    var pending = pendingOtp;
    var needPassword = !pending.isExistingUser;
    if (needPassword && !password) throw fail(null, '该邮箱尚未注册，请设置登录密码');

    return ensure().then(function (c) {
      return c.auth.verifyOtp({
        email: pending.email,
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: code,
        password: needPassword ? password : undefined
      });
    }).then(function (res) {
      if (res.error) throw fail(res.error, '验证码不正确或已过期');
      pendingOtp = null;
      return apply(res.data);
    });
  }

  /** 找回密码第一步：向邮箱发送重置码，句柄留给第二步 */
  function startReset(mail) {
    return ensure().then(function (c) { return c.auth.resetPasswordForEmail(mail); })
      .then(function (res) {
        if (res.error) throw fail(res.error, '重置邮件发送失败');
        pendingReset = { email: mail, handle: res.data };
        return { sent: true };
      });
  }

  /** 找回密码第二步：用邮箱收到的重置码设置新密码 */
  function finishReset(mail, code, newPassword) {
    if (!pendingReset || pendingReset.email !== mail) throw fail(null, '请先为当前邮箱获取重置码');
    var handle = pendingReset.handle;
    if (!handle || typeof handle.updateUser !== 'function') throw fail(null, '重置流程已失效，请重新获取重置码');
    return Promise.resolve(handle.updateUser({ nonce: code, password: newPassword }))
      .then(function (res) {
        if (res && res.error) throw fail(res.error, '重置码不正确或已过期');
        pendingReset = null;
        return apply(res && res.data ? res.data : null);
      })
      .catch(function (err) {
        if (err instanceof Error && err.message.indexOf('重置码') === 0) throw err;
        throw fail(err, '重置失败，请稍后重试');
      });
  }

  function signOut() {
    return ensure().then(function (c) { return c.auth.signOut(); })
      .then(function () { return apply(null); })
      .catch(function (err) {
        apply(null);
        throw fail(err, '退出登录失败');
      });
  }

  MC.auth = {
    restore: restore,
    signInWithPassword: signInWithPassword,
    sendCode: sendCode,
    verifyCode: verifyCode,
    startReset: startReset,
    finishReset: finishReset,
    signOut: signOut,
    user: user,
    uid: uid,
    email: email,
    isSignedIn: function () { return !!user(); },
    /** 会话过期类错误提示用户重新登录，网络类错误保留当前会话 */
    isAuthError: function (err) { return err && (err.kind === 'unauthenticated' || err.kind === 'invalid_grant' || err.code === '401'); }
  };
})(globalThis.MC);
