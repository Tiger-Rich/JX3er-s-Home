import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const verification = result.verification ?? {};
  return Object.fromEntries(Object.keys(emptyForm).map((key) => [
    key,
    key === 'supportMaterial'
      ? verification.supportMaterial ?? ''
      : user[key] ?? profile[key] ?? '',
  ]));
}

export default function ProfilePage({ onSessionRefresh }) {
  const [state, setState] = useState({
    loading: true,
    error: '',
    verificationStatus: 'not_submitted',
    rejectReason: null,
  });
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const mountedRef = useRef(false);
  const loadOwnerRef = useRef({ controller: null, version: 0 });
  const submissionOwnerRef = useRef({ controller: null, version: 0 });

  const loadProfile = useCallback(async () => {
    const owner = loadOwnerRef.current;
    owner.controller?.abort();
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    try {
      const result = await api('/api/profile', { signal: controller.signal });
      if (!mountedRef.current || owner.version !== requestId) return;
      setForm(formFromResponse(result));
      setState({
        loading: false,
        error: '',
        verificationStatus: result.verification?.status ?? result.verificationStatus,
        rejectReason: result.verification?.rejectReason ?? null,
      });
    } catch (error) {
      if (!mountedRef.current || owner.version !== requestId || error.name === 'AbortError') return;
      setState({
        loading: false,
        error: error.message || '暂时无法加载名片',
        verificationStatus: 'not_submitted',
        rejectReason: null,
      });
    } finally {
      if (owner.version === requestId) owner.controller = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadProfile();
    return () => {
      mountedRef.current = false;
      const loadOwner = loadOwnerRef.current;
      loadOwner.version += 1;
      loadOwner.controller?.abort();
      loadOwner.controller = null;
      const submissionOwner = submissionOwnerRef.current;
      submissionOwner.version += 1;
      submissionOwner.controller?.abort();
      submissionOwner.controller = null;
    };
  }, [loadProfile]);

  const canSubmit = ['not_submitted', 'rejected'].includes(state.verificationStatus);
  const readOnly = !canSubmit;

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    setFeedback(null);
  }

  async function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    const owner = submissionOwnerRef.current;
    if (owner.controller) return;
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setSubmitting(true);
    setFeedback(null);
    try {
      const body = {
        ...form,
        startedYear: form.startedYear ? Number(form.startedYear) : null,
      };
      const result = await api('/api/profile/verification', {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      if (!mountedRef.current || owner.version !== requestId) return;
      setState((current) => ({
        ...current,
        verificationStatus: result.verificationStatus,
        rejectReason: null,
      }));
      setFeedback({ type: 'success', message: '认证资料已送交掌柜审核。' });
      await onSessionRefresh?.();
    } catch (error) {
      if (!mountedRef.current || owner.version !== requestId || error.name === 'AbortError') return;
      setFeedback({
        type: 'error',
        message: error.status === 409 ? `资料未能提交：${error.message}` : error.message || '暂时无法提交认证',
      });
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setSubmitting(false);
      }
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
          {state.verificationStatus === 'rejected' && state.rejectReason && (
            <p>认证未通过原因：{state.rejectReason}</p>
          )}
          <p className="boundary-copy">我们不会索要游戏账号密码</p>
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
              <button type="submit" disabled={submitting} className="button-primary">
                <Send aria-hidden="true" size={18} />提交身份认证
              </button>
            )}
          </form>
          {feedback && <p role={feedback.type === 'success' ? 'status' : 'alert'} aria-live="polite">{feedback.message}</p>}
        </>
      )}
    </section>
  );
}
