import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App.jsx';
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
    await user.click(screen.getByRole('button', { name: '登录中…' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolveSubmission();
    await waitFor(() => {
      expect(
        screen.getByText('登录', { selector: 'button[type="submit"]' }),
      ).toBeEnabled();
    });
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
});
