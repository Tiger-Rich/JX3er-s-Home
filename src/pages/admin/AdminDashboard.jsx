import React, { useCallback, useState } from 'react';

import AdminShell from '../../components/AdminShell.jsx';
import AdminReports from './AdminReports.jsx';
import AdminRequests from './AdminRequests.jsx';
import AdminUsers from './AdminUsers.jsx';
import AdminVerifications from './AdminVerifications.jsx';

export default function AdminDashboard({ currentUser, onLogout }) {
  const [activeTab, setActiveTab] = useState('verifications');
  const [visitedTabs, setVisitedTabs] = useState(() => new Set(['verifications']));
  const [summary, setSummary] = useState({ verifications: null, requests: null, reports: null, users: null });
  const setVerificationCount = useCallback((count) => setSummary((current) => ({ ...current, verifications: count })), []);
  const setRequestCount = useCallback((count) => setSummary((current) => ({ ...current, requests: count })), []);
  const setReportCount = useCallback((count) => setSummary((current) => ({ ...current, reports: count })), []);
  const setUserCount = useCallback((count) => setSummary((current) => ({ ...current, users: count })), []);

  const showCount = (value) => value ?? '…';
  const changeTab = useCallback((nextTab) => {
    setActiveTab(nextTab);
    setVisitedTabs((current) => {
      if (current.has(nextTab)) return current;
      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
  }, []);

  return (
    <AdminShell activeTab={activeTab} onTabChange={changeTab} onLogout={onLogout}>
      <section className="admin-summary" aria-label="后台摘要">
        <span>待审认证 {showCount(summary.verifications)}</span>
        <span>待审委托 {showCount(summary.requests)}</span>
        <span>待处理举报 {showCount(summary.reports)}</span>
        <span>用户总数 {showCount(summary.users)}</span>
      </section>
      {visitedTabs.has('verifications') && <div hidden={activeTab !== 'verifications'}><AdminVerifications onSummaryChange={setVerificationCount} /></div>}
      {visitedTabs.has('requests') && <div hidden={activeTab !== 'requests'}><AdminRequests onSummaryChange={setRequestCount} /></div>}
      {visitedTabs.has('reports') && <div hidden={activeTab !== 'reports'}><AdminReports onSummaryChange={setReportCount} /></div>}
      {visitedTabs.has('users') && <div hidden={activeTab !== 'users'}><AdminUsers currentUser={currentUser} onSummaryChange={setUserCount} /></div>}
    </AdminShell>
  );
}
