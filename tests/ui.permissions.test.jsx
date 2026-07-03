import React, { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App.jsx';
import * as apiClientModule from '../src/api/client.js';
import { api, getToken, setToken } from '../src/api/client.js';
import AdminShell from '../src/components/AdminShell.jsx';
import AppShell from '../src/components/AppShell.jsx';
import StatusBadge from '../src/components/StatusBadge.jsx';
import ContactPage from '../src/pages/ContactPage.jsx';
import CreateRequestPage from '../src/pages/CreateRequestPage.jsx';
import FeedPage from '../src/pages/FeedPage.jsx';
import LoginPage from '../src/pages/LoginPage.jsx';
import ProfilePage from '../src/pages/ProfilePage.jsx';
import RequestDetailPage from '../src/pages/RequestDetailPage.jsx';

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

  it('falls back to memory when browser storage is missing', () => {
    setToken(null);
    vi.stubGlobal('localStorage', undefined);

    expect(() => setToken('memory-token')).not.toThrow();
    expect(getToken()).toBe('memory-token');
    expect(() => setToken(null)).not.toThrow();
    expect(getToken()).toBeNull();
  });

  it('falls back to memory when browser storage operations throw', () => {
    setToken(null);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('storage unavailable'); }),
      setItem: vi.fn(() => { throw new Error('storage unavailable'); }),
      removeItem: vi.fn(() => { throw new Error('storage unavailable'); }),
    });

    expect(() => setToken('memory-token')).not.toThrow();
    expect(getToken()).toBe('memory-token');
    expect(() => setToken(null)).not.toThrow();
    expect(getToken()).toBeNull();
  });

  it('keeps the memory value when individual storage writes throw', () => {
    setToken(null);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error('write blocked'); }),
      removeItem: vi.fn(),
    });

    setToken('memory-token');
    expect(getToken()).toBe('memory-token');

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'stale-token'),
      setItem: vi.fn(),
      removeItem: vi.fn(() => { throw new Error('remove blocked'); }),
    });
    setToken(null);
    expect(getToken()).toBeNull();
  });
});

