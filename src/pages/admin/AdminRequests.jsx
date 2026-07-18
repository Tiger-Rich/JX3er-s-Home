import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Search, ShieldX, Trash2, X } from 'lucide-react';

import { api } from '../../api/client.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import { requestTypes } from '../../domain/constants.js';
import { visibleDetailRows } from '../../domain/requestDetails.js';

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
  const [deleteConfirmations, setDeleteConfirmations] = useState({});
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [batchDecision, setBatchDecision] = useState(null);
  const [batchReason, setBatchReason] = useState('');
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
      setSelectedIds(new Set());
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
    setSelectedIds(new Set());
    setBatchDecision(null);
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

  async function hardDelete(id) {
    const owner = mutationOwnerRef.current;
    if (owner.controller) return;
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setMutating(true);
    setFeedback('');
    setError('');
    try {
      await api(`/api/admin/requests/${id}`, {
        method: 'DELETE',
        signal: controller.signal,
      });
      if (!mountedRef.current || owner.version !== requestId) return;
      const refreshed = await load(activeFiltersRef.current);
      if (!mountedRef.current || owner.version !== requestId || !refreshed) return;
      await refreshPendingSummary();
      if (!mountedRef.current || owner.version !== requestId) return;
      setFeedback('委托已彻底删除');
      setDeleteConfirmations((current) => ({ ...current, [id]: '' }));
    } catch (mutationError) {
      if (!mountedRef.current || owner.version !== requestId || mutationError.name === 'AbortError') return;
      setError(mutationError.message || '暂时无法彻底删除委托');
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setMutating(false);
      }
    }
  }

  const selectableItems = items.filter((item) => item.status === 'pending');
  const selectedPendingIds = selectableItems
    .map((item) => item.id)
    .filter((id) => selectedIds.has(id));
  const allSelectableSelected = selectableItems.length > 0 && selectedPendingIds.length === selectableItems.length;

  function toggleSelected(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllSelectable() {
    setSelectedIds(allSelectableSelected ? new Set() : new Set(selectableItems.map((item) => item.id)));
  }

  function openBatchDecision(decision) {
    if (!selectedPendingIds.length) return;
    setError('');
    setFeedback('');
    setBatchDecision(decision);
  }

  async function confirmBatchDecision() {
    if (!batchDecision || mutationOwnerRef.current.controller) return;
    const requestIds = selectedPendingIds;
    const reason = batchReason.trim();
    if (!requestIds.length || (batchDecision === 'reject' && !reason)) return;
    const owner = mutationOwnerRef.current;
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setMutating(true);
    setError('');
    setFeedback('');
    try {
      const result = await api('/api/admin/requests/batch-review', {
        method: 'POST',
        signal: controller.signal,
        body: {
          requestIds,
          decision: batchDecision,
          ...(batchDecision === 'reject' ? { reason } : {}),
        },
      });
      if (!mountedRef.current || owner.version !== requestId) return;
      const refreshed = await load(activeFiltersRef.current);
      if (!mountedRef.current || owner.version !== requestId || !refreshed) return;
      await refreshPendingSummary();
      if (!mountedRef.current || owner.version !== requestId) return;
      const skippedCount = result.skipped?.length ?? 0;
      const failedCount = result.failed?.length ?? 0;
      setBatchDecision(null);
      setBatchReason('');
      setFeedback(`批量审核完成：通过 ${result.approvedCount ?? 0} 条，拒绝 ${result.rejectedCount ?? 0} 条，跳过 ${skippedCount} 条。`);
      if (failedCount) setError(`有 ${failedCount} 条委托未能完成审核，请刷新后重试。`);
    } catch (mutationError) {
      if (!mountedRef.current || owner.version !== requestId || mutationError.name === 'AbortError') return;
      setError(mutationError.message || '暂时无法完成批量审核。');
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
        <button type="button" disabled={mutating || !reason.trim()} className="button-danger" onClick={() => transition(item, action)}>
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
          <label>委托状态<select name="status" value={filters.status} onChange={updateFilter}><option value="">全部</option><option value="draft">草稿</option><option value="pending">待审核</option><option value="approved">已发布</option><option value="rejected">未通过</option><option value="taken_down">已下架</option><option value="withdrawn">已撤回</option><option value="closed">已关闭</option><option value="expired">已过期</option></select></label>
          <label>委托类型<select name="type" value={filters.type} onChange={updateFilter}><option value="">全部</option>{requestTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
          <label>委托城市<input name="city" value={filters.city} onChange={updateFilter} /></label>
          <label>委托行业<input name="industry" value={filters.industry} onChange={updateFilter} /></label>
          <label>是否过期<select name="expired" value={filters.expired} onChange={updateFilter}><option value="">全部</option><option value="false">未过期</option><option value="true">已过期</option></select></label>
          <button type="submit" className="button-primary"><Search aria-hidden="true" size={18} />筛选委托</button>
        </form>
      </div>
      {loading && <p role="status">正在加载委托…</p>}
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {selectedPendingIds.length > 0 && (
        <section className="admin-batch-toolbar" aria-label="批量委托审核">
          <p>已选择 {selectedPendingIds.length} 条待审委托</p>
          <div>
            <button type="button" className="button-primary" disabled={mutating} onClick={() => openBatchDecision('approve')}><Check aria-hidden="true" size={18} />批量通过 {selectedPendingIds.length} 条</button>
            <button type="button" className="button-danger" disabled={mutating} onClick={() => openBatchDecision('reject')}><X aria-hidden="true" size={18} />批量拒绝 {selectedPendingIds.length} 条</button>
          </div>
        </section>
      )}
      {!loading && !error && (
        <div className="table-scroll">
          <table className="admin-table admin-table-requests">
          <caption className="sr-only">委托审核列表</caption>
          <thead><tr><th className="admin-selection-cell"><input type="checkbox" aria-label="全选当前筛选结果" checked={allSelectableSelected} disabled={!selectableItems.length || mutating} onChange={toggleAllSelectable} /></th><th>委托</th><th>范围与回报</th><th>发布者公开身份</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => {
              const owner = item.owner ?? {};
              const typeLabel = requestTypes.find((type) => type.value === item.type)?.label ?? item.type;
              const detailRows = visibleDetailRows(item.type, item.details);
              return (
                <tr key={item.id}>
                  <td className="admin-selection-cell">{item.status === 'pending' && <input type="checkbox" aria-label={`选择委托 ${item.id}`} checked={selectedIds.has(item.id)} disabled={mutating} onChange={() => toggleSelected(item.id)} />}</td>
                  <td>
                    {item.title}<br />类型：{typeLabel}<br />{item.description}
                    {detailRows.length > 0 && (
                      <div className="admin-detail-list">
                        {detailRows.map((row) => (
                          <p key={row.label}>{row.label}：{row.value}</p>
                        ))}
                      </div>
                    )}
                    {item.type === 'trade' && item.images?.length > 0 && (
                      <div className="admin-request-image-grid">
                        {item.images.map((image, index) => (
                          <img
                            key={image.id ?? image.url}
                            src={image.url}
                            alt={`委托 ${item.id} 图片 ${index + 1}`}
                          />
                        ))}
                      </div>
                    )}
                  </td>
                  <td>城市：{item.city || '—'}<br />远程：{item.remote ? '是' : '否'}<br />行业：{item.industry || '—'}<br />预算或回报：{item.budgetOrReward || '—'}<br />有效期：{item.expiresAt || '—'}</td>
                  <td>{owner.nickname || '—'}<br />区服：{owner.server || '—'}<br />游戏昵称：{owner.gameNickname || '—'}<br />门派：{owner.sect || '—'}<br />入坑年份：{owner.startedYear || '—'}<br />城市：{owner.city || '—'}<br />行业：{owner.industry || '—'}<br />职业：{owner.occupation || '—'}<br /><StatusBadge type="verification" status={owner.verificationStatus} /></td>
                  <td><StatusBadge type="request" status={item.status} />{item.rejectReason && <><br />拒绝理由：{item.rejectReason}</>}{item.takedownReason && <><br />下架理由：{item.takedownReason}</>}</td>
                  <td><div className="admin-actions">
                    {item.status === 'pending' && <><button type="button" disabled={mutating} className="button-primary" onClick={() => transition(item, 'approve')}><Check aria-hidden="true" size={18} />通过委托</button>{reasonControl(item, 'reject', '拒绝')}</>}
                    {item.status === 'approved' && reasonControl(item, 'takedown', '下架')}
                    {!['pending', 'approved'].includes(item.status) && '无需审核操作'}
                    <label>彻底删除确认<input aria-label={`委托 ${item.id} 彻底删除确认`} value={deleteConfirmations[item.id] ?? ''} onChange={(event) => setDeleteConfirmations((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                    <button type="button" disabled={mutating || deleteConfirmations[item.id] !== '彻底删除'} className="button-danger" onClick={() => hardDelete(item.id)}><Trash2 aria-hidden="true" size={18} />彻底删除委托</button>
                  </div></td>
                </tr>
              );
            })}
            {!items.length && <tr><td colSpan="6">没有符合条件的委托</td></tr>}
          </tbody>
          </table>
        </div>
      )}
      {batchDecision && (
        <div className="admin-confirmation" role="dialog" aria-modal="true" aria-label="确认批量审核">
          <div>
            <h3>{batchDecision === 'approve' ? '确认批量通过委托？' : '确认批量拒绝委托？'}</h3>
            <p>本次将处理 {selectedPendingIds.length} 条当前待审委托。</p>
            {batchDecision === 'reject' && <label>批量拒绝理由<textarea aria-label="批量拒绝理由" value={batchReason} onChange={(event) => setBatchReason(event.target.value)} /></label>}
          </div>
          <div className="admin-confirmation-actions">
            <button type="button" className="button-secondary" disabled={mutating} onClick={() => setBatchDecision(null)}>取消</button>
            <button type="button" className={batchDecision === 'approve' ? 'button-primary' : 'button-danger'} disabled={mutating || (batchDecision === 'reject' && !batchReason.trim())} onClick={confirmBatchDecision}>
              {batchDecision === 'approve' ? '确认批量通过' : '确认批量拒绝'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
