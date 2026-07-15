import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, FilePenLine, Send, Trash2, XCircle } from 'lucide-react';

import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';
import { requestTypes } from '../domain/constants.js';
import { myRequestActions, myRequestFilters } from '../domain/myRequests.js';

function requestTypeLabel(value) {
  return requestTypes.find((type) => type.value === value)?.label ?? '其他';
}

function locationLabel(request) {
  if (request.remote && request.city) return `${request.city} / 可远程`;
  if (request.remote) return '可远程';
  return request.city || '未标注城市';
}

export default function MyRequestsPage({
  refreshKey,
  onSelectRequest,
  onEditRequest,
  onCreateRequest,
  onPublicVisibilityChange,
}) {
  const [filter, setFilter] = useState('');
  const [state, setState] = useState({ loading: true, error: '', requests: [] });
  const [busyId, setBusyId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const mountedRef = useRef(false);
  const loadOwnerRef = useRef({ controller: null, version: 0 });
  const mutationOwnerRef = useRef({ controller: null, version: 0 });

  const loadRequests = useCallback(async (status) => {
    const owner = loadOwnerRef.current;
    owner.controller?.abort();
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const path = status ? `/api/my/requests?status=${encodeURIComponent(status)}` : '/api/my/requests';
      const result = await api(path, { signal: controller.signal });
      if (!mountedRef.current || owner.version !== requestId) return;
      setState({ loading: false, error: '', requests: result.requests ?? [] });
    } catch (error) {
      if (!mountedRef.current || owner.version !== requestId || error.name === 'AbortError') return;
      setState({ loading: false, error: error.message || '暂时无法加载我的委托', requests: [] });
    } finally {
      if (owner.version === requestId) owner.controller = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadRequests(filter);
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
  }, [filter, loadRequests, refreshKey]);

  async function runAction(request, action) {
    const owner = mutationOwnerRef.current;
    if (owner.controller) return;
    const endpoint = { withdraw: 'withdraw', close: 'close', hide: 'hide' }[action];
    if (!endpoint) return;

    const controller = new AbortController();
    const mutationId = owner.version + 1;
    owner.version = mutationId;
    owner.controller = controller;
    setBusyId(request.id);
    setFeedback(null);
    try {
      const result = await api(`/api/my/requests/${request.id}/${endpoint}`, {
        method: 'POST',
        signal: controller.signal,
      });
      if (!mountedRef.current || owner.version !== mutationId) return;
      if (action === 'hide') {
        setState((current) => ({
          ...current,
          requests: current.requests.filter((item) => item.id !== request.id),
        }));
        setFeedback({ type: 'success', message: '委托已从我的列表中删除。' });
      } else {
        const nextRequest = { ...request, ...result.request };
        setState((current) => ({
          ...current,
          requests: filter && nextRequest.status !== filter
            ? current.requests.filter((item) => item.id !== request.id)
            : current.requests.map((item) => (
              item.id === request.id ? nextRequest : item
            )),
        }));
        setFeedback({
          type: 'success',
          message: action === 'withdraw' ? '委托已撤回。' : '委托已关闭。',
        });
      }
      onPublicVisibilityChange?.();
    } catch (error) {
      if (!mountedRef.current || owner.version !== mutationId || error.name === 'AbortError') return;
      setFeedback({ type: 'error', message: error.message || '暂时无法完成操作' });
    } finally {
      if (owner.version === mutationId) {
        owner.controller = null;
        if (mountedRef.current) setBusyId(null);
      }
    }
  }

  function renderAction(request, action) {
    const disabled = busyId !== null;
    if (action === 'withdraw') {
      return (
        <button key={action} type="button" className="button-danger" disabled={disabled} onClick={() => runAction(request, action)} aria-label={`撤回委托：${request.title}`}>
          <XCircle aria-hidden="true" size={18} />撤回
        </button>
      );
    }
    if (action === 'close') {
      return (
        <button key={action} type="button" className="button-danger" disabled={disabled} onClick={() => runAction(request, action)} aria-label={`关闭委托：${request.title}`}>
          <XCircle aria-hidden="true" size={18} />关闭
        </button>
      );
    }
    if (action === 'hide') {
      return (
        <button key={action} type="button" className="button-danger" disabled={disabled} onClick={() => runAction(request, action)} aria-label={`删除委托：${request.title}`}>
          <Trash2 aria-hidden="true" size={18} />删除
        </button>
      );
    }
    return null;
  }

  return (
    <section className="page my-requests-page" aria-labelledby="my-requests-title">
      <div className="my-requests-heading">
        <div>
          <h2 id="my-requests-title">我的委托</h2>
          <p className="page-intro">查看发布进度，处理仍在你手里的委托。</p>
        </div>
        <button type="button" className="button-primary" onClick={onCreateRequest}>
          <Send aria-hidden="true" size={18} />发布委托
        </button>
      </div>
      <div className="status-filter-bar" role="group" aria-label="我的委托状态筛选">
        {myRequestFilters.map((item) => (
          <button key={item.value} type="button" className={filter === item.value ? 'button-primary' : 'button-secondary'} onClick={() => setFilter(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
      {state.loading && <p role="status">正在加载我的委托...</p>}
      {!state.loading && state.error && <p role="alert">{state.error}</p>}
      {!state.loading && !state.error && state.requests.length === 0 && <p>这里还没有委托，去发布一份吧。</p>}
      {!state.loading && !state.error && state.requests.length > 0 && (
        <div className="my-request-list">
          {state.requests.map((request) => (
            <article className="my-request-card" key={request.id}>
              <div className="my-request-card-heading">
                <p className="request-type-pill">{requestTypeLabel(request.type)}</p>
                <StatusBadge type="request" status={request.status} />
              </div>
              <h3>{request.title}</h3>
              <p className="my-request-location">{locationLabel(request)}</p>
              <dl className="my-request-counts">
                <div><dt>收到心意</dt><dd>{request.reactionCount ?? 0}</dd></div>
                <div><dt>收藏</dt><dd>{request.favoriteCount ?? 0}</dd></div>
                <div><dt>联系申请 {request.applicationCount ?? 0}</dt></div>
              </dl>
              <div className="my-request-actions">
                <button type="button" className="button-secondary" onClick={() => onSelectRequest?.(request.id)} aria-label={`查看委托：${request.title}`}>
                  <Eye aria-hidden="true" size={18} />查看
                </button>
                {request.status === 'withdrawn' && (
                  <button type="button" className="button-secondary" onClick={() => onEditRequest?.(request.id)} aria-label={`编辑委托：${request.title}`}>
                    <FilePenLine aria-hidden="true" size={18} />编辑并重新提交
                  </button>
                )}
                {myRequestActions(request).map((action) => renderAction(request, action))}
              </div>
            </article>
          ))}
        </div>
      )}
      {feedback && <p role={feedback.type === 'success' ? 'status' : 'alert'} aria-live="polite">{feedback.message}</p>}
    </section>
  );
}
