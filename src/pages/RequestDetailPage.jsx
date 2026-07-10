import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, Flag, Send } from 'lucide-react';

import { api } from '../api/client.js';
import { requestTypes } from '../domain/constants.js';

function typeLabel(value) {
  return requestTypes.find((type) => type.value === value)?.label ?? '其他';
}

function renderLocation(request) {
  if (request.remote && request.city) return `可远程，${request.city}`;
  if (request.remote) return '可远程';
  return request.city || '未注明';
}

export default function RequestDetailPage({ requestId, session, onBack }) {
  const [state, setState] = useState({ loading: true, error: '', request: null });
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [busyAction, setBusyAction] = useState('');
  const mountedRef = useRef(false);
  const loadOwnerRef = useRef({ controller: null, version: 0 });
  const mutationOwnerRef = useRef({ controller: null, version: 0 });
  const approved = session?.verificationStatus === 'approved';
  const isOwnRequest =
    state.request?.ownerId !== undefined &&
    session?.user?.id === state.request.ownerId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const loadOwner = loadOwnerRef.current;
      loadOwner.version += 1;
      loadOwner.controller?.abort();
      loadOwner.controller = null;
      const mutationOwner = mutationOwnerRef.current;
      mutationOwner.version += 1;
      mutationOwner.controller?.abort();
      mutationOwner.controller = null;
    };
  }, []);

  useEffect(() => {
    const owner = loadOwnerRef.current;
    owner.controller?.abort();
    const controller = new AbortController();
    const loadId = owner.version + 1;
    owner.version = loadId;
    owner.controller = controller;
    setState({ loading: true, error: '', request: null });
    api(`/api/requests/${requestId}`, { signal: controller.signal })
      .then((result) => {
        if (!mountedRef.current || owner.version !== loadId) return;
        setState({ loading: false, error: '', request: result.request });
      })
      .catch((error) => {
        if (!mountedRef.current || owner.version !== loadId || error.name === 'AbortError') return;
        setState({ loading: false, error: error.message || '暂时无法加载委托', request: null });
      })
      .finally(() => {
        if (owner.version === loadId) owner.controller = null;
      });
    return () => {
      if (owner.version === loadId) {
        owner.version += 1;
        owner.controller?.abort();
        owner.controller = null;
      }
    };
  }, [requestId]);

  async function runAction(action, path, body, successMessage) {
    const owner = mutationOwnerRef.current;
    if (owner.controller) return;
    const controller = new AbortController();
    const mutationId = owner.version + 1;
    owner.version = mutationId;
    owner.controller = controller;
    setBusyAction(action);
    setFeedback(null);
    try {
      await api(path, {
        method: 'POST',
        signal: controller.signal,
        ...(body ? { body } : {}),
      });
      if (!mountedRef.current || owner.version !== mutationId) return;
      setFeedback({ type: 'success', message: successMessage });
      if (action === 'application') setMessage('');
      if (action === 'report') setReason('');
    } catch (error) {
      if (!mountedRef.current || owner.version !== mutationId || error.name === 'AbortError') return;
      setFeedback({
        type: 'error',
        message: error.status === 409 ? `未能完成：${error.message}` : error.message || '暂时无法完成操作',
      });
    } finally {
      if (owner.version === mutationId) {
        owner.controller = null;
        if (mountedRef.current) setBusyAction('');
      }
    }
  }

  return (
    <section className="request-detail-page" aria-labelledby="request-detail-title">
      <div className="request-detail-panel">
        <button type="button" onClick={onBack} className="button-secondary">
          <ArrowLeft aria-hidden="true" size={18} />
          返回万事广场
        </button>
        {state.loading && <p role="status">正在查看委托…</p>}
        {!state.loading && state.error && <p role="alert">{state.error}</p>}
        {state.request && (
          <>
            <p className="eyebrow">{typeLabel(state.request.type)}</p>
            <h2 id="request-detail-title">{state.request.title}</h2>
            <p className="page-intro">{state.request.description}</p>
            <dl className="detail-grid">
              <div className="detail-item">
                <dt>地点</dt>
                <dd>{renderLocation(state.request)}</dd>
              </div>
              <div className="detail-item">
                <dt>行业</dt>
                <dd>{state.request.industry || '未注明'}</dd>
              </div>
              <div className="detail-item">
                <dt>回报或预算</dt>
                <dd>{state.request.budgetOrReward || '面议'}</dd>
              </div>
              <div className="detail-item">
                <dt>有效期</dt>
                <dd>{new Date(state.request.expiresAt).toLocaleString('zh-CN')}</dd>
              </div>
            </dl>
          </>
        )}
      </div>

      {state.request && (
        <>
          <section className="owner-card" aria-labelledby="owner-title">
            <h3 id="owner-title">发布者名片</h3>
            <p>{state.request.owner?.nickname || '未署名'}</p>
            {state.request.owner?.server && <p>区服：{state.request.owner.server}</p>}
            {state.request.owner?.gameNickname && <p>游戏 ID/昵称：{state.request.owner.gameNickname}</p>}
            {state.request.owner?.sect && <p>门派：{state.request.owner.sect}</p>}
            {state.request.owner?.startedYear && <p>入坑年份：{state.request.owner.startedYear}</p>}
            {state.request.owner?.city && <p>所在城市：{state.request.owner.city}</p>}
            {state.request.owner?.industry && <p>从事行业：{state.request.owner.industry}</p>}
            {state.request.owner?.verificationStatus === 'approved' && <p>已确认身份</p>}
          </section>

          <section className="detail-card">
            {isOwnRequest ? (
              <p className="boundary-copy">这是你发布的委托，其他番薯递出联系申请后会在联系申请里出现。</p>
            ) : approved ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  runAction(
                    'application',
                    `/api/requests/${requestId}/applications`,
                    { message },
                    '联系申请已递出，请等对方回应。',
                  );
                }}
              >
                <label>
                  联系申请-给ta一个和你交换联系方式的理由
                  <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    required
                    maxLength={1000}
                  />
                </label>
                <button type="submit" disabled={Boolean(busyAction)} className="button-primary">
                  <Send aria-hidden="true" size={18} />
                  递出联系申请
                </button>
              </form>
            ) : (
              <p className="boundary-copy attention-copy">点击我的名片，完成身份认证后，才可递出联系申请或收藏委托。</p>
            )}
            <button
              type="button"
              className="button-secondary"
              disabled={!approved || Boolean(busyAction)}
              onClick={() =>
                runAction('favorite', `/api/requests/${requestId}/favorite`, null, '已收藏这份委托。')
              }
            >
              <Bookmark aria-hidden="true" size={18} />
              收藏委托
            </button>
          </section>

          <section className="detail-card">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                runAction('report', `/api/requests/${requestId}/report`, { reason }, '举报已提交，掌柜会核查。');
              }}
            >
              <label>
                举报原因
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                  maxLength={500}
                />
              </label>
              <button type="submit" disabled={Boolean(busyAction)} className="button-danger">
                <Flag aria-hidden="true" size={18} />
                确认举报
              </button>
            </form>
            {feedback && (
              <p role={feedback.type === 'success' ? 'status' : 'alert'} aria-live="polite">
                {feedback.message}
              </p>
            )}
          </section>
        </>
      )}
    </section>
  );
}
