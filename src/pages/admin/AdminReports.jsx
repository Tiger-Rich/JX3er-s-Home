import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ShieldAlert, ShieldX } from 'lucide-react';

import { api } from '../../api/client.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import { requestStatusLabels, requestTypes } from '../../domain/constants.js';
import { visibleDetailRows } from '../../domain/requestDetails.js';

const reportStatusOptions = [
  { value: 'pending', label: '待处理' },
  { value: 'resolved', label: '已处置' },
  { value: 'dismissed', label: '无需处置' },
];

function reportQuery(status) {
  return `/api/admin/reports?status=${encodeURIComponent(status)}`;
}

export default function AdminReports({ onSummaryChange }) {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState([]);
  const [notes, setNotes] = useState({});
  const [pendingDecision, setPendingDecision] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const mountedRef = useRef(false);
  const loadOwnerRef = useRef({ controller: null, version: 0 });
  const mutationOwnerRef = useRef({ controller: null, version: 0 });

  const refreshPendingSummary = useCallback(async () => {
    try {
      const result = await api(reportQuery('pending'));
      onSummaryChange?.((result.reports ?? []).length);
      return true;
    } catch {
      return false;
    }
  }, [onSummaryChange]);

  const load = useCallback(async (nextStatus = status) => {
    const owner = loadOwnerRef.current;
    owner.controller?.abort();
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setLoading(true);
    setError('');
    try {
      const result = await api(reportQuery(nextStatus), { signal: controller.signal });
      if (!mountedRef.current || owner.version !== requestId) return false;
      const reports = result.reports ?? [];
      setItems(reports);
      if (nextStatus === 'pending') onSummaryChange?.(reports.length);
      return true;
    } catch (loadError) {
      if (!mountedRef.current || owner.version !== requestId || loadError.name === 'AbortError') return false;
      setError(loadError.message || '暂时无法加载举报处理列表。');
      return false;
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [onSummaryChange, status]);

  useEffect(() => {
    mountedRef.current = true;
    load(status);
    return () => {
      mountedRef.current = false;
      for (const owner of [loadOwnerRef.current, mutationOwnerRef.current]) {
        owner.version += 1;
        owner.controller?.abort();
        owner.controller = null;
      }
    };
  }, [load, status]);

  function changeStatus(event) {
    setFeedback('');
    setPendingDecision(null);
    setStatus(event.target.value);
  }

  async function confirmDecision() {
    if (!pendingDecision || mutationOwnerRef.current.controller) return;
    const { item, action, resultNote } = pendingDecision;
    const owner = mutationOwnerRef.current;
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setMutating(true);
    setError('');
    setFeedback('');
    try {
      await api(`/api/admin/reports/${item.id}/${action}`, {
        method: 'POST',
        body: { resultNote },
        signal: controller.signal,
      });
      if (!mountedRef.current || owner.version !== requestId) return;
      const refreshed = await load(status);
      if (!mountedRef.current || owner.version !== requestId || !refreshed) return;
      await refreshPendingSummary();
      if (!mountedRef.current || owner.version !== requestId) return;
      setNotes((current) => ({ ...current, [item.id]: '' }));
      setPendingDecision(null);
      setFeedback('举报处理已更新。');
    } catch (mutationError) {
      if (!mountedRef.current || owner.version !== requestId || mutationError.name === 'AbortError') return;
      setError(mutationError.message || '暂时无法更新举报处理结果。');
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setMutating(false);
      }
    }
  }

  return (
    <section className="admin-page" aria-labelledby="admin-reports-title">
      <div className="admin-page-heading">
        <div>
          <h2 id="admin-reports-title">举报处理</h2>
          <p className="section-note">核查委托内容后再处理。下架会立即从万事广场移除该委托。</p>
        </div>
        <label className="admin-report-status-filter">处理状态
          <select value={status} onChange={changeStatus} aria-label="举报处理状态">
            {reportStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      {loading && <p role="status">正在加载举报处理列表…</p>}
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}

      {!loading && !error && (
        <div className="table-scroll">
          <table className="admin-table admin-table-reports" aria-label="举报处理列表">
            <thead><tr><th>被举报委托</th><th>举报信息</th><th>当前状态</th><th>处理</th></tr></thead>
            <tbody>
              {items.map((item) => {
                const request = item.request ?? {};
                const typeLabel = requestTypes.find((type) => type.value === request.type)?.label ?? request.type;
                const detailRows = visibleDetailRows(request.type, request.details);
                const note = notes[item.id] ?? '';
                const isPending = item.status === 'pending';
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{request.title || '委托已不可用'}</strong>
                      <p>类型：{typeLabel || '—'}</p>
                      <p>{request.description || '—'}</p>
                      <p>发布者：{request.owner?.nickname || '—'} · {request.owner?.server || '—'} · {request.owner?.gameNickname || '—'}</p>
                      {detailRows.length > 0 && <div className="admin-detail-list">{detailRows.map((row) => <p key={row.label}>{row.label}：{row.value}</p>)}</div>}
                      {request.images?.length > 0 && <div className="admin-request-image-grid">{request.images.map((image, index) => <img key={image.id ?? image.url} src={image.url} alt={`委托 ${request.id} 图片 ${index + 1}`} />)}</div>}
                    </td>
                    <td>
                      <p>举报人：{item.reporter?.nickname || '—'}</p>
                      <p>举报原因：{item.reason}</p>
                      <p>提交时间：{item.createdAt}</p>
                    </td>
                    <td>
                      <StatusBadge type="report" status={item.status} />
                      <p>委托状态：{requestStatusLabels[request.status] || request.status || '—'}</p>
                      {item.handler?.nickname && <p>处理人：{item.handler.nickname}</p>}
                      {item.resultNote && <p>处理说明：{item.resultNote}</p>}
                    </td>
                    <td>
                      {isPending ? (
                        <div className="admin-actions">
                          <label>处理说明
                            <textarea aria-label={`举报 ${item.id} 处理说明`} value={note} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} />
                          </label>
                          <button type="button" className="button-secondary" disabled={mutating || !note.trim()} onClick={() => setPendingDecision({ item, action: 'dismiss', resultNote: note.trim() })}>
                            <Check aria-hidden="true" size={18} />无需处置
                          </button>
                          <button type="button" className="button-danger" disabled={mutating || !note.trim()} onClick={() => setPendingDecision({ item, action: 'takedown', resultNote: note.trim() })}>
                            <ShieldX aria-hidden="true" size={18} />下架委托并完成处理
                          </button>
                        </div>
                      ) : '已完成处理'}
                    </td>
                  </tr>
                );
              })}
              {!items.length && <tr><td colSpan="4">当前没有符合条件的举报。</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {pendingDecision && (
        <div className="admin-confirmation" role="dialog" aria-modal="true" aria-label="确认处理举报">
          <div>
            <ShieldAlert aria-hidden="true" size={22} />
            <h3>{pendingDecision.action === 'takedown' ? '确认下架这条委托？' : '确认无需处置？'}</h3>
            <p>{pendingDecision.action === 'takedown' ? '下架后，委托将不再显示在万事广场。' : '该举报会标记为无需处置。'}</p>
            <p>处理说明：{pendingDecision.resultNote}</p>
          </div>
          <div className="admin-confirmation-actions">
            <button type="button" className="button-secondary" disabled={mutating} onClick={() => setPendingDecision(null)}>取消</button>
            <button type="button" className={pendingDecision.action === 'takedown' ? 'button-danger' : 'button-primary'} disabled={mutating} onClick={confirmDecision}>
              {pendingDecision.action === 'takedown' ? '确认下架并处理' : '确认无需处置'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
