import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Search, ShieldX, X } from 'lucide-react';

import { api } from '../../api/client.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import { requestTypes } from '../../domain/constants.js';

const emptyFilters = { status: '', type: '', city: '', industry: '', expired: '' };

function requestQuery(filters) {
  const params = new URLSearchParams();
  for (const key of ['status', 'type', 'city', 'industry', 'expired']) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `/api/admin/requests${query ? `?${query}` : ''}`;
}

export default function AdminRequests({ onSummaryChange }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reasons, setReasons] = useState({});
  const [mutating, setMutating] = useState(false);
  const mountedRef = useRef(false);
  const activeFiltersRef = useRef(emptyFilters);
  const loadOwnerRef = useRef({ controller: null, version: 0 });
  const mutationOwnerRef = useRef({ controller: null, version: 0 });

  const refreshPendingSummary = useCallback(async () => {
    try {
      const result = await api('/api/admin/requests?status=pending');
      onSummaryChange?.((result.requests ?? []).length);
      return true;
    } catch {
      return false;
    }
  }, [onSummaryChange]);

  const load = useCallback(async (nextFilters = activeFiltersRef.current) => {
    const owner = loadOwnerRef.current;
    owner.controller?.abort();
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setLoading(true);
    setError('');
    try {
      const result = await api(requestQuery(nextFilters), { signal: controller.signal });
      if (!mountedRef.current || owner.version !== requestId) return false;
      const requests = result.requests ?? [];
      setItems(requests);
      if (!Object.values(nextFilters).some(Boolean)) {
        onSummaryChange?.(requests.filter((item) => item.status === 'pending').length);
      }
      return true;
    } catch (loadError) {
      if (!mountedRef.current || owner.version !== requestId || loadError.name === 'AbortError') return false;
      setError(loadError.message || '暂时无法加载委托审核');
      return false;
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [onSummaryChange]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
      for (const owner of [loadOwnerRef.current, mutationOwnerRef.current]) {
        owner.version += 1;
        owner.controller?.abort();
        owner.controller = null;
      }
    };
  }, [load]);

  function updateFilter(event) {
    setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function submitFilters(event) {
    event.preventDefault();
    activeFiltersRef.current = filters;
    setFeedback('');
    load(filters);
  }

  async function transition(item, action) {
    const owner = mutationOwnerRef.current;
    if (owner.controller) return;
    const key = `${item.id}:${action}`;
    const reason = reasons[key]?.trim() ?? '';
    if (action !== 'approve' && !reason) return;
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setMutating(true);
    setFeedback('');
    setError('');
    try {
      await api(`/api/admin/requests/${item.id}/${action}`, {
        method: 'POST',
        signal: controller.signal,
        ...(action === 'approve' ? {} : { body: { reason } }),
      });
      if (!mountedRef.current || owner.version !== requestId) return;
      const refreshed = await load(activeFiltersRef.current);
      if (!mountedRef.current || owner.version !== requestId || !refreshed) return;
      await refreshPendingSummary();
      if (!mountedRef.current || owner.version !== requestId) return;
      setFeedback('委托审核已更新');
      setReasons((current) => ({ ...current, [key]: '' }));
    } catch (mutationError) {
      if (!mountedRef.current || owner.version !== requestId || mutationError.name === 'AbortError') return;
      setError(mutationError.message || '暂时无法更新委托状态');
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setMutating(false);
      }
    }
  }

  function reasonControl(item, action, label) {
    const key = `${item.id}:${action}`;
    const reason = reasons[key] ?? '';
    return (
      <>
        <label>{`委托 ${item.id} ${label}理由`}<textarea value={reason} onChange={(event) => setReasons((current) => ({ ...current, [key]: event.target.value }))} /></label>
        <button type="button" disabled={mutating || !reason.trim()} onClick={() => transition(item, action)}>
          {action === 'reject' ? <X aria-hidden="true" size={18} /> : <ShieldX aria-hidden="true" size={18} />}{action === 'reject' ? '拒绝委托' : '下架委托'}
        </button>
      </>
    );
  }

  return (
    <section className="admin-page" aria-labelledby="admin-requests-title">
      <div className="admin-page-heading">
        <h2 id="admin-requests-title">委托审核</h2>
        <form onSubmit={submitFilters} className="admin-filters">
          <label>委托状态<select name="status" value={filters.status} onChange={updateFilter}><option value="">全部</option><option value="draft">草稿</option><option value="pending">待审核</option><option value="approved">已发布</option><option value="rejected">未通过</option><option value="taken_down">已下架</option><option value="expired">已过期</option></select></label>
          <label>委托类型<select name="type" value={filters.type} onChange={updateFilter}><option value="">全部</option>{requestTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          <label>委托城市<input name="city" value={filters.city} onChange={updateFilter} /></label>
          <label>委托行业<input name="industry" value={filters.industry} onChange={updateFilter} /></label>
          <label>是否过期<select name="expired" value={filters.expired} onChange={updateFilter}><option value="">全部</option><option value="false">未过期</option><option value="true">已过期</option></select></label>
          <button type="submit"><Search aria-hidden="true" size={18} />筛选委托</button>
        </form>
      </div>
      {loading && <p role="status">正在加载委托…</p>}
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {!loading && !error && (
        <table>
          <caption className="sr-only">委托审核列表</caption>
          <thead><tr><th>委托</th><th>范围与回报</th><th>发布者公开身份</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => {
              const owner = item.owner ?? {};
              const typeLabel = requestTypes.find((type) => type.value === item.type)?.label ?? item.type;
              return (
                <tr key={item.id}>
                  <td>{item.title}<br />类型：{typeLabel}<br />{item.description}</td>
                  <td>城市：{item.city || '—'}<br />远程：{item.remote ? '是' : '否'}<br />行业：{item.industry || '—'}<br />预算或回报：{item.budgetOrReward || '—'}<br />有效期：{item.expiresAt || '—'}</td>
                  <td>{owner.nickname || '—'}<br />区服：{owner.server || '—'}<br />游戏昵称：{owner.gameNickname || '—'}<br />门派：{owner.sect || '—'}<br />入坑年份：{owner.startedYear || '—'}<br />城市：{owner.city || '—'}<br />行业：{owner.industry || '—'}<br />职业：{owner.occupation || '—'}<br /><StatusBadge type="verification" status={owner.verificationStatus} /></td>
                  <td><StatusBadge type="request" status={item.status} />{item.rejectReason && <><br />拒绝理由：{item.rejectReason}</>}{item.takedownReason && <><br />下架理由：{item.takedownReason}</>}</td>
                  <td><div className="admin-actions">
                    {item.status === 'pending' && <><button type="button" disabled={mutating} onClick={() => transition(item, 'approve')}><Check aria-hidden="true" size={18} />通过委托</button>{reasonControl(item, 'reject', '拒绝')}</>}
                    {item.status === 'approved' && reasonControl(item, 'takedown', '下架')}
                    {!['pending', 'approved'].includes(item.status) && '无需操作'}
                  </div></td>
                </tr>
              );
            })}
            {!items.length && <tr><td colSpan="5">没有符合条件的委托</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}
