import React, { useCallback, useEffect, useRef, useState } from 'react';

import { api, setToken, subscribeUnauthorized } from './api/client.js';
import AdminShell from './components/AdminShell.jsx';
import AppShell from './components/AppShell.jsx';
import LoginPage from './pages/LoginPage.jsx';

export default function App() {
  const [session, setSession] = useState(undefined);
  const [authError, setAuthError] = useState('');
  const [activeTab, setActiveTab] = useState('feed');
  const [adminTab, setAdminTab] = useState('verifications');
  const refreshOwnerRef = useRef({ controller: null, version: 0 });

  const cancelRefresh = useCallback(() => {
    const owner = refreshOwnerRef.current;
    owner.version += 1;
    owner.controller?.abort();
    owner.controller = null;
  }, []);

  const refreshSession = useCallback(async () => {
    const owner = refreshOwnerRef.current;
    owner.controller?.abort();
    const controller = new AbortController();
    const requestId = owner.version + 1;
    owner.version = requestId;
    owner.controller = controller;

    try {
      const nextSession = await api('/api/auth/me', {
        notifyUnauthorized: false,
        signal: controller.signal,
      });
      if (owner.version !== requestId) return null;
      setSession(nextSession);
      setAuthError('');
      return nextSession;
    } catch (error) {
      if (owner.version !== requestId || error.name === 'AbortError') return null;
      if (error.status === 401) setToken(null);
      setSession(null);
      if (error.status !== 401) {
        setAuthError(error.message || '暂时无法确认登录状态');
      }
      return null;
    } finally {
      if (owner.version === requestId) owner.controller = null;
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeUnauthorized(() => {
      cancelRefresh();
      setSession(null);
      setAuthError('');
    });
    refreshSession();
    return () => {
      unsubscribe();
      cancelRefresh();
    };
  }, [cancelRefresh, refreshSession]);

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
      if (error.name === 'AbortError') return;
      setAuthError(error.message || '暂时无法完成，请稍后再试');
    }
  }

  function handleLogout() {
    cancelRefresh();
    setToken(null);
    setSession(null);
    setAuthError('');
  }

  if (session === undefined) {
    return (
      <main role="status" aria-live="polite" aria-busy="true">
        正在确认身份…
      </main>
    );
  }

  if (!session?.user) {
    return (
      <LoginPage
        onSubmit={handleAuthenticate}
        onErrorClear={() => setAuthError('')}
        error={authError}
      />
    );
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
