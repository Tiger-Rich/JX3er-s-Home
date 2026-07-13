import React, { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';

import { api } from '../api/client.js';
import ReactionButton from '../components/ReactionButton.jsx';
import { requestTypes } from '../domain/constants.js';
import {
  buildRequestCardFacts,
  feedChannels,
  feedSorts,
} from '../domain/feedDiscovery.js';

function requestTypeLabel(value) {
  return requestTypes.find((type) => type.value === value)?.label ?? '其他';
}

export default function FeedPage({ onSelectRequest }) {
  const [filters, setFilters] = useState({ type: '', city: '', industry: '', remote: '' });
  const [state, setState] = useState({ loading: true, error: '', requests: [] });
  const [channel, setChannel] = useState('recommended');
  const [sort, setSort] = useState('recommended');
  const [mutationError, setMutationError] = useState('');
  const [pendingReactionId, setPendingReactionId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    params.set('channel', channel);
    params.set('sort', channel === 'latest' ? 'latest' : sort);
    const query = params.toString();
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(`/api/requests?${query}`, { signal: controller.signal })
      .then((result) => setState({ loading: false, error: '', requests: result.requests ?? [] }))
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setState({ loading: false, error: error.message || '暂时无法加载委托', requests: [] });
        }
      });
    return () => controller.abort();
  }, [channel, filters, sort]);

  function updateFilter(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  async function toggleReaction(requestId) {
    const target = state.requests.find((request) => request.id === requestId);
    if (!target || pendingReactionId) return;
    const nextReacted = !target.reactedByMe;
    const nextCount = Math.max(
      0,
      Number(target.reactionCount ?? 0) + (nextReacted ? 1 : -1),
    );
    setMutationError('');
    setPendingReactionId(requestId);
    setState((current) => ({
      ...current,
      requests: current.requests.map((request) =>
        request.id === requestId
          ? { ...request, reactedByMe: nextReacted, reactionCount: nextCount }
          : request,
      ),
    }));
    try {
      const result = await api(`/api/requests/${requestId}/reaction`, {
        method: nextReacted ? 'POST' : 'DELETE',
      });
      setState((current) => ({
        ...current,
        requests: current.requests.map((request) =>
          request.id === requestId
            ? {
                ...request,
                reactedByMe: result.reactedByMe,
                reactionCount: result.reactionCount,
              }
            : request,
        ),
      }));
    } catch (error) {
      setMutationError(error.message || '心形状态未能更新');
      setState((current) => ({
        ...current,
        requests: current.requests.map((request) =>
          request.id === requestId ? target : request,
        ),
      }));
    } finally {
      setPendingReactionId(null);
    }
  }

  return (
    <section className="page feed-page" aria-labelledby="feed-title">
      <h2 id="feed-title">万事广场</h2>
      <p className="page-intro">看清来路与需求，再决定要不要开口接话。</p>
      <div className="feed-channel-bar" role="group" aria-label="万事广场频道">
        {feedChannels.map((item) => (
          <button
            key={item.value}
            type="button"
            className={item.value === channel ? 'button-primary' : 'button-secondary'}
            onClick={() => setChannel(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="feed-sort-bar" role="group" aria-label="委托排序">
        {feedSorts.map((item) => (
          <button
            key={item.value}
            type="button"
            className={item.value === sort ? 'button-primary' : 'button-secondary'}
            onClick={() => setSort(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="filter-bar" aria-label="委托筛选">
        <label>
          类型
          <select name="type" value={filters.type} onChange={updateFilter}>
            <option value="">全部类型</option>
            {requestTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>
        <label>
          城市
          <input name="city" value={filters.city} onChange={updateFilter} />
        </label>
        <label>
          行业
          <input name="industry" value={filters.industry} onChange={updateFilter} />
        </label>
        <label>
          远程方式
          <select name="remote" value={filters.remote} onChange={updateFilter}>
            <option value="">不限</option>
            <option value="true">可远程</option>
            <option value="false">仅线下</option>
          </select>
        </label>
      </div>

      {mutationError && <p role="alert">{mutationError}</p>}
      {state.loading && <p role="status">正在打听广场消息…</p>}
      {!state.loading && state.error && <p role="alert">{state.error}</p>}
      {!state.loading && !state.error && state.requests.length === 0 && <p>暂时没有符合条件的委托。</p>}
      {!state.loading && !state.error && state.requests.length > 0 && (
        <div className="request-list">
          {state.requests.map((request) => (
            <article className="request-card" key={request.id}>
              {request.images?.[0] && (
                <img
                  className="request-card-cover"
                  src={request.images[0].url}
                  alt={`${request.title} 封面图`}
                />
              )}
              <p className="request-type-pill">{requestTypeLabel(request.type)}</p>
              <h3>{request.title}</h3>
              <dl className="request-card-facts">
                {buildRequestCardFacts(request).map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="request-card-owner">
                {request.owner?.nickname || '未署名侠士'}
                {request.owner?.server ? ` · ${request.owner.server}` : ''}
                {request.owner?.verificationStatus === 'approved' ? ' · 已认证' : ''}
              </p>
              <div className="request-card-actions">
                <ReactionButton
                  count={request.reactionCount}
                  disabled={pendingReactionId === request.id}
                  reacted={request.reactedByMe}
                  requestTitle={request.title}
                  onToggle={() => toggleReaction(request.id)}
                />
                <button
                  type="button"
                  onClick={() => onSelectRequest?.(request.id)}
                  className="button-secondary"
                >
                  <Eye aria-hidden="true" size={18} />查看委托
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
