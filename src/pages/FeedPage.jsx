import React, { useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';

import { api } from '../api/client.js';
import { requestTypes } from '../domain/constants.js';

const priorityTypes = new Set(['job_referral', 'industry_consulting']);
const industrySummaryTypes = new Set(['job_referral', 'industry_consulting']);

function requestTypeLabel(value) {
  return requestTypes.find((type) => type.value === value)?.label ?? '其他';
}

function sortedRequests(requests) {
  return [...requests].sort((left, right) => {
    const priorityDifference = Number(!priorityTypes.has(left.type)) - Number(!priorityTypes.has(right.type));
    if (priorityDifference) return priorityDifference;
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
}

export default function FeedPage({ onSelectRequest }) {
  const [filters, setFilters] = useState({ type: '', city: '', industry: '', remote: '' });
  const [state, setState] = useState({ loading: true, error: '', requests: [] });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    setState((current) => ({ ...current, loading: true, error: '' }));
    api(`/api/requests${query ? `?${query}` : ''}`, { signal: controller.signal })
      .then((result) => setState({ loading: false, error: '', requests: result.requests ?? [] }))
      .catch((error) => {
        if (error.name !== 'AbortError') {
          setState({ loading: false, error: error.message || '暂时无法加载委托', requests: [] });
        }
      });
    return () => controller.abort();
  }, [filters]);

  const requests = useMemo(() => sortedRequests(state.requests), [state.requests]);

  function updateFilter(event) {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  return (
    <section className="page feed-page" aria-labelledby="feed-title">
      <h2 id="feed-title">万事广场</h2>
      <p className="page-intro">看清来路与需求，再决定要不要开口接话。</p>
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

      {state.loading && <p role="status">正在打听广场消息…</p>}
      {!state.loading && state.error && <p role="alert">{state.error}</p>}
      {!state.loading && !state.error && requests.length === 0 && <p>暂时没有符合条件的委托。</p>}
      {!state.loading && !state.error && requests.length > 0 && (
        <div className="request-list">
          {requests.map((request) => (
            <article className="request-card" key={request.id}>
              {request.images?.[0] && (
                <img
                  className="request-card-cover"
                  src={request.images[0].url}
                  alt={`${request.title} 封面图`}
                />
              )}
              <p>{requestTypeLabel(request.type)}</p>
              <h3>{request.title}</h3>
              {request.description && <p>{request.description}</p>}
              <p>{request.remote ? '可远程' : request.city || '城市未注明'}{request.remote && request.city ? ` · ${request.city}` : ''}</p>
              {request.industry && industrySummaryTypes.has(request.type) && <p>行业：{request.industry}</p>}
              <p>有效期至：{new Date(request.expiresAt).toLocaleString('zh-CN')}</p>
              <p>
                发布者：{request.owner?.nickname || '未署名'}
                {request.owner?.server ? ` · ${request.owner.server}` : ''}
                {request.owner?.sect ? ` · ${request.owner.sect}` : ''}
                {request.owner?.startedYear ? ` · ${request.owner.startedYear}年入坑` : ''}
                {request.owner?.city ? ` · ${request.owner.city}` : ''}
                {request.owner?.industry ? ` · ${request.owner.industry}` : ''}
                {request.owner?.verificationStatus === 'approved' ? ' · 已确认身份' : ''}
              </p>
              <button type="button" onClick={() => onSelectRequest?.(request.id)} className="button-secondary">
                <Eye aria-hidden="true" size={18} />查看委托：{request.title}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
