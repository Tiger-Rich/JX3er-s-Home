import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, UserX } from 'lucide-react';

import { api } from '../../api/client.js';
import StatusBadge from '../../components/StatusBadge.jsx';

const emptyFilters = { nickname: '', server: '', city: '', industry: '', verificationStatus: '', status: '' };

function usersQuery(filters) {
  const params = new URLSearchParams();
  for (const key of ['nickname', 'server', 'city', 'industry', 'verificationStatus', 'status']) {
    const value = filters[key].trim();
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `/api/admin/users${query ? `?${query}` : ''}`;
}

export default function AdminUsers({ currentUser, onSummaryChange }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [mutating, setMutating] = useState(false);
  const mountedRef = useRef(false);
  const activeFiltersRef = useRef(emptyFilters);
  const loadOwnerRef = useRef({ controller: null, version: 0 });
  const mutationOwnerRef = useRef({ controller: null, version: 0 });

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
      const result = await api(usersQuery(nextFilters), { signal: controller.signal });
      if (!mountedRef.current || owner.version !== requestId) return false;
      const users = result.users ?? [];
      setItems(users);
      if (!Object.values(nextFilters).some(Boolean)) onSummaryChange?.(users.length);
      return true;
    } catch (loadError) {
      if (!mountedRef.current || owner.version !== requestId || loadError.name === 'AbortError') return false;
      setError(loadError.message || '暂时无法加载用户列表');
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

  async function disable(user) {
    const owner = mutationOwnerRef.current;
    if (owner.controller || user.id === currentUser?.id || user.role === 'admin' || user.status !== 'active') return;
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setMutating(true);
    setFeedback('');
    setError('');
    try {
      await api(`/api/admin/users/${user.id}/disable`, { method: 'POST', signal: controller.signal });
      if (!mountedRef.current || owner.version !== requestId) return;
      const refreshed = await load(activeFiltersRef.current);
      if (!mountedRef.current || owner.version !== requestId || !refreshed) return;
      setFeedback('用户已禁用');
    } catch (mutationError) {
      if (!mountedRef.current || owner.version !== requestId || mutationError.name === 'AbortError') return;
      setError(mutationError.status === 409 ? '用户状态已变化，请刷新后重试' : mutationError.message || '暂时无法禁用用户');
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setMutating(false);
      }
    }
  }

  return (
    <section className="admin-page" aria-labelledby="admin-users-title">
      <div className="admin-page-heading">
        <h2 id="admin-users-title">用户列表</h2>
        <form onSubmit={submitFilters} className="admin-filters">
          <label>用户昵称<input name="nickname" value={filters.nickname} onChange={updateFilter} /></label>
          <label>用户区服<input name="server" value={filters.server} onChange={updateFilter} /></label>
          <label>用户城市<input name="city" value={filters.city} onChange={updateFilter} /></label>
          <label>用户行业<input name="industry" value={filters.industry} onChange={updateFilter} /></label>
          <label>用户认证状态<select name="verificationStatus" value={filters.verificationStatus} onChange={updateFilter}><option value="">全部</option><option value="not_submitted">未提交</option><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option></select></label>
          <label>用户状态<select name="status" value={filters.status} onChange={updateFilter}><option value="">全部</option><option value="active">正常</option><option value="disabled">已禁用</option></select></label>
          <button type="submit" className="button-primary"><Search aria-hidden="true" size={18} />筛选用户</button>
        </form>
      </div>
      {loading && <p role="status">正在加载用户…</p>}
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {!loading && !error && (
        <div className="table-scroll">
          <table className="admin-table admin-table-users">
          <caption className="sr-only">安全用户列表</caption>
          <thead><tr><th>用户</th><th>游戏身份</th><th>职业与互助</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {items.map((user) => {
              const isSelf = user.id === currentUser?.id;
              const isAdmin = user.role === 'admin';
              const isDisabled = user.status !== 'active';
              const disableLabel = `禁用用户：${user.nickname || `用户 ${user.id}`}`;
              return (
                <tr key={user.id}>
                  <td>{user.nickname || '—'}<br />城市：{user.city || '—'}<br />角色：{user.role === 'admin' ? '管理员' : '用户'}</td>
                  <td>区服：{user.server || '—'}<br />游戏昵称：{user.gameNickname || '—'}<br />门派：{user.sect || '—'}<br />入坑年份：{user.startedYear || '—'}</td>
                  <td>行业：{user.industry || '—'}<br />职业：{user.occupation || '—'}<br />可提供：{user.canOffer || '—'}<br />寻找：{user.lookingFor || '—'}</td>
                  <td><StatusBadge type="verification" status={user.verificationStatus} /><br />{user.status === 'active' ? '正常' : '已禁用'}</td>
                  <td>
                    {isAdmin ? (
                      isSelf ? '当前管理员' : '管理员账号'
                    ) : (
                      <button type="button" disabled={mutating || isDisabled} className="button-danger" aria-label={isDisabled ? `${disableLabel}（已禁用）` : disableLabel} onClick={() => disable(user)}><UserX aria-hidden="true" size={18} />{isDisabled ? '已禁用' : '禁用'}</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!items.length && <tr><td colSpan="5">没有符合条件的用户</td></tr>}
          </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
