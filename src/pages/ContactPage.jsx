import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

import { api } from '../api/client.js';
import StatusBadge from '../components/StatusBadge.jsx';

export default function ContactPage() {
  const [direction, setDirection] = useState('incoming');
  const [state, setState] = useState({ loading: true, error: '', applications: [] });
  const [busyId, setBusyId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const mountedRef = useRef(false);
  const loadOwnerRef = useRef({ controller: null, version: 0 });
  const mutationOwnerRef = useRef({ controller: null, version: 0 });

  const loadApplications = useCallback(async () => {
    const owner = loadOwnerRef.current;
    owner.controller?.abort();
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    try {
      const result = await api('/api/contact', { signal: controller.signal });
      if (!mountedRef.current || owner.version !== requestId) return;
      setState({ loading: false, error: '', applications: result.applications ?? [] });
    } catch (error) {
      if (!mountedRef.current || owner.version !== requestId || error.name === 'AbortError') return;
      setState({ loading: false, error: error.message || '暂时无法加载联系申请', applications: [] });
    } finally {
      if (owner.version === requestId) owner.controller = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadApplications();
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
  }, [loadApplications]);

  const applications = useMemo(
    () => state.applications.filter((application) => application.direction === direction),
    [direction, state.applications],
  );

  async function decide(id, decision) {
    const owner = mutationOwnerRef.current;
    if (owner.controller) return;
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;
    setBusyId(id);
    setFeedback(null);
    try {
      await api(`/api/contact/${id}/${decision}`, {
        method: 'POST',
        signal: controller.signal,
      });
      if (!mountedRef.current || owner.version !== requestId) return;
      setFeedback({
        type: 'success',
        message: decision === 'approve' ? '已同意见面聊聊。' : '已回复暂不合适。',
      });
      await loadApplications();
    } catch (error) {
      if (!mountedRef.current || owner.version !== requestId || error.name === 'AbortError') return;
      setFeedback({
        type: 'error',
        message: error.status === 409 ? `未能处理：${error.message}` : error.message || '暂时无法处理申请',
      });
    } finally {
      if (owner.version === requestId) {
        owner.controller = null;
        if (mountedRef.current) setBusyId(null);
      }
    }
  }

  return (
    <section className="page contact-page" aria-labelledby="contact-title">
      <h2 id="contact-title">联系申请</h2>
      <div role="group" aria-label="申请方向" className="segmented-control">
        <button type="button" aria-pressed={direction === 'incoming'} onClick={() => setDirection('incoming')}>我收到</button>
        <button type="button" aria-pressed={direction === 'outgoing'} onClick={() => setDirection('outgoing')}>我递出</button>
      </div>
      {state.loading && <p role="status">正在查看往来消息…</p>}
      {!state.loading && state.error && <p role="alert">{state.error}</p>}
      {!state.loading && !state.error && applications.length === 0 && <p>这里暂时没有联系申请。</p>}
      {!state.loading && !state.error && (
        <div className="contact-list">
          {applications.map((application) => {
            const otherNickname = direction === 'incoming' ? application.applicantNickname : application.ownerNickname;
            return (
              <article className="contact-card" key={application.id}>
                <h3>{application.requestTitle}</h3>
                <p>{direction === 'incoming' ? '申请人' : '发布者'}：{otherNickname}</p>
                <p>{application.message}</p>
                <StatusBadge type="application" status={application.status} />
                {application.status === 'approved' && application.contactValue && <p>联系方式：{application.contactValue}</p>}
                {direction === 'incoming' && application.status === 'pending' && (
                  <div className="action-row">
                    <button type="button" disabled={busyId !== null} onClick={() => decide(application.id, 'approve')}>
                      <Check aria-hidden="true" size={18} />同意见面聊聊
                    </button>
                    <button type="button" disabled={busyId !== null} onClick={() => decide(application.id, 'reject')} className="button-danger">
                      <X aria-hidden="true" size={18} />暂不合适
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {feedback && <p role={feedback.type === 'success' ? 'status' : 'alert'} aria-live="polite">{feedback.message}</p>}
    </section>
  );
}
