/*
 * 账号面板：顶栏头像按钮 + 登录弹窗（密码登录 / 验证码登录 / 注册 / 找回密码）。
 * 只走邮箱——Web 端不支持手机号与微信登录，不要在这里补短信路径。
 * 发送验证码与提交验证码是两个独立动作：提交时复用已保存的 challenge，绝不重新发码。
 */
globalThis.MC = globalThis.MC || {};
(function (MC) {
  'use strict';

  var mode = 'password';
  var cooldown = 0;

  function setStatus(text, cls) {
    var el = MC.util.qs('#authStatus');
    el.className = 'status' + (cls ? ' ' + cls : '');
    el.textContent = text || '';
  }

  function busy(on) {
    MC.util.qsa('#authBody button').forEach(function (b) { b.disabled = on; });
  }

  function field(id, label, type, placeholder) {
    return '<label><span>' + label + '</span>' +
      '<input type="' + type + '" id="' + id + '" placeholder="' + placeholder + '" autocomplete="' +
      (type === 'password' ? 'current-password' : 'off') + '"></label>';
  }

  /** 需要验证码的模式共用：邮箱 + 发码按钮 */
  function emailWithSendButton(label, sendText) {
    return '<label><span>' + label + '</span><div class="row">' +
      '<input type="email" id="authEmail" placeholder="you@example.com">' +
      '<button type="button" id="authSend" class="ghost">' + sendText + '</button></div></label>';
  }

  function templates() {
    return {
      password: {
        title: '密码登录',
        submit: '登录',
        html: field('authEmail', '邮箱', 'email', 'you@example.com') +
          field('authPassword', '密码', 'password', '登录密码')
      },
      otp: {
        title: '验证码登录',
        submit: '登录 / 注册',
        html: emailWithSendButton('邮箱', '获取验证码') +
          field('authCode', '验证码', 'text', '邮箱收到的验证码')
      },
      signup: {
        title: '注册新账号',
        submit: '注册并登录',
        html: emailWithSendButton('邮箱', '获取验证码') +
          field('authPassword', '设置登录密码', 'password', '至少 8 位') +
          field('authCode', '验证码', 'text', '邮箱收到的验证码')
      },
      reset: {
        title: '找回密码',
        submit: '设置新密码',
        html: emailWithSendButton('邮箱', '获取重置码') +
          field('authCode', '重置码', 'text', '邮箱收到的重置码') +
          field('authPassword', '新密码', 'password', '至少 8 位')
      }
    };
  }

  function renderBody() {
    var box = MC.util.qs('#authBody');
    var tpl = templates()[mode];
    MC.util.qs('#authTitle').textContent = tpl.title;
    box.innerHTML = tpl.html +
      '<button class="primary block" id="authSubmit" type="button">' + tpl.submit + '</button>';

    var send = MC.util.qs('#authSend');
    if (send) send.addEventListener('click', onSend);
    MC.util.qs('#authSubmit').addEventListener('click', onSubmit);
    tickCooldown();
  }

  function signedInBody() {
    var mail = MC.auth.email();
    MC.util.qs('#authTitle').textContent = '我的账号';
    MC.util.qs('#authBody').innerHTML =
      '<div class="account-view">' +
      '<div class="account-avatar-lg">' + (mail ? mail.charAt(0).toUpperCase() : '☺') + '</div>' +
      '<div class="account-mail">' + MC.util.escape(mail || '已登录') + '</div>' +
      '<p class="hint">收藏的种子与服务器查询历史会保存在这个账号下，换设备登录后自动同步。</p>' +
      '<button class="block" id="authSignOut" type="button">退出登录</button></div>';
    MC.util.qs('#authSignOut').addEventListener('click', function () {
      MC.auth.signOut()
        .then(function () { MC.toast('已退出登录', 'ok'); close(); })
        .catch(function () { MC.toast('退出失败，请重试', 'error'); });
    });
  }

  function tickCooldown() {
    var send = MC.util.qs('#authSend');
    if (!send) return;
    if (cooldown > 0) {
      send.disabled = true;
      send.textContent = cooldown + ' 秒后重发';
      cooldown--;
      setTimeout(tickCooldown, 1000);
    } else {
      send.disabled = false;
      send.textContent = mode === 'reset' ? '获取重置码' : '获取验证码';
    }
  }

  /** 验证码登录时若发现是新邮箱，就地补一个密码框——邮箱注册必须有密码 */
  function revealPasswordField() {
    var body = MC.util.qs('#authBody');
    if (!body || MC.util.qs('#authPassword')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = field('authPassword', '该邮箱尚未注册，请设置登录密码', 'password', '至少 8 位');
    body.insertBefore(wrap.firstChild, MC.util.qs('#authSubmit'));
  }

  function onSend() {
    var mail = (MC.util.qs('#authEmail').value || '').trim();
    if (!mail) { setStatus('请先填写邮箱', 'is-error'); return; }
    var btn = MC.util.qs('#authSend');
    btn.disabled = true;
    setStatus('发送中…');
    var job = mode === 'reset' ? MC.auth.startReset(mail) : MC.auth.sendCode(mail);
    job.then(function (res) {
      setStatus('已发送，请查收邮件（可能在垃圾箱）', 'is-ok');
      cooldown = 60;
      tickCooldown();
      MC.toast(mode === 'reset' ? '重置码已发送到邮箱' : '验证码已发送到邮箱', 'ok');
      if (mode === 'otp' && res && res.isExistingUser === false) revealPasswordField();
    }).catch(function (err) {
      btn.disabled = false;
      setStatus(err.message || '发送失败', 'is-error');
    });
  }

  function onSubmit() {
    var mail = (MC.util.qs('#authEmail').value || '').trim();
    var code = (MC.util.qs('#authCode') ? MC.util.qs('#authCode').value : '').trim();
    var pwd = MC.util.qs('#authPassword') ? MC.util.qs('#authPassword').value : '';

    var pwdField = MC.util.qs('#authPassword');
    if (!mail) { setStatus('请先填写邮箱', 'is-error'); return; }
    if (mode !== 'password' && !code) { setStatus('请输入邮箱收到的验证码', 'is-error'); return; }
    // 注册 / 找回 / 验证码登录遇到新邮箱时都必须有密码；密码登录不限制长度
    if (mode !== 'password' && pwdField && pwd.length < 8) { setStatus('密码至少 8 位', 'is-error'); return; }

    busy(true);
    setStatus('处理中…');
    // 包一层 Promise：同步抛出的校验错误（如未发码就提交）也要落到提示里，而不是卡在「处理中」
    Promise.resolve().then(function () {
      if (mode === 'password') return MC.auth.signInWithPassword(mail, pwd);
      if (mode === 'reset') return MC.auth.finishReset(mail, code, pwd);
      return MC.auth.verifyCode(mail, code, pwd);
    }).then(function () {
      busy(false);
      setStatus('');
      MC.toast(mode === 'signup' ? '注册成功，已登录' : '登录成功', 'ok');
      close();
    }).catch(function (err) {
      busy(false);
      setStatus(err.message || '操作失败', 'is-error');
    });
  }

  function open(nextMode) {
    mode = nextMode || 'password';
    var modal = MC.util.qs('#authModal');
    modal.hidden = false;
    requestAnimationFrame(function () { modal.classList.add('is-open'); });
    setStatus('');
    MC.util.qsa('#authSeg button').forEach(function (b) {
      b.classList.toggle('is-active', b.dataset.mode === mode);
    });
    if (MC.auth.isSignedIn()) signedInBody();
    else renderBody();
    var first = MC.util.qs('#authBody input');
    if (first) first.focus();
  }

  function close() {
    var modal = MC.util.qs('#authModal');
    modal.classList.remove('is-open');
    setTimeout(function () { modal.hidden = true; }, 180);
  }

  function renderHeader() {
    var label = MC.util.qs('#accountLabel');
    var avatar = MC.util.qs('#accountAvatar');
    var btn = MC.util.qs('#accountBtn');
    if (MC.auth.isSignedIn()) {
      var mail = MC.auth.email();
      btn.classList.add('is-signed-in');
      label.textContent = mail || '已登录';
      avatar.textContent = mail ? mail.charAt(0).toUpperCase() : '☺';
      btn.title = '账号：' + mail;
    } else {
      btn.classList.remove('is-signed-in');
      label.textContent = '登录';
      avatar.textContent = '☺';
      btn.title = '登录后云同步收藏与历史';
    }
  }

  MC.AccountPanel = {
    init: function () {
      MC.util.qs('#accountBtn').addEventListener('click', function () { open('password'); });
      MC.util.qs('#authClose').addEventListener('click', close);
      MC.util.qs('#authModal').addEventListener('click', function (e) {
        if (e.target && e.target.dataset && e.target.dataset.close) close();
      });
      MC.util.qsa('#authSeg button').forEach(function (b) {
        b.addEventListener('click', function () {
          mode = b.dataset.mode;
          MC.util.qsa('#authSeg button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
          setStatus('');
          renderBody();
        });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !MC.util.qs('#authModal').hidden) close();
      });

      MC.bus.on('auth:changed', renderHeader);
      renderHeader();

      // 恢复会话：失败也只当作未登录，不阻塞主流程
      MC.auth.restore().then(function (u) {
        if (u) MC.toast('已恢复登录状态', 'ok');
      });
    },
    open: open
  };
})(globalThis.MC);
