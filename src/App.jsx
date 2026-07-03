import React, { useCallback, useEffect, useState } from 'react';

import { api, setToken } from './api/client.js';
import AdminShell from './components/AdminShell.jsx';
import AppShell from './components/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';

export default function App() {
  const [session, setSession] = useState(undefined);
  const [authError, setAuthError] = useState('');
  const [activeTab, setActiveTab] = useState('feed');
  const [adminTab, setAdminTab] = useState('verifications');

  const refreshSession = useCallback(async () => {
    try {
      const nextSession = await api('/api/auth/me');
      setSession(nextSession);
      setAuthError('');
      return nextSession;
    } catch (error) {
      if (error.status === 401) setToken(null);
      setSession(null);
      if (error.status !== 401) {
        setAuthError(error.message || '暂时无法确认登录状态');
      }
      return null;
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  async function handleAuthenticate({ mode, ...credentials }) {
    setAuthError('');
    try {
      const result = await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: credentials,
      });
      setToken(result.token);
      await refreshSession();
    } catch (error) {
      setAuthError(error.message || '暂时无法完成，请稍后再试');
    }
  }

  function handleLogout() {
    setToken(null);
    setSession(null);
    setAuthError('');
  }

  if (session === undefined) {
    return <main aria-busy="true">正在确认身份…</main>;
  }

  if (!session?.user) {
    return <LoginPage onSubmit={handleAuthenticate} error={authError} />;
  }

  if (session.user.role === 'admin') {
    return (
      <AdminShell
        activeTab={adminTab}
        onTabChange={setAdminTab}
        onLogout={handleLogout}
      >
        <div aria-live="polite" data-active-tab={adminTab} />
      </AdminShell>
    );
  }

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onLogout={handleLogout}
    >
      <div aria-live="polite" data-active-tab={activeTab} />
    </AppShell>
  );
}
