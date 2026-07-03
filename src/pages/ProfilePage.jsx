import React, { useEffect, useState } from 'react';
import { Send } from 'lucide-react';

import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

const emptyForm = {
  nickname: '', city: '', contactValue: '', server: '', gameNickname: '', sect: '',
  startedYear: '', industry: '', occupation: '', canOffer: '', lookingFor: '', supportMaterial: '',
};

function formFromResponse(result) {
  const profile = result.profile ?? {};
  const user = result.user ?? {};
  return Object.fromEntries(Object.keys(emptyForm).map((key) => [key, user[key] ?? profile[key] ?? '']));
}

export default function ProfilePage({ onSessionRefresh }) {
  const [state, setState] = useState({ loading: true, error: '', verificationStatus: 'not_submitted' });
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    api('/api/profile', { signal: controller.signal })
      .then((result) => {
        setForm(formFromResponse(result));
        setState({ loading: false, error: '', verificationStatus: result.verificationStatus });
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setState({ loading: false, error: error.message || '暂时无法加载名片', verificationStatus: 'not_submitted' });
        }
      });
    return () => controller.abort();
  }, []);

  const canSubmit = ['not_submitted', 'rejected'].includes(state.verificationStatus);
  const readOnly = !canSubmit;

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setFeedback('');
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFeedback('');
    try {
      const body = {
        ...form,
        startedYear: form.startedYear ? Number(form.startedYear) : null,
      };
      const result = await api('/api/profile/verification', { method: 'POST', body });
      setState((current) => ({ ...current, verificationStatus: result.verificationStatus }));
      setFeedback('认证资料已送交掌柜审核。');
      await onSessionRefresh?.();
    } catch (error) {
      setFeedback(error.status === 409 ? `资料未能提交：${error.message}` : error.message || '暂时无法提交认证');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="page profile-page" aria-labelledby="profile-title">
      <h2 id="profile-title">我的名片</h2>
      {state.loading && <p role="status">正在取来名片…</p>}
      {!state.loading && state.error && <p role="alert">{state.error}</p>}
      {!state.loading && !state.error && (
        <>
          <p>认证状态：<StatusBadge type="verification" status={state.verificationStatus} /></p>
          <p>我们不会索要游戏账号密码</p>
          <form onSubmit={submit}>
            <label>昵称<input name="nickname" value={form.nickname} onChange={update} readOnly={readOnly} required maxLength={40} /></label>
            <label>城市<input name="city" value={form.city} onChange={update} readOnly={readOnly} maxLength={40} /></label>
            <label>联系方式<input name="contactValue" value={form.contactValue} onChange={update} readOnly={readOnly} maxLength={160} /></label>
            <label>区服<input name="server" value={form.server} onChange={update} readOnly={readOnly} required maxLength={80} /></label>
            <label>游戏 ID/昵称<input name="gameNickname" value={form.gameNickname} onChange={update} readOnly={readOnly} required maxLength={80} /></label>
            <label>门派<input name="sect" value={form.sect} onChange={update} readOnly={readOnly} maxLength={40} /></label>
            <label>入坑年份<input name="startedYear" type="number" min="2009" max={new Date().getFullYear()} value={form.startedYear} onChange={update} readOnly={readOnly} /></label>
            <label>行业<input name="industry" value={form.industry} onChange={update} readOnly={readOnly} maxLength={80} /></label>
            <label>职业<input name="occupation" value={form.occupation} onChange={update} readOnly={readOnly} maxLength={80} /></label>
            <label>我能提供<textarea name="canOffer" value={form.canOffer} onChange={update} readOnly={readOnly} maxLength={500} /></label>
            <label>我在寻找<textarea name="lookingFor" value={form.lookingFor} onChange={update} readOnly={readOnly} maxLength={500} /></label>
            <label>辅助认证材料<textarea name="supportMaterial" value={form.supportMaterial} onChange={update} readOnly={readOnly} maxLength={500} /></label>
            {canSubmit && (
              <button type="submit" disabled={submitting}>
                <Send aria-hidden="true" size={18} />提交身份认证
              </button>
            )}
          </form>
          {feedback && <p role="status" aria-live="polite">{feedback}</p>}
        </>
      )}
    </section>
  );
}
