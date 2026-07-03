import React, { StrictMode, useState } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App.jsx';
import * as apiClientModule from '../src/api/client.js';
import { api, getToken, setToken } from '../src/api/client.js';
import AdminShell from '../src/components/AdminShell.jsx';
import AppShell from '../src/components/AppShell.jsx';
import StatusBadge from '../src/components/StatusBadge.jsx';
import LoginPage from '../src/pages/LoginPage.jsx';

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('application shells', () => {
  it('shows the approved user navigation and identity-first header copy', async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();

    render(
      <AppShell activeTab="feed" onTabChange={onTabChange} onLogout={() => {}}>
        <p>当前内容</p>
      </AppShell>,
    );

    expect(screen.getByRole('heading', { name: '番薯万事屋' })).toBeVisible();
    expect(screen.getByText('同在江湖，先看身份，再谈合作。')).toBeVisible();
    expect(screen.getByText('当前内容')).toBeVisible();

    for (const label of ['万事广场', '发个委托', '联系申请', '我的名片']) {
      expect(screen.getByRole('button', { name: label })).toBeVisible();
    }
    expect(screen.queryByText('我的番薯名片')).not.toBeInTheDocument();
    expect(screen.queryByText('匿名')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '联系申请' }));
    expect(onTabChange).toHaveBeenCalledWith('contacts');
  });

  it('keeps the admin navigation professional and excludes workflow statuses', () => {
    render(
      <AdminShell activeTab="verifications" onTabChange={() => {}} onLogout={() => {}}>
        <p>审核工作区</p>
      </AdminShell>,
    );

    for (const label of ['认证审核', '委托审核', '用户列表']) {
      expect(screen.getByRole('button', { name: label })).toBeVisible();
    }
    expect(screen.getByText('同在江湖，先看身份，再谈合作。')).toBeVisible();
    expect(screen.queryByText('待掌柜审核')).not.toBeInTheDocument();
    expect(screen.queryByText('匿名')).not.toBeInTheDocument();
  });

  it('uses readable domain status labels with a safe unknown fallback', () => {
    const { rerender } = render(<StatusBadge status="pending" type="verification" />);
    expect(screen.getByText('待掌柜审核')).toBeVisible();

    rerender(<StatusBadge status="approved" type="request" />);
    expect(screen.getByText('已发布')).toBeVisible();

    rerender(<StatusBadge status="unexpected" type="application" />);
    expect(screen.getByText('状态未知')).toBeVisible();
  });
});

