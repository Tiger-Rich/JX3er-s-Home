import React, { useCallback, useState } from 'react';

import AdminShell from '../../components/AdminShell.jsx';
import AdminRequests from './AdminRequests.jsx';
import AdminUsers from './AdminUsers.jsx';
import AdminVerifications from './AdminVerifications.jsx';

export default function AdminDashboard({ currentUser, onLogout }) {
  const [activeTab, setActiveTab] = useState('verifications');
  const [summary, setSummary] = useState({ verifications: null, requests: null, users: null });
  const setVerificationCount = useCallback((count) => setSummary((current) => ({ ...current, verifications: count })), []);
  const setRequestCount = useCallback((count) => setSummary((current) => ({ ...current, requests: count })), []);
  const setUserCount = useCallback((count) => setSummary((current) => ({ ...current, users: count })), []);

  const showCount = (value) => value ?? '…';

  return (
    <AdminShell activeTab={activeTab} onTabChange={setActiveTab} onLogout={onLogout}>
      <section className="admin-summary" aria-label="后台摘要">
        <span>待审认证 {showCount(summary.verifications)}</span>
        <span>待审委托 {showCount(summary.requests)}</span>
        <span>用户总数 {showCount(summary.users)}</span>
      </section>
      <div hidden={activeTab !== 'verifications'}><AdminVerifications onSummaryChange={setVerificationCount} /></div>
      <div hidden={activeTab !== 'requests'}><AdminRequests onSummaryChange={setRequestCount} /></div>
      <div hidden={activeTab !== 'users'}><AdminUsers currentUser={currentUser} onSummaryChange={setUserCount} /></div>
    </AdminShell>
  );
}
