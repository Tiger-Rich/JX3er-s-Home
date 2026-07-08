import React, { useState } from 'react';

export default function LoginPage({
  onSubmit,
  onErrorClear = () => {},
  error = '',
}) {
  const [mode, setMode] = useState('login');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const isRegister = mode === 'register';

  function clearErrors() {
    setLocalError('');
    onErrorClear();
  }

  function switchMode(nextMode) {
    if (submitting) return;
    setMode(nextMode);
    clearErrors();
  }

  function updateField(setter, value) {
    clearErrors();
    setter(value);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setLocalError('');
    try {
      await onSubmit({
        mode,
        account,
        password,
        ...(isRegister ? { nickname } : {}),
      });
    } catch (submissionError) {
      setLocalError(submissionError.message || '暂时无法完成，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  const actionLabel = isRegister ? '注册' : '登录';

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <p className="login-brand">番薯万事屋</p>
        <h1 id="login-title">
          {isRegister ? '注册番薯身份' : '登录番薯万事屋'}
        </h1>
        <p>把身份说明白，让每一次相遇更值得信任。</p>

        <div className="auth-mode" role="group" aria-label="账号操作">
          <button
            type="button"
            aria-pressed={!isRegister}
            disabled={submitting}
            onClick={() => switchMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            aria-pressed={isRegister}
            disabled={submitting}
            onClick={() => switchMode('register')}
          >
            注册
          </button>
        </div>

        {(localError || error) && <p role="alert">{localError || error}</p>}

        <form onSubmit={handleSubmit}>
          <label>
            <span>账号</span>
            <input
              name="account"
              autoComplete="username"
              required
              value={account}
              onChange={(event) =>
                updateField(setAccount, event.target.value)
              }
            />
          </label>

          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(event) =>
                updateField(setPassword, event.target.value)
              }
            />
          </label>

          {isRegister && (
            <label>
              <span>昵称</span>
              <input
                name="nickname"
                autoComplete="nickname"
                required
                value={nickname}
                onChange={(event) =>
                  updateField(setNickname, event.target.value)
                }
              />
            </label>
          )}

          <button type="submit" disabled={submitting} className="button-primary">
            {submitting ? (
              <span role="status" aria-live="polite">
                {actionLabel}中…
              </span>
            ) : actionLabel}
          </button>
        </form>
      </section>
    </main>
  );
}