describe('LoginPage', () => {
  it('switches between login and registration without requesting game credentials', async () => {
    const user = userEvent.setup();
    render(<LoginPage onSubmit={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '登录番薯万事屋' })).toBeVisible();
    expect(screen.getByLabelText('账号')).toBeVisible();
    expect(screen.getByLabelText('密码')).toBeVisible();
    expect(screen.queryByLabelText('昵称')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(screen.getByRole('heading', { name: '注册番薯身份' })).toBeVisible();
    expect(screen.getByLabelText('昵称')).toBeVisible();
    expect(screen.queryByText(/区服|游戏 ID|游戏账号密码/)).not.toBeInTheDocument();
  });

  it('shows authentication errors and blocks duplicate submissions', async () => {
    let resolveSubmission;
    const onSubmit = vi.fn(
      () => new Promise((resolve) => {
        resolveSubmission = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<LoginPage onSubmit={onSubmit} error="账号或密码不正确" />);

    expect(screen.getByRole('alert')).toHaveTextContent('账号或密码不正确');
    await user.type(screen.getByLabelText('账号'), 'qixiu');
    await user.type(screen.getByLabelText('密码'), 'secret123');
    await user.click(screen.getByText('登录', { selector: 'button[type="submit"]' }));

    expect(onSubmit).toHaveBeenCalledWith({
      mode: 'login',
      account: 'qixiu',
      password: 'secret123',
    });
    expect(screen.getByRole('button', { name: '登录中…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    const modeGroup = screen.getByRole('group', { name: '账号操作' });
    expect(within(modeGroup).getByRole('button', { name: '登录' })).toBeDisabled();
    expect(within(modeGroup).getByRole('button', { name: '注册' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '登录中…' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolveSubmission();
    await waitFor(() => {
      expect(
        screen.getByText('登录', { selector: 'button[type="submit"]' }),
      ).toBeEnabled();
    });
  });

  it('clears a server error when switching mode or starting to edit', async () => {
    function LoginHarness() {
      const [error, setError] = useState('服务端拒绝了本次登录');
      return (
        <LoginPage
          error={error}
          onErrorClear={() => setError('')}
          onSubmit={vi.fn()}
        />
      );
    }

    const user = userEvent.setup();
    const { rerender } = render(<LoginHarness />);
    expect(screen.getByRole('alert')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<LoginHarness key="editing" />);
    expect(screen.getByRole('alert')).toBeVisible();
    await user.type(screen.getByLabelText('账号'), 'q');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('API client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores tokens and sends Bearer JSON requests', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    setToken('session-token');

    expect(getToken()).toBe('session-token');
    await expect(api('/api/example', { method: 'POST', body: { value: 7 } })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/example', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ value: 7 }),
      headers: expect.objectContaining({
        Authorization: 'Bearer session-token',
        'Content-Type': 'application/json',
      }),
    }));

    setToken(null);
    expect(getToken()).toBeNull();
  });

  it('handles 204 responses and exposes public errors with status', async () => {
    fetch
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ message: '请稍后再试' }, { status: 429 }));

    await expect(api('/api/empty')).resolves.toBeNull();
    await expect(api('/api/limited')).rejects.toMatchObject({
      message: '请稍后再试',
      status: 429,
    });
  });

  it('uses status before parsing and logs out a token owner on malformed 401 JSON', async () => {
    const onUnauthorized = vi.fn();
    const unsubscribe = apiClientModule.subscribeUnauthorized(onUnauthorized);
    setToken('expired-token');
    fetch.mockResolvedValueOnce(
      new Response('{broken', {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(api('/api/requests')).rejects.toMatchObject({
      message: 'Request failed (401)',
      status: 401,
    });
    expect(getToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not publish unauthorized events for tokenless login failures', async () => {
    const onUnauthorized = vi.fn();
    const unsubscribe = apiClientModule.subscribeUnauthorized(onUnauthorized);
    fetch.mockResolvedValueOnce(
      jsonResponse({ error: 'Invalid account or password' }, { status: 401 }),
    );

    await expect(
      api('/api/auth/login', {
        method: 'POST',
        body: { account: 'qixiu', password: 'wrong' },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('can suppress global unauthorized effects for owned session refreshes', async () => {
    const onUnauthorized = vi.fn();
    const unsubscribe = apiClientModule.subscribeUnauthorized(onUnauthorized);
    setToken('possibly-stale-token');
    fetch.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }));

    await expect(
      api('/api/auth/me', { notifyUnauthorized: false }),
    ).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBe('possibly-stale-token');
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('notifyUnauthorized');
    unsubscribe();
  });

  it('rejects successful malformed JSON with a stable response error', async () => {
    fetch.mockResolvedValueOnce(
      new Response('{broken', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(api('/api/broken')).rejects.toMatchObject({
      message: 'Invalid server response',
    });
  });

  it('forwards AbortSignal and preserves AbortError', async () => {
    const controller = new AbortController();
    fetch.mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    }));

    const request = api('/api/slow', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('treats missing browser storage as an unavailable capability', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(getToken()).toBeNull();
    expect(() => setToken('ignored-token')).not.toThrow();
    expect(() => setToken(null)).not.toThrow();
  });
});

describe('App session flow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows login after an unauthenticated session check', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }));
    render(<App />);

    expect(await screen.findByRole('heading', { name: '登录番薯万事屋' })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.any(Object));
  });

  it('announces session loading accessibly', () => {
    fetch.mockReturnValueOnce(new Promise(() => {}));
    render(<App />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it.each([
    ['user', '万事广场', '认证审核'],
    ['admin', '认证审核', '万事广场'],
  ])('routes a %s session to the correct shell', async (role, visible, absent) => {
    fetch.mockResolvedValueOnce(jsonResponse({ user: { id: 1, role } }));
    render(<App />);

    expect(await screen.findByRole('button', { name: visible })).toBeVisible();
    expect(screen.queryByRole('button', { name: absent })).not.toBeInTheDocument();
  });

  it('saves a login token, refreshes the session, and clears it on logout', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ token: 'fresh-token' }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 2, role: 'user' } }));
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('账号'), 'wanhua');
    await user.type(screen.getByLabelText('密码'), 'secret123');
    await user.click(screen.getByText('登录', { selector: 'button[type="submit"]' }));

    expect(await screen.findByRole('button', { name: '万事广场' })).toBeVisible();
    expect(getToken()).toBe('fresh-token');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ account: 'wanhua', password: 'secret123' }),
    }));

    await user.click(screen.getByRole('button', { name: '退出登录' }));
    expect(getToken()).toBeNull();
    expect(screen.getByRole('heading', { name: '登录番薯万事屋' })).toBeVisible();
  });

  it('keeps the newest StrictMode refresh when an aborted request resolves out of order', async () => {
    const requests = [];
    setToken('current-token');
    fetch.mockImplementation((path, options) => {
      const request = deferred();
      requests.push({ ...request, options, path });
      return request.promise;
    });

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].options.signal.aborted).toBe(true);

    await act(async () => {
      requests[1].resolve(jsonResponse({ user: { id: 7, role: 'user' } }));
    });
    expect(await screen.findByRole('button', { name: '万事广场' })).toBeVisible();

    await act(async () => {
      requests[0].resolve(jsonResponse({ error: 'Unauthorized' }, { status: 401 }));
    });
    expect(getToken()).toBe('current-token');
    expect(screen.getByRole('button', { name: '万事广场' })).toBeVisible();
  });

  it('ignores a response that arrives after unmount even when fetch ignores abort', async () => {
    const request = deferred();
    setToken('preserved-token');
    fetch.mockReturnValueOnce(request.promise);
    const { unmount } = render(<App />);
    const signal = fetch.mock.calls[0][1].signal;

    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      request.resolve(jsonResponse({ error: 'Unauthorized' }, { status: 401 }));
    });
    expect(getToken()).toBe('preserved-token');
  });

  it('returns to login when any token-bearing business request gets a 401', async () => {
    setToken('expired-token');
    fetch
      .mockResolvedValueOnce(jsonResponse({ user: { id: 9, role: 'user' } }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }));
    render(<App />);

    expect(await screen.findByRole('button', { name: '万事广场' })).toBeVisible();
    let requestError;
    await act(async () => {
      try {
        await api('/api/requests');
      } catch (error) {
        requestError = error;
      }
    });
    expect(requestError).toMatchObject({ status: 401 });

    expect(await screen.findByRole('heading', { name: '登录番薯万事屋' })).toBeVisible();
    expect(getToken()).toBeNull();
  });
});