describe('user workflow pages', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('never renders a request contact value before an application is approved', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      request: {
        id: 12,
        type: 'industry_consulting',
        title: '聊聊产品转行',
        description: '想请教行业路径。',
        city: '上海',
        remote: true,
        industry: '互联网',
        expiresAt: '2030-01-01T00:00:00.000Z',
        owner: {
          nickname: '七秀同门',
          server: '梦江南',
          sect: '七秀',
          verificationStatus: 'approved',
          contactValue: 'wx-secret-before-approval',
        },
        contactValue: 'request-secret-before-approval',
      },
    }));

    render(
      <RequestDetailPage
        requestId={12}
        session={{ verificationStatus: 'approved' }}
        onBack={() => {}}
      />,
    );

    expect(await screen.findByRole('heading', { name: '聊聊产品转行' })).toBeVisible();
    expect(screen.getByText('七秀同门')).toBeVisible();
    expect(screen.queryByText(/secret-before-approval/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回万事广场' })).toBeVisible();
    expect(screen.queryByText('匿名')).not.toBeInTheDocument();
  });

  it('shows publishing boundaries and disables unverified submission', () => {
    render(<CreateRequestPage session={{ verificationStatus: 'pending' }} />);

    expect(screen.getByText(
      '万事屋不接账号交易、代练、外挂、私服相关委托，也不承诺求职或交易结果。',
    )).toBeVisible();
    expect(screen.getByRole('button', { name: '发布委托' })).toBeDisabled();
    expect(screen.getByText('待掌柜审核')).toBeVisible();
    expect(screen.queryByText('匿名')).not.toBeInTheDocument();
  });

  it('uses 我的名片 and requires server plus game nickname for verification', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      user: { nickname: '小七', city: null, contactValue: null },
      profile: null,
      verificationStatus: 'not_submitted',
    }));

    render(<ProfilePage onSessionRefresh={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: '我的名片' })).toBeVisible();
    expect(screen.queryByText('我的番薯名片')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('区服')).toBeRequired();
    expect(screen.getByLabelText('游戏 ID/昵称')).toBeRequired();
    expect(screen.getByText('我们不会索要游戏账号密码')).toBeVisible();
  });

  it('shows contact details only for approved applications and calls owner decisions', async () => {
    const applications = [
      {
        id: 21,
        direction: 'incoming',
        status: 'pending',
        requestTitle: '本地摄影帮忙',
        applicantNickname: '万花',
        ownerNickname: '七秀',
        message: '我周末可以帮忙。',
        contactValue: 'pending-secret',
      },
      {
        id: 22,
        direction: 'incoming',
        status: 'pending',
        requestTitle: '行业简历建议',
        applicantNickname: '苍云',
        ownerNickname: '七秀',
        message: '可以先看一版简历。',
      },
      {
        id: 23,
        direction: 'outgoing',
        status: 'approved',
        requestTitle: '产品转行咨询',
        applicantNickname: '七秀',
        ownerNickname: '万花',
        message: '想约半小时交流。',
        contactValue: 'wx-approved-only',
      },
      {
        id: 24,
        direction: 'outgoing',
        status: 'rejected',
        requestTitle: '旧委托',
        applicantNickname: '七秀',
        ownerNickname: '唐门',
        message: '此前申请。',
        contactValue: 'rejected-secret',
      },
    ];
    fetch.mockImplementation((path, options = {}) => {
      if (path === '/api/contact' && !options.method) {
        return Promise.resolve(jsonResponse({ applications }));
      }
      if (path === '/api/contact/21/approve' || path === '/api/contact/22/reject') {
        return Promise.resolve(jsonResponse({ application: {} }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<ContactPage />);

    expect(await screen.findByText('本地摄影帮忙')).toBeVisible();
    expect(screen.queryByText('pending-secret')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: '同意见面聊聊' })[0]);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/contact/21/approve',
      expect.objectContaining({ method: 'POST' }),
    ));
    await user.click(screen.getAllByRole('button', { name: '暂不合适' })[1]);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/contact/22/reject',
      expect.objectContaining({ method: 'POST' }),
    ));

    await user.click(screen.getByRole('button', { name: '我递出' }));
    expect(screen.getByText(/wx-approved-only/)).toBeVisible();
    expect(screen.queryByText('rejected-secret')).not.toBeInTheDocument();
  });

  it('sorts priority request types first and sends encoded feed filters', async () => {
    const requests = [
      { id: 1, type: 'other', title: '最新普通委托', createdAt: '2026-07-03T12:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z', remote: false, city: '杭州', owner: {} },
      { id: 2, type: 'job_referral', title: '较早内推', createdAt: '2026-07-01T12:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z', remote: true, city: null, owner: {} },
      { id: 3, type: 'industry_consulting', title: '较新咨询', createdAt: '2026-07-02T12:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z', remote: true, city: '上海', owner: {} },
    ];
    fetch.mockResolvedValue(jsonResponse({ requests }));
    render(<FeedPage onSelectRequest={() => {}} />);

    const links = await screen.findAllByRole('button', { name: /查看委托/ });
    expect(links.map((button) => button.textContent)).toEqual([
      expect.stringContaining('较新咨询'),
      expect.stringContaining('较早内推'),
      expect.stringContaining('最新普通委托'),
    ]);

    fireEvent.change(screen.getByLabelText('城市'), { target: { value: '上海 浦东' } });
    fireEvent.change(screen.getByLabelText('行业'), { target: { value: '游戏&互联网' } });
    fireEvent.change(screen.getByLabelText('远程方式'), { target: { value: 'true' } });
    await waitFor(() => {
      const lastUrl = fetch.mock.calls.at(-1)[0];
      expect(lastUrl).toContain('city=%E4%B8%8A%E6%B5%B7+%E6%B5%A6%E4%B8%9C');
      expect(lastUrl).toContain('industry=%E6%B8%B8%E6%88%8F%26%E4%BA%92%E8%81%94%E7%BD%91');
      expect(lastUrl).toContain('remote=true');
    });
  });

  it('keeps a create draft mounted while switching bottom tabs', async () => {
    fetch.mockImplementation((path) => {
      if (path === '/api/auth/me') {
        return Promise.resolve(jsonResponse({
          user: { id: 9, role: 'user', nickname: '七秀' },
          verificationStatus: 'approved',
        }));
      }
      if (path === '/api/requests') return Promise.resolve(jsonResponse({ requests: [] }));
      if (path === '/api/contact') return Promise.resolve(jsonResponse({ applications: [] }));
      if (path === '/api/profile') {
        return Promise.resolve(jsonResponse({
          user: { nickname: '七秀' },
          profile: { server: '梦江南', gameNickname: '秀秀' },
          verificationStatus: 'approved',
        }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: '发个委托' }));
    await user.type(screen.getByLabelText('标题'), '保留下来的委托草稿');
    await user.click(screen.getByRole('button', { name: '我的名片' }));
    await user.click(screen.getByRole('button', { name: '发个委托' }));
    expect(screen.getByLabelText('标题')).toHaveValue('保留下来的委托草稿');
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

  it('uses the memory token for the session refresh when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', undefined);
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ token: 'memory-session-token' }))
      .mockResolvedValueOnce(jsonResponse({ user: { id: 3, role: 'user' } }));
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('账号'), 'wanhua');
    await user.type(screen.getByLabelText('密码'), 'secret123');
    await user.click(screen.getByText('登录', { selector: 'button[type="submit"]' }));

    expect(await screen.findByRole('button', { name: '万事广场' })).toBeVisible();
    expect(getToken()).toBe('memory-session-token');
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/auth/me', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer memory-session-token',
      }),
    }));
  });

  it('does not store a login result or refresh the session after unmount', async () => {
    const loginRequest = deferred();
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }))
      .mockReturnValueOnce(loginRequest.promise);
    const user = userEvent.setup();
    const view = render(<App />);

    await user.type(await screen.findByLabelText('账号'), 'wanhua');
    await user.type(screen.getByLabelText('密码'), 'secret123');
    await user.click(screen.getByText('登录', { selector: 'button[type="submit"]' }));
    const loginSignal = fetch.mock.calls[1][1].signal;

    view.unmount();
    expect(loginSignal.aborted).toBe(true);
    await act(async () => {
      loginRequest.resolve(jsonResponse({ token: 'late-token' }));
      await loginRequest.promise;
    });

    expect(getToken()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('lets only the newest authentication response update the token and session', async () => {
    const firstLogin = deferred();
    const secondLogin = deferred();
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, { status: 401 }))
      .mockReturnValueOnce(firstLogin.promise)
      .mockReturnValueOnce(secondLogin.promise)
      .mockResolvedValueOnce(jsonResponse({ user: { id: 4, role: 'user' } }));
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('账号'), 'wanhua');
    await user.type(screen.getByLabelText('密码'), 'secret123');
    const form = screen.getByText('登录', { selector: 'button[type="submit"]' }).closest('form');
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    await act(async () => {
      secondLogin.resolve(jsonResponse({ token: 'newest-token' }));
    });
    expect(await screen.findByRole('button', { name: '万事广场' })).toBeVisible();

    await act(async () => {
      firstLogin.resolve(jsonResponse({ token: 'stale-token' }));
    });
    expect(getToken()).toBe('newest-token');
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch).toHaveBeenNthCalledWith(5, '/api/requests', expect.any(Object));
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
      .mockResolvedValueOnce(jsonResponse({ requests: [] }))
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
