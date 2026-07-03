import React, { useEffect, useState } from 'react';
import { ArrowLeft, Bookmark, Flag, Send } from 'lucide-react';

import { api } from '../api/client.js';
import { requestTypes } from '../domain/constants.js';

function typeLabel(value) {
  return requestTypes.find((type) => type.value === value)?.label ?? '其他';
}

export default function RequestDetailPage({ requestId, session, onBack }) {
  const [state, setState] = useState({ loading: true, error: '', request: null });
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const approved = session?.verificationStatus === 'approved';

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, error: '', request: null });
    api(`/api/requests/${requestId}`, { signal: controller.signal })
      .then((result) => setState({ loading: false, error: '', request: result.request }))
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setState({ loading: false, error: error.message || '暂时无法加载委托', request: null });
        }
      });
    return () => controller.abort();
  }, [requestId]);

  async function runAction(action, path, body, successMessage) {
    setBusyAction(action);
    setFeedback('');
    try {
      await api(path, { method: 'POST', ...(body ? { body } : {}) });
      setFeedback(successMessage);
      if (action === 'application') setMessage('');
      if (action === 'report') setReason('');
    } catch (error) {
      setFeedback(error.status === 409 ? `未能完成：${error.message}` : error.message || '暂时无法完成操作');
    } finally {
      setBusyAction('');
    }
  }

  return (
    <section className="page request-detail-page" aria-labelledby="request-detail-title">
      <button type="button" onClick={onBack}>
        <ArrowLeft aria-hidden="true" size={18} />
        返回万事广场
      </button>
      {state.loading && <p role="status">正在查看委托…</p>}
      {!state.loading && state.error && <p role="alert">{state.error}</p>}
      {state.request && (
        <>
          <p>{typeLabel(state.request.type)}</p>
          <h2 id="request-detail-title">{state.request.title}</h2>
          <p>{state.request.description}</p>
          <dl>
            <dt>地点</dt><dd>{state.request.remote ? '可远程' : state.request.city || '未注明'}{state.request.remote && state.request.city ? `，${state.request.city}` : ''}</dd>
            <dt>行业</dt><dd>{state.request.industry || '未注明'}</dd>
            <dt>回报或预算</dt><dd>{state.request.budgetOrReward || '面议'}</dd>
            <dt>有效期</dt><dd>{new Date(state.request.expiresAt).toLocaleString('zh-CN')}</dd>
          </dl>
          <section aria-labelledby="owner-title">
            <h3 id="owner-title">发布者名片</h3>
            <p>{state.request.owner?.nickname || '未署名'}</p>
            {state.request.owner?.server && <p>区服：{state.request.owner.server}</p>}
            {state.request.owner?.gameNickname && <p>游戏 ID/昵称：{state.request.owner.gameNickname}</p>}
            {state.request.owner?.sect && <p>门派：{state.request.owner.sect}</p>}
            {state.request.owner?.verificationStatus === 'approved' && <p>已确认身份</p>}
          </section>

          {approved ? (
            <form onSubmit={(event) => {
              event.preventDefault();
              runAction('application', `/api/requests/${requestId}/applications`, { message }, '联系申请已递出，请等对方回应。');
            }}>
              <label>一句话联系申请<input value={message} onChange={(event) => setMessage(event.target.value)} required maxLength={1000} /></label>
              <button type="submit" disabled={busyAction === 'application'}>
                <Send aria-hidden="true" size={18} />递出联系申请
              </button>
            </form>
          ) : <p>完成身份认证后，才可递出联系申请或收藏委托。</p>}

          <button
            type="button"
            disabled={!approved || busyAction === 'favorite'}
            onClick={() => runAction('favorite', `/api/requests/${requestId}/favorite`, null, '已收藏这份委托。')}
          >
            <Bookmark aria-hidden="true" size={18} />收藏委托
          </button>

          <form onSubmit={(event) => {
            event.preventDefault();
            runAction('report', `/api/requests/${requestId}/report`, { reason }, '举报已提交，掌柜会核查。');
          }}>
            <label>举报原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={500} /></label>
            <button type="submit" disabled={busyAction === 'report'}>
              <Flag aria-hidden="true" size={18} />确认举报
            </button>
          </form>
          {feedback && <p role="status" aria-live="polite">{feedback}</p>}
        </>
      )}
    </section>
  );
}
