import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';

import { api } from '../../api/client.js';
import StatusBadge from '../../components/StatusBadge.jsx';

export default function AdminVerifications({ onSummaryChange }) {
  const [status, setStatus] = useState('pending');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reasons, setReasons] = useState({});
  const [mutating, setMutating] = useState(false);
  const mountedRef = useRef(false);
  const activeStatusRef = useRef('pending');
  const loadOwnerRef = useRef({ controller: null, version: 0 });
  const mutationOwnerRef = useRef({ controller: null, version: 0 });

  const load = useCallback(async (nextStatus = activeStatusRef.current) => {
    const owner = loadOwnerRef.current;
    owner.controller?.abort();
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setLoading(true);
    setError('');
    try {
      const result = await api(`/api/admin/verifications?status=${encodeURIComponent(nextStatus)}`, {
        signal: controller.signal,
      });
      if (!mountedRef.current || owner.version !== requestId) return false;
      const verifications = result.verifications ?? [];
      setItems(verifications);
      if (nextStatus === 'pending') onSummaryChange?.(verifications.length);
      return true;
    } catch (loadError) {
      if (!mountedRef.current || owner.version !== requestId || loadError.name === 'AbortError') return false;
      setError(loadError.message || '暂时无法加载认证审核');
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

  async function review(item, action) {
    const owner = mutationOwnerRef.current;
    if (owner.controller) return;
    const reason = reasons[item.userId]?.trim() ?? '';
    if (action === 'reject' && !reason) return;
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setMutating(true);
    setFeedback('');
    setError('');
    try {
      await api(`/api/admin/verifications/${item.userId}/${action}`, {
        method: 'POST',
        signal: controller.signal,
        ...(action === 'reject' ? { body: { reason } } : {}),
      });
      if (!mountedRef.current || owner.version !== requestId) return;
      const refreshed = await load();
      if (!mountedRef.current || owner.version !== requestId || !refreshed) return;
      setFeedback('认证审核已更新');
      setReasons((current) => ({ ...current, [item.userId]: '' }));
    } catch (mutationError) {
      if (!mountedRef.current || owner.version !== requestId || mutationError.name === 'AbortError') return;
      setError(mutationError.message || '暂时无法更新认证状态');
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setMutating(false);
      }
    }
  }

  function submitFilter(event) {
    event.preventDefault();
    activeStatusRef.current = status;
    setFeedback('');
    load(status);
  }

  return (
    <section className="admin-page" aria-labelledby="admin-verifications-title">
      <div className="admin-page-heading">
        <h2 id="admin-verifications-title">认证审核</h2>
        <form onSubmit={submitFilter} className="admin-filters">
          <label>认证状态
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="pending">待审核</option>
              <option value="approved">已通过</option>
              <option value="rejected">已拒绝</option>
            </select>
          </label>
          <button type="submit" className="button-primary"><Search aria-hidden="true" size={18} />筛选认证</button>
        </form>
      </div>
      {loading && <p role="status">正在加载认证资料…</p>}
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {(!loading || items.length > 0) && !error && (
        <div className="table-scroll">
          <table className="admin-table admin-table-verifications">
          <caption className="sr-only">认证审核列表</caption>
          <thead><tr><th>身份</th><th>游戏资料</th><th>职业资料</th><th>认证材料</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((item) => {
              const user = item.user ?? {};
              const profile = item.profile ?? {};
              const reason = reasons[item.userId] ?? '';
              return (
                <tr key={item.id ?? item.userId}>
                  <td>{user.nickname || '—'}<br />账号：{user.account || '—'}<br />城市：{user.city || '—'}</td>
                  <td>区服：{profile.server || '—'}<br />游戏昵称：{profile.gameNickname || '—'}<br />门派：{profile.sect || '—'}<br />入坑年份：{profile.startedYear || '—'}</td>
                  <td>行业：{profile.industry || '—'}<br />职业：{profile.occupation || '—'}</td>
                  <td>{item.supportMaterial || '—'}</td>
                  <td><StatusBadge type="verification" status={item.status} />{item.rejectReason && <><br />拒绝理由：{item.rejectReason}</>}</td>
                  <td>
                    {item.status === 'pending' ? (
                      <div className="admin-actions">
                        <button type="button" disabled={mutating} className="button-primary" onClick={() => review(item, 'approve')}><Check aria-hidden="true" size={18} />通过认证</button>
                        <label>认证拒绝理由<textarea value={reason} onChange={(event) => setReasons((current) => ({ ...current, [item.userId]: event.target.value }))} /></label>
                        <button type="button" disabled={mutating || !reason.trim()} className="button-danger" onClick={() => review(item, 'reject')}><X aria-hidden="true" size={18} />拒绝认证</button>
                      </div>
                    ) : '无需操作'}
                  </td>
                </tr>
              );
            })}
            {!items.length && <tr><td colSpan="6">没有符合条件的认证资料</td></tr>}
          </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
