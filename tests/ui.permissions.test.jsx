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
import MyRequestsPage from '../src/pages/MyRequestsPage.jsx';
import ProfilePage from '../src/pages/ProfilePage.jsx';
import RequestDetailPage from '../src/pages/RequestDetailPage.jsx';
import AdminDashboard from '../src/pages/admin/AdminDashboard.jsx';
import AdminRequests from '../src/pages/admin/AdminRequests.jsx';
import AdminUsers from '../src/pages/admin/AdminUsers.jsx';
import AdminVerifications from '../src/pages/admin/AdminVerifications.jsx';

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

function fillDefaultJobReferralDetails(values = {}) {
  const details = {
    targetRole: '前端工程师',
    targetIndustry: '互联网',
    careerStage: '三年经验，看新机会',
    helpWanted: '希望获得内推和简历建议。',
    ...values,
  };
  fireEvent.change(screen.getByLabelText('目标岗位'), { target: { value: details.targetRole } });
  fireEvent.change(screen.getByLabelText('目标行业'), { target: { value: details.targetIndustry } });
  fireEvent.change(screen.getByLabelText('当前阶段'), { target: { value: details.careerStage } });
  fireEvent.change(screen.getByLabelText('希望获得的帮助'), { target: { value: details.helpWanted } });
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

    for (const label of ['万事广场', '发个委托', '我的委托', '联系申请', '我的名片']) {
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
  it('applies explicit secondary button classes to shell navigation and logout actions', () => {
    const { container, rerender } = render(
      <AppShell activeTab="feed" onTabChange={() => {}} onLogout={() => {}}>
        <p>shell body</p>
      </AppShell>,
    );

    for (const button of container.querySelectorAll('.app-header button, .bottom-navigation button')) {
      expect(button).toHaveClass('button-secondary');
    }

    rerender(
      <AdminShell activeTab="verifications" onTabChange={() => {}} onLogout={() => {}}>
        <p>admin body</p>
      </AdminShell>,
    );

    for (const button of container.querySelectorAll('.admin-header button, .admin-navigation button')) {
      expect(button).toHaveClass('button-secondary');
    }
  });
});

describe('MyRequestsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists owner requests and renders the available lifecycle action for each status', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      requests: [
        {
          id: 301,
          type: 'other',
          title: '待评审委托',
          status: 'pending',
          city: '杭州',
          remote: false,
          expiresAt: '2099-01-01T00:00:00.000Z',
          reactionCount: 1,
          favoriteCount: 2,
          applicationCount: 3,
        },
        {
          id: 302,
          type: 'other',
          title: '已发布委托',
          status: 'approved',
          city: '上海',
          remote: true,
          expiresAt: '2099-01-01T00:00:00.000Z',
          reactionCount: 0,
          favoriteCount: 0,
          applicationCount: 0,
        },
        {
          id: 303,
          type: 'other',
          title: '已撤回委托',
          status: 'withdrawn',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      ],
    }));

    render(<MyRequestsPage onSelectRequest={vi.fn()} onEditRequest={vi.fn()} onCreateRequest={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: '我的委托' })).toBeVisible();
    expect(screen.getByRole('button', { name: '撤回委托：待评审委托' })).toBeVisible();
    expect(screen.getByRole('button', { name: '关闭委托：已发布委托' })).toBeVisible();
    expect(screen.getByText('联系申请 3')).toBeVisible();
    expect(screen.queryByRole('button', { name: '编辑委托：已撤回委托' })).not.toBeInTheDocument();
  });

  it('withdraws, closes, and hides owner requests from the list', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        requests: [
          { id: 401, type: 'other', title: '待审', status: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' },
          { id: 402, type: 'other', title: '发布中', status: 'approved', expiresAt: '2099-01-01T00:00:00.000Z' },
          { id: 403, type: 'other', title: '已关闭', status: 'closed', expiresAt: '2099-01-01T00:00:00.000Z' },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ request: { id: 401, title: '待审', status: 'withdrawn' } }))
      .mockResolvedValueOnce(jsonResponse({ request: { id: 402, title: '发布中', status: 'closed' } }))
      .mockResolvedValueOnce(jsonResponse({ hidden: true }));
    const user = userEvent.setup();

    render(<MyRequestsPage onSelectRequest={vi.fn()} onEditRequest={vi.fn()} onCreateRequest={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: '撤回委托：待审' }));
    await user.click(screen.getByRole('button', { name: '关闭委托：发布中' }));
    await user.click(screen.getByRole('button', { name: '删除委托：已关闭' }));

    expect(fetch).toHaveBeenCalledWith('/api/my/requests/401/withdraw', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenCalledWith('/api/my/requests/402/close', expect.objectContaining({ method: 'POST' }));
    expect(fetch).toHaveBeenCalledWith('/api/my/requests/403/hide', expect.objectContaining({ method: 'POST' }));
    expect(screen.queryByRole('heading', { name: '已关闭' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除委托：已关闭' })).not.toBeInTheDocument();
  });

  it('opens closed and withdrawn request details through the owner endpoint', async () => {
    setToken(null);
    fetch.mockImplementation((path) => {
      if (path === '/api/auth/me') {
        return Promise.resolve(jsonResponse({
          user: { id: 9, role: 'user', nickname: '七秀' },
          verificationStatus: 'approved',
        }));
      }
      if (path === '/api/requests?channel=recommended&sort=recommended') {
        return Promise.resolve(jsonResponse({ requests: [] }));
      }
      if (path === '/api/my/requests') {
        return Promise.resolve(jsonResponse({
          requests: [{
            id: 901,
            type: 'other',
            title: '从我的委托查看已关闭详情',
            status: 'closed',
            expiresAt: '2099-01-01T00:00:00.000Z',
          }, {
            id: 902,
            type: 'other',
            title: '从我的委托查看已撤回详情',
            status: 'withdrawn',
            expiresAt: '2099-01-01T00:00:00.000Z',
          }],
        }));
      }
      if (path === '/api/my/requests/901') {
        return Promise.resolve(jsonResponse({
          request: {
            id: 901,
            ownerId: 9,
            type: 'other',
            title: '从我的委托查看已关闭详情',
            description: '已关闭详情已打开',
            status: 'closed',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        }));
      }
      if (path === '/api/my/requests/902') {
        return Promise.resolve(jsonResponse({
          request: {
            id: 902,
            ownerId: 9,
            type: 'other',
            title: '从我的委托查看已撤回详情',
            description: '已撤回详情已打开',
            status: 'withdrawn',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();

    render(<App />);

    await user.click(await screen.findByRole('button', { name: '我的委托' }));
    await user.click(await screen.findByRole('button', { name: '查看委托：从我的委托查看已关闭详情' }));

    expect(await screen.findByText('已关闭详情已打开')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith('/api/my/requests/901', expect.any(Object));
    expect(fetch).not.toHaveBeenCalledWith('/api/requests/901', expect.any(Object));
    expect(screen.queryByRole('button', { name: '递出联系申请' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收藏委托' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回万事广场' }));
    await user.click(screen.getByRole('button', { name: '我的委托' }));
    await user.click(screen.getByRole('button', { name: '查看委托：从我的委托查看已撤回详情' }));

    expect(await screen.findByText('已撤回详情已打开')).toBeVisible();
    expect(fetch).toHaveBeenCalledWith('/api/my/requests/902', expect.any(Object));
    expect(fetch).not.toHaveBeenCalledWith('/api/requests/902', expect.any(Object));
    expect(screen.queryByRole('button', { name: '递出联系申请' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收藏委托' })).not.toBeInTheDocument();
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

  it('sends FormData without forcing a JSON content type', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const formData = new FormData();
    formData.append('title', 'typed request');

    await api('/api/requests', { method: 'POST', body: formData });

    expect(fetch).toHaveBeenCalledWith('/api/requests', expect.objectContaining({
      method: 'POST',
      body: formData,
      headers: expect.not.objectContaining({ 'Content-Type': expect.any(String) }),
    }));
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
          gameNickname: '秀水灵心',
          sect: '七秀',
          startedYear: 2013,
          city: '苏州',
          industry: '游戏研发',
          occupation: '产品经理',
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
    expect(screen.getByText('入坑年份：2013')).toBeVisible();
    expect(screen.getByText('所在城市：苏州')).toBeVisible();
    expect(screen.getByText('从事行业：游戏研发')).toBeVisible();
    expect(screen.queryByText(/secret-before-approval/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回万事广场' })).toBeVisible();
    expect(screen.queryByText('匿名')).not.toBeInTheDocument();
  });

  it('does not offer contact application controls on the viewer own request', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      request: {
        id: 13,
        ownerId: 7,
        type: 'industry_consulting',
        title: '自己的行业咨询委托',
        description: '我发布的委托不应该允许自己递出联系申请。',
        city: '上海',
        remote: true,
        industry: '游戏',
        expiresAt: '2030-01-01T00:00:00.000Z',
        owner: {
          nickname: '七秀同门',
          server: '梦江南',
          gameNickname: '秀水灵心',
          sect: '七秀',
          startedYear: 2013,
          city: '苏州',
          industry: '游戏研发',
          occupation: '产品经理',
          verificationStatus: 'approved',
        },
      },
    }));

    render(
      <RequestDetailPage
        requestId={13}
        session={{ user: { id: 7 }, verificationStatus: 'approved' }}
        onBack={() => {}}
      />,
    );

    expect(await screen.findByRole('heading', { name: '自己的行业咨询委托' })).toBeVisible();
    expect(screen.getByText('这是你发布的委托，其他番薯递出联系申请后会在联系申请里出现。')).toBeVisible();
    expect(screen.queryByLabelText('联系申请-给ta一个和你交换联系方式的理由')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '递出联系申请' })).not.toBeInTheDocument();
  });

  it('posts detail actions with their required bodies and calls the back handler', async () => {
    const onBack = vi.fn();
    fetch.mockImplementation((path, options = {}) => {
      if (path === '/api/requests/31' && !options.method) {
        return Promise.resolve(jsonResponse({
          request: {
            id: 31,
            type: 'job_referral',
            title: '前端岗位内推',
            description: '请先简单介绍经验。',
            city: '杭州',
            remote: false,
            industry: '互联网',
            budgetOrReward: null,
            expiresAt: '2030-01-01T00:00:00.000Z',
            owner: {
              nickname: '万花同门',
              server: '唯满侠',
              gameNickname: '墨意',
              sect: '万花',
              startedYear: 2012,
              city: '杭州',
              industry: '互联网',
              occupation: '工程师',
              verificationStatus: 'approved',
            },
          },
        }));
      }
      if (path === '/api/requests/31/applications') {
        return Promise.resolve(jsonResponse({ application: { id: 1, status: 'pending' } }, { status: 201 }));
      }
      if (path === '/api/requests/31/favorite') {
        return Promise.resolve(jsonResponse({ favorited: true }));
      }
      if (path === '/api/requests/31/report') {
        return Promise.resolve(jsonResponse({ report: { id: 2, status: 'pending' } }, { status: 201 }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(
      <RequestDetailPage
        requestId={31}
        session={{ verificationStatus: 'approved' }}
        onBack={onBack}
      />,
    );

    await screen.findByRole('heading', { name: '前端岗位内推' });
    await user.click(screen.getByRole('button', { name: '返回万事广场' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText('联系申请-给ta一个和你交换联系方式的理由'), '我有五年前端经验，想进一步聊聊。');
    await user.click(screen.getByRole('button', { name: '递出联系申请' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/requests/31/applications',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: '我有五年前端经验，想进一步聊聊。' }),
      }),
    ));
    expect(screen.getByRole('status')).toHaveTextContent('联系申请已递出，请等对方回应。');

    await user.click(screen.getByRole('button', { name: '收藏委托' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/requests/31/favorite',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(screen.getByRole('status')).toHaveTextContent('已收藏这份委托。');

    await user.click(screen.getByRole('button', { name: '确认举报' }));
    expect(fetch.mock.calls.some(([path]) => path === '/api/requests/31/report')).toBe(false);
    expect(screen.getByLabelText('举报原因')).toBeInvalid();
    await user.type(screen.getByLabelText('举报原因'), '内容疑似虚假，需要掌柜核查。');
    await user.click(screen.getByRole('button', { name: '确认举报' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/requests/31/report',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: '内容疑似虚假，需要掌柜核查。' }),
      }),
    ));
    expect(screen.getByRole('status')).toHaveTextContent('举报已提交，掌柜会核查。');
  });

  it('locks every detail mutation while one action is pending', async () => {
    const mutation = deferred();
    fetch.mockImplementation((path) => {
      if (path === '/api/requests/32') {
        return Promise.resolve(jsonResponse({
          request: {
            id: 32, type: 'other', title: '并发保护委托', description: '测试动作锁。',
            city: '杭州', remote: false, expiresAt: '2030-01-01T00:00:00.000Z', owner: {},
          },
        }));
      }
      if (path === '/api/requests/32/applications') return mutation.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<RequestDetailPage requestId={32} session={{ verificationStatus: 'approved' }} onBack={() => {}} />);

    await screen.findByRole('heading', { name: '并发保护委托' });
    await user.type(screen.getByLabelText('联系申请-给ta一个和你交换联系方式的理由'), '我想进一步了解。');
    await user.type(screen.getByLabelText('举报原因'), '备用举报内容');
    await user.click(screen.getByRole('button', { name: '递出联系申请' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    for (const name of ['递出联系申请', '收藏委托', '确认举报']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: '收藏委托' }));
    fireEvent.click(screen.getByRole('button', { name: '确认举报' }));
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => mutation.resolve(jsonResponse({ application: { id: 9 } }, { status: 201 })));
    await waitFor(() => expect(screen.getByRole('button', { name: '收藏委托' })).toBeEnabled());
  });

  it('aborts a detail mutation and ignores its result after unmount', async () => {
    const mutation = deferred();
    fetch
      .mockResolvedValueOnce(jsonResponse({
        request: {
          id: 33, type: 'other', title: '卸载保护委托', description: '测试卸载。',
          city: '杭州', remote: false, expiresAt: '2030-01-01T00:00:00.000Z', owner: {},
        },
      }))
      .mockReturnValueOnce(mutation.promise);
    const user = userEvent.setup();
    const view = render(<RequestDetailPage requestId={33} session={{ verificationStatus: 'approved' }} onBack={() => {}} />);

    await screen.findByRole('heading', { name: '卸载保护委托' });
    await user.type(screen.getByLabelText('联系申请-给ta一个和你交换联系方式的理由'), '卸载前申请');
    await user.click(screen.getByRole('button', { name: '递出联系申请' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const mutationSignal = fetch.mock.calls[1][1].signal;

    view.unmount();
    expect(mutationSignal).toBeInstanceOf(AbortSignal);
    expect(mutationSignal.aborted).toBe(true);
    await act(async () => mutation.resolve(jsonResponse({ application: { id: 10 } }, { status: 201 })));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('announces detail mutation failures as alerts', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        request: {
          id: 34, type: 'other', title: '错误反馈委托', description: '测试错误。',
          city: '杭州', remote: false, expiresAt: '2030-01-01T00:00:00.000Z', owner: {},
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ error: '收藏失败' }, { status: 500 }));
    const user = userEvent.setup();
    render(<RequestDetailPage requestId={34} session={{ verificationStatus: 'approved' }} onBack={() => {}} />);

    await screen.findByRole('heading', { name: '错误反馈委托' });
    await user.click(screen.getByRole('button', { name: '收藏委托' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('收藏失败');
  });

  it('renders typed request details, trade images, and risk notices before contact actions', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      request: {
        id: 81,
        type: 'trade',
        title: '自家红薯礼盒',
        description: '物品：自家红薯礼盒；价格：68元一箱。',
        city: '杭州',
        remote: false,
        industry: null,
        budgetOrReward: null,
        expiresAt: '2030-01-01T00:00:00.000Z',
        details: {
          itemName: '自家红薯礼盒',
          price: '68元一箱',
          condition: '5斤装',
          deliveryMethod: '快递',
        },
        images: [
          { id: 1, url: '/uploads/request-images/a.png', mimeType: 'image/png', sizeBytes: 12, sortOrder: 0 },
        ],
        owner: { nickname: '七秀同门', verificationStatus: 'approved' },
      },
    }));

    render(<RequestDetailPage requestId={81} session={{ verificationStatus: 'approved' }} onBack={() => {}} />);

    expect(await screen.findByRole('heading', { name: '自家红薯礼盒' })).toBeVisible();
    expect(screen.getByText('物品/服务名称：自家红薯礼盒')).toBeVisible();
    expect(screen.getByText('价格或交换方式：68元一箱')).toBeVisible();
    expect(screen.getByLabelText('买卖交易图片')).toBeVisible();
    expect(screen.getByAltText('自家红薯礼盒 图片 1')).toBeVisible();
    expect(screen.getByText('请谨慎甄别委托信息，勿提前转账，谨防上当受骗。平台不提供交易担保。')).toBeVisible();
    expect(screen.getByText('涉及定金、代付、私下链接、异常低价时请提高警惕。万事屋不提供交易担保或售后仲裁。')).toBeVisible();
    expect(
      screen.getByText('请谨慎甄别委托信息，勿提前转账，谨防上当受骗。平台不提供交易担保。')
        .compareDocumentPosition(screen.getByLabelText('联系申请-给ta一个和你交换联系方式的理由')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows publishing boundaries and disables unverified submission', () => {
    render(<CreateRequestPage session={{ verificationStatus: 'pending' }} />);

    expect(screen.getByText(
      '万事屋不接账号交易、代练、外挂、私服相关委托，也不承诺求职或交易结果。',
    )).toBeVisible();
    expect(screen.getByRole('button', { name: '发布委托' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('请点击我的名片提交认证');
    expect(screen.getByRole('status')).toHaveClass('attention-copy');
    expect(screen.queryByText('匿名')).not.toBeInTheDocument();
  });

  it('offers exactly the six active request types', () => {
    render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    const options = within(screen.getByLabelText('类型')).getAllByRole('option');
    expect(options).toHaveLength(6);
    expect(options.map((option) => option.value)).toEqual([
      'job_referral',
      'industry_consulting',
      'trade',
      'commission',
      'local_help',
      'other',
    ]);
  });

  it('switches request types between dynamic fields and keeps optional extra notes', async () => {
    const user = userEvent.setup();
    render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    expect(screen.getByLabelText('目标岗位')).toBeVisible();
    expect(screen.getByLabelText('补充说明（选填）')).toBeVisible();

    await user.selectOptions(screen.getByLabelText('类型'), 'industry_consulting');
    expect(screen.getByLabelText('咨询方向')).toBeVisible();
    expect(screen.getByLabelText('具体问题')).toBeVisible();
    expect(screen.getByLabelText('期望交流方式')).toBeVisible();
    expect(screen.getByLabelText('补充说明（选填）')).toBeVisible();
    expect(screen.queryByLabelText('买卖交易图片')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('类型'), 'trade');
    expect(screen.getByLabelText('物品/服务名称')).toBeVisible();
    expect(screen.getByLabelText('价格或交换方式')).toBeVisible();
    expect(screen.getByLabelText('交易/发货方式')).toBeVisible();
    expect(screen.getByLabelText('买卖交易图片')).toBeVisible();
    expect(screen.getByLabelText('补充说明（选填）')).toBeVisible();
  });

  it('validates required publishing fields and the city or remote rule', async () => {
    const user = userEvent.setup();
    render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    await user.click(screen.getByRole('button', { name: '发布委托' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写标题。');
    expect(fetch).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('标题'), '远程简历建议');
    await user.click(screen.getByRole('button', { name: '发布委托' }));
    expect(screen.getByRole('alert')).toHaveTextContent('目标岗位为必填');
    expect(fetch).not.toHaveBeenCalled();

    fillDefaultJobReferralDetails();
    fireEvent.change(screen.getByLabelText('有效期'), { target: { value: '2030-01-02T10:30' } });
    await user.click(screen.getByRole('button', { name: '发布委托' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写城市，或选择可远程。');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks the create-request submit action as an explicit primary button', () => {
    const { container } = render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    expect(container.querySelector('button[type="submit"]')).toHaveClass('button-primary');
  });

  it('posts an approved remote request with a strict UTC expiry', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ request: { id: 41, status: 'pending' } }, { status: 201 }));
    const user = userEvent.setup();
    const localExpiry = '2030-01-02T10:30';
    render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    await user.selectOptions(screen.getByLabelText('类型'), 'industry_consulting');
    await user.type(screen.getByLabelText('标题'), '远程行业咨询');
    await user.type(screen.getByLabelText('咨询方向'), '游戏行业产品岗位');
    await user.type(screen.getByLabelText('具体问题'), '想了解日常分工和面试准备。');
    await user.type(screen.getByLabelText('期望交流方式'), '微信文字或语音');
    await user.click(screen.getByLabelText('可远程'));
    await user.type(screen.getByLabelText('补充说明（选填）'), '同门方便的话想先文字聊聊');
    fireEvent.change(screen.getByLabelText('有效期'), { target: { value: localExpiry } });
    await user.click(screen.getByRole('button', { name: '发布委托' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/requests',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    ));
    const requestBody = fetch.mock.calls[0][1].body;
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Content-Type');
    expect(requestBody.get('type')).toBe('industry_consulting');
    expect(requestBody.get('title')).toBe('远程行业咨询');
    expect(requestBody.get('city')).toBe('');
    expect(requestBody.get('remote')).toBe('true');
    expect(requestBody.get('expiresAt')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(JSON.parse(requestBody.get('details'))).toMatchObject({
      topic: '游戏行业产品岗位',
      questions: '想了解日常分工和面试准备。',
      preferredFormat: '微信文字或语音',
      extraNote: '同门方便的话想先文字聊聊',
    });
    expect(screen.getByRole('status')).toHaveTextContent('委托已送交掌柜审核。');
  });

  it('uses a synchronous lock to prevent same-tick duplicate request submissions', async () => {
    const submission = deferred();
    fetch.mockReturnValue(submission.promise);
    render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '同步锁测试' } });
    fillDefaultJobReferralDetails();
    fireEvent.click(screen.getByLabelText('可远程'));
    fireEvent.change(screen.getByLabelText('有效期'), { target: { value: '2030-02-03T12:00' } });
    const form = screen.getByRole('button', { name: '发布委托' }).closest('form');

    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => submission.resolve(jsonResponse({ request: { id: 43, status: 'pending' } }, { status: 201 })));
  });

  it('aborts create submission and ignores its result after unmount', async () => {
    const submission = deferred();
    fetch.mockReturnValueOnce(submission.promise);
    const view = render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '卸载保护测试' } });
    fillDefaultJobReferralDetails();
    fireEvent.click(screen.getByLabelText('可远程'));
    fireEvent.change(screen.getByLabelText('有效期'), { target: { value: '2030-02-03T12:00' } });
    fireEvent.submit(screen.getByRole('button', { name: '发布委托' }).closest('form'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const signal = fetch.mock.calls[0][1].signal;

    view.unmount();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(true);
    await act(async () => submission.resolve(jsonResponse({ request: { id: 44, status: 'pending' } }, { status: 201 })));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('allows an approved local request with a city and remote false', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ request: { id: 42, status: 'pending' } }, { status: 201 }));
    const user = userEvent.setup();
    render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    await user.type(screen.getByLabelText('标题'), '杭州线下拍摄协助');
    fillDefaultJobReferralDetails({ helpWanted: '需要一位周末能到场的摄影同好。' });
    await user.type(screen.getByLabelText('城市'), '杭州');
    fireEvent.change(screen.getByLabelText('有效期'), { target: { value: '2030-02-03T12:00' } });
    await user.click(screen.getByRole('button', { name: '发布委托' }));

    await waitFor(() => {
      const body = fetch.mock.calls[0][1].body;
      expect(body.get('city')).toBe('杭州');
      expect(body.get('remote')).toBe('false');
    });
  });

  it('shows trade image upload previews and supports removing images', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn((file) => `blob:${file.name}`);
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    await user.selectOptions(screen.getByLabelText('类型'), 'trade');
    const image = new File(['fake image'], 'sweet-potato.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('买卖交易图片'), image);

    expect(screen.getByAltText('sweet-potato.png')).toBeVisible();
    expect(createObjectURL).toHaveBeenCalledWith(image);
    await user.click(screen.getByRole('button', { name: '移除图片：sweet-potato.png' }));
    expect(screen.queryByAltText('sweet-potato.png')).not.toBeInTheDocument();
  });

  it('does not infer create feedback semantics from message text', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ error: '审核服务暂不可用' }, { status: 503 }));
    const user = userEvent.setup();
    render(<CreateRequestPage session={{ verificationStatus: 'approved' }} />);

    await user.type(screen.getByLabelText('标题'), '错误语义测试');
    fillDefaultJobReferralDetails({ helpWanted: '服务端错误必须是 alert。' });
    await user.click(screen.getByLabelText('可远程'));
    fireEvent.change(screen.getByLabelText('有效期'), { target: { value: '2030-02-03T12:00' } });
    await user.click(screen.getByRole('button', { name: '发布委托' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('审核服务暂不可用');
    expect(screen.queryByRole('status', { name: '审核服务暂不可用' })).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('联系方式')).toBeRequired();
    expect(screen.getByLabelText('游戏 ID/昵称')).toBeRequired();
    expect(screen.getByText('联系方式').querySelector('.required-mark')).toHaveTextContent('*');
    expect(screen.getByText('区服').querySelector('.required-mark')).toHaveTextContent('*');
    expect(screen.getByText('游戏 ID/昵称').querySelector('.required-mark')).toHaveTextContent('*');
    expect(screen.getByText('我们不会索要游戏账号密码')).toBeVisible();
  });

  it('marks the verification submit action as an explicit primary button', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      user: {},
      profile: {},
      verificationStatus: 'not_submitted',
      verification: { status: 'not_submitted' },
    }));
    const { container } = render(<ProfilePage onSessionRefresh={vi.fn()} />);

    await screen.findByRole('heading');
    expect(container.querySelector('button[type="submit"]')).toHaveClass('button-primary');
  });

  it('renders and submits every verification field using the backend response shape', async () => {
    const onSessionRefresh = vi.fn().mockResolvedValue(undefined);
    fetch.mockImplementation((path, options = {}) => {
      if (path === '/api/profile' && !options.method) {
        return Promise.resolve(jsonResponse({
          user: { nickname: '小七', city: '南京', contactValue: 'wx-old' },
          profile: {
            server: '梦江南', gameNickname: '秀秀', sect: '七秀', startedYear: 2016,
            industry: '教育', occupation: '老师', canOffer: '课程建议', lookingFor: '同行交流',
          },
          verificationStatus: 'not_submitted',
        }));
      }
      if (path === '/api/profile/verification') {
        return Promise.resolve(jsonResponse({ profile: {}, verificationStatus: 'pending' }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<ProfilePage onSessionRefresh={onSessionRefresh} />);

    const expectedValues = {
      '昵称': '小七', '城市': '南京', '联系方式': 'wx-old', '区服': '梦江南',
      '游戏 ID/昵称': '秀秀', '门派': '七秀', '入坑年份': 2016, '行业': '教育',
      '职业': '老师', '我能提供': '课程建议', '我在寻找': '同行交流', '一句话证明你玩过剑网3': '',
    };
    for (const [label, value] of Object.entries(expectedValues)) {
      expect(await screen.findByLabelText(label)).toHaveValue(value);
    }

    const nextValues = {
      nickname: '小七新名片', city: '苏州', contactValue: 'wx-new', server: '唯满侠',
      gameNickname: '秀水灵心', sect: '七秀', startedYear: '2018', industry: '游戏',
      occupation: '策划', canOffer: '产品建议', lookingFor: '行业交流', supportMaterial: '角色截图说明',
    };
    for (const [name, value] of Object.entries(nextValues)) {
      fireEvent.change(document.querySelector(`[name="${name}"]`), { target: { value } });
    }
    await user.click(screen.getByRole('button', { name: '提交身份认证' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/profile/verification',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ...nextValues, startedYear: 2018 }),
      }),
    ));
    expect(onSessionRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('认证资料已送交掌柜审核。');
  });

  it('prefills rejected verification data and preserves old support material on resubmit', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        user: { nickname: '小七', city: '南京', contactValue: 'wx-old' },
        profile: { server: '梦江南', gameNickname: '秀秀' },
        verificationStatus: 'rejected',
        verification: {
          status: 'rejected',
          supportMaterial: '旧角色截图说明',
          rejectReason: '截图中的区服信息不清晰',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ profile: {}, verificationStatus: 'pending' }));
    const user = userEvent.setup();
    render(<ProfilePage onSessionRefresh={vi.fn()} />);

    expect(await screen.findByLabelText('一句话证明你玩过剑网3')).toHaveValue('旧角色截图说明');
    expect(screen.getByText('认证未通过原因：截图中的区服信息不清晰')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '提交身份认证' }));

    await waitFor(() => {
      const submission = fetch.mock.calls.find(([path]) => path === '/api/profile/verification');
      expect(JSON.parse(submission[1].body).supportMaterial).toBe('旧角色截图说明');
    });
  });

  it('keeps only the newest profile load when an aborted response arrives late', async () => {
    const first = deferred();
    const second = deferred();
    fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<StrictMode><ProfilePage onSessionRefresh={vi.fn()} /></StrictMode>);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);

    await act(async () => second.resolve(jsonResponse({
      user: { nickname: '新名片', city: null, contactValue: null },
      profile: { server: '唯满侠', gameNickname: '新角色' },
      verificationStatus: 'approved',
      verification: { status: 'approved', supportMaterial: '新材料', rejectReason: null },
    })));
    expect(await screen.findByLabelText('昵称')).toHaveValue('新名片');

    await act(async () => first.resolve(jsonResponse({
      user: { nickname: '旧名片', city: null, contactValue: null },
      profile: { server: '旧区服', gameNickname: '旧角色' },
      verificationStatus: 'approved',
      verification: { status: 'approved', supportMaterial: '旧材料', rejectReason: null },
    })));
    expect(screen.getByLabelText('昵称')).toHaveValue('新名片');
    expect(screen.getByLabelText('一句话证明你玩过剑网3')).toHaveValue('新材料');
  });

  it('aborts profile submission and skips session refresh after unmount', async () => {
    const submission = deferred();
    const onSessionRefresh = vi.fn();
    fetch
      .mockResolvedValueOnce(jsonResponse({
        user: { nickname: '小七', city: null, contactValue: 'wx-old' },
        profile: { server: '梦江南', gameNickname: '秀秀' },
        verificationStatus: 'not_submitted',
        verification: { status: 'not_submitted', supportMaterial: null, rejectReason: null },
      }))
      .mockReturnValueOnce(submission.promise);
    const user = userEvent.setup();
    const view = render(<ProfilePage onSessionRefresh={onSessionRefresh} />);

    await screen.findByRole('button', { name: '提交身份认证' });
    await user.click(screen.getByRole('button', { name: '提交身份认证' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const submissionSignal = fetch.mock.calls[1][1].signal;

    view.unmount();
    expect(submissionSignal).toBeInstanceOf(AbortSignal);
    expect(submissionSignal.aborted).toBe(true);
    await act(async () => submission.resolve(jsonResponse({ profile: {}, verificationStatus: 'pending' })));
    expect(onSessionRefresh).not.toHaveBeenCalled();
  });

  it('announces profile submission failures as alerts', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        user: { nickname: '小七', city: null, contactValue: 'wx-old' },
        profile: { server: '梦江南', gameNickname: '秀秀' },
        verificationStatus: 'not_submitted',
      }))
      .mockResolvedValueOnce(jsonResponse({ error: '认证提交失败' }, { status: 500 }));
    const user = userEvent.setup();
    render(<ProfilePage onSessionRefresh={vi.fn()} />);

    await screen.findByRole('button', { name: '提交身份认证' });
    await user.click(screen.getByRole('button', { name: '提交身份认证' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('认证提交失败');
  });

  it.each(['not_submitted', 'rejected'])('allows verification submission in %s status', async (verificationStatus) => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        user: { nickname: '小七', city: null, contactValue: null },
        profile: { server: '', gameNickname: '' },
        verificationStatus,
      }))
      .mockResolvedValueOnce(jsonResponse({ profile: {}, verificationStatus: 'pending' }));
    const user = userEvent.setup();
    render(<ProfilePage onSessionRefresh={vi.fn()} />);

    expect(await screen.findByRole('button', { name: '提交身份认证' })).toBeEnabled();
    expect(screen.getByLabelText('区服')).toBeRequired();
    expect(screen.getByLabelText('联系方式')).toBeRequired();
    expect(screen.getByLabelText('游戏 ID/昵称')).toBeRequired();
    await user.click(screen.getByRole('button', { name: '提交身份认证' }));
    expect(fetch).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText('区服'), '梦江南');
    await user.type(screen.getByLabelText('联系方式'), 'wx-contact');
    await user.type(screen.getByLabelText('游戏 ID/昵称'), '秀秀');
    await user.click(screen.getByRole('button', { name: '提交身份认证' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/profile/verification',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it.each(['pending', 'approved'])('keeps verification read-only in %s status', async (verificationStatus) => {
    fetch.mockResolvedValueOnce(jsonResponse({
      user: { nickname: '小七', city: '南京', contactValue: 'wx-safe' },
      profile: { server: '梦江南', gameNickname: '秀秀' },
      verificationStatus,
    }));
    render(<ProfilePage onSessionRefresh={vi.fn()} />);

    expect(await screen.findByLabelText('区服')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('游戏 ID/昵称')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: '提交身份认证' })).not.toBeInTheDocument();
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
    await user.click(screen.getAllByRole('button', { name: '同意聊聊（交换联系方式）' })[0]);
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

  it('locks all contact decisions while one mutation is pending', async () => {
    const mutation = deferred();
    const applications = [
      { id: 61, direction: 'incoming', status: 'pending', requestTitle: '第一份申请', applicantNickname: '甲', message: '申请一' },
      { id: 62, direction: 'incoming', status: 'pending', requestTitle: '第二份申请', applicantNickname: '乙', message: '申请二' },
    ];
    fetch.mockResolvedValueOnce(jsonResponse({ applications })).mockReturnValueOnce(mutation.promise);
    const user = userEvent.setup();
    render(<ContactPage />);

    await screen.findByText('第一份申请');
    await user.click(screen.getAllByRole('button', { name: '同意聊聊（交换联系方式）' })[0]);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    for (const button of screen.getAllByRole('button', { name: /同意聊聊（交换联系方式）|暂不合适/ })) {
      expect(button).toBeDisabled();
    }
    fireEvent.click(screen.getAllByRole('button', { name: '暂不合适' })[1]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('aborts a contact mutation and does not reload after unmount', async () => {
    const mutation = deferred();
    fetch
      .mockResolvedValueOnce(jsonResponse({ applications: [
        { id: 63, direction: 'incoming', status: 'pending', requestTitle: '卸载申请', applicantNickname: '甲', message: '申请' },
      ] }))
      .mockReturnValueOnce(mutation.promise);
    const user = userEvent.setup();
    const view = render(<ContactPage />);

    await screen.findByText('卸载申请');
    await user.click(screen.getByRole('button', { name: '同意聊聊（交换联系方式）' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const mutationSignal = fetch.mock.calls[1][1].signal;

    view.unmount();
    expect(mutationSignal).toBeInstanceOf(AbortSignal);
    expect(mutationSignal.aborted).toBe(true);
    await act(async () => mutation.resolve(jsonResponse({ application: { id: 63, status: 'approved' } })));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps every contact decision disabled until the success reload completes', async () => {
    const reload = deferred();
    const applications = [
      { id: 64, direction: 'incoming', status: 'pending', requestTitle: '等待刷新甲', applicantNickname: '甲', message: '申请一' },
      { id: 65, direction: 'incoming', status: 'pending', requestTitle: '等待刷新乙', applicantNickname: '乙', message: '申请二' },
    ];
    fetch
      .mockResolvedValueOnce(jsonResponse({ applications }))
      .mockResolvedValueOnce(jsonResponse({ application: { id: 64, status: 'approved' } }))
      .mockReturnValueOnce(reload.promise);
    const user = userEvent.setup();
    render(<ContactPage />);

    await screen.findByText('等待刷新甲');
    await user.click(screen.getAllByRole('button', { name: '同意聊聊（交换联系方式）' })[0]);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    for (const button of screen.getAllByRole('button', { name: /同意聊聊（交换联系方式）|暂不合适/ })) {
      expect(button).toBeDisabled();
    }
    fireEvent.click(screen.getAllByRole('button', { name: '暂不合适' })[1]);
    expect(fetch).toHaveBeenCalledTimes(3);

    await act(async () => reload.resolve(jsonResponse({ applications })));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '暂不合适' })[1]).toBeEnabled());
  });

  it('prevents a late contact reload from replacing the newest list', async () => {
    const oldReload = deferred();
    const newReload = deferred();
    fetch.mockReturnValueOnce(oldReload.promise).mockReturnValueOnce(newReload.promise);
    render(<StrictMode><ContactPage /></StrictMode>);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => newReload.resolve(jsonResponse({ applications: [
      { id: 73, direction: 'incoming', status: 'pending', requestTitle: '最新申请', applicantNickname: '丙', message: '新' },
    ] })));
    expect(await screen.findByText('最新申请')).toBeVisible();

    await act(async () => oldReload.resolve(jsonResponse({ applications: [
      { id: 74, direction: 'incoming', status: 'pending', requestTitle: '过期列表', applicantNickname: '丁', message: '旧' },
    ] })));
    expect(screen.getByText('最新申请')).toBeVisible();
    expect(screen.queryByText('过期列表')).not.toBeInTheDocument();
  });

  it('announces contact mutation failures as alerts', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ applications: [
        { id: 81, direction: 'incoming', status: 'pending', requestTitle: '错误申请', applicantNickname: '甲', message: '申请' },
      ] }))
      .mockResolvedValueOnce(jsonResponse({ error: '处理申请失败' }, { status: 500 }));
    const user = userEvent.setup();
    render(<ContactPage />);

    await screen.findByText('错误申请');
    await user.click(screen.getByRole('button', { name: '同意聊聊（交换联系方式）' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('处理申请失败');
  });

  it('sends channel, sort, and encoded feed filters', async () => {
    const requests = [
      { id: 1, type: 'other', title: '最新普通委托', createdAt: '2026-07-03T12:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z', remote: false, city: '杭州', owner: {} },
      { id: 2, type: 'job_referral', title: '较早内推', createdAt: '2026-07-01T12:00:00.000Z', expiresAt: '2030-01-01T00:00:00.000Z', remote: true, city: null, owner: {} },
      {
        id: 3, type: 'industry_consulting', title: '较新咨询', createdAt: '2026-07-02T12:00:00.000Z',
        expiresAt: '2030-01-01T00:00:00.000Z', remote: true, city: '上海', industry: '游戏',
        owner: {
          nickname: '万花同门', server: '唯满侠', sect: '万花', startedYear: 2011,
          city: '成都', industry: '互联网', verificationStatus: 'approved',
        },
      },
    ];
    fetch.mockResolvedValue(jsonResponse({ requests }));
    render(<FeedPage onSelectRequest={() => {}} />);

    expect(await screen.findByRole('heading', { name: '万事广场' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: '查看委托' })).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'industry_consulting' } });
    fireEvent.change(screen.getByLabelText('城市'), { target: { value: '上海 浦东' } });
    fireEvent.change(screen.getByLabelText('行业'), { target: { value: '游戏&互联网' } });
    fireEvent.change(screen.getByLabelText('远程方式'), { target: { value: 'true' } });
    await waitFor(() => {
      const lastUrl = fetch.mock.calls.at(-1)[0];
      expect(lastUrl).toContain('type=industry_consulting');
      expect(lastUrl).toContain('channel=recommended');
      expect(lastUrl).toContain('sort=recommended');
      expect(lastUrl).toContain('city=%E4%B8%8A%E6%B5%B7+%E6%B5%A6%E4%B8%9C');
      expect(lastUrl).toContain('industry=%E6%B8%B8%E6%88%8F%26%E4%BA%92%E8%81%94%E7%BD%91');
      expect(lastUrl).toContain('remote=true');
    });
  });

  it('keeps Latest channel sort selection aligned with its effective query', async () => {
    fetch.mockImplementation(() => Promise.resolve(jsonResponse({ requests: [] })));
    const user = userEvent.setup();
    render(<FeedPage onSelectRequest={() => {}} />);

    await screen.findByRole('heading', { name: '万事广场' });
    await user.click(within(screen.getByRole('group', { name: '万事广场频道' }))
      .getByRole('button', { name: '最新' }));

    const sorts = within(screen.getByRole('group', { name: '委托排序' }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      '/api/requests?channel=latest&sort=recommended',
      expect.any(Object),
    ));
    expect(sorts.getByRole('button', { name: '推荐' })).toHaveClass('button-primary');

    await user.click(sorts.getByRole('button', { name: '最新' }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      '/api/requests?channel=latest&sort=latest',
      expect.any(Object),
    ));
    expect(sorts.getByRole('button', { name: '最新' })).toHaveClass('button-primary');

    await user.click(sorts.getByRole('button', { name: '推荐' }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      '/api/requests?channel=latest&sort=recommended',
      expect.any(Object),
    ));
    expect(sorts.getByRole('button', { name: '推荐' })).toHaveClass('button-primary');
  });

  it('renders feed channels, typed card facts, and heart counts without forbidden copy', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      requests: [{
        id: 501,
        ownerId: 10,
        type: 'job_referral',
        title: '前端岗位内推',
        details: {
          targetRole: '前端工程师',
          targetIndustry: '互联网',
          helpWanted: '希望获得内推和简历建议',
        },
        city: '杭州',
        remote: true,
        industry: '互联网',
        expiresAt: '2030-01-01T00:00:00.000Z',
        reactionCount: 7,
        reactedByMe: false,
        owner: {
          nickname: '七秀同门',
          server: '梦江南',
          sect: '七秀',
          city: '杭州',
          verificationStatus: 'approved',
        },
      }],
      meta: {},
    }));

    render(<FeedPage onSelectRequest={() => {}} />);

    expect(await screen.findByRole('heading', { name: '万事广场' })).toBeVisible();
    const channels = within(screen.getByRole('group', { name: '万事广场频道' }));
    for (const channel of ['推荐', '最新', '同城', '求职内推', '行业咨询', '买卖交易']) {
      expect(channels.getByRole('button', { name: channel })).toBeVisible();
    }
    expect(screen.getByText('目标岗位').parentElement).toHaveTextContent('目标岗位前端工程师');
    expect(screen.getByText('目标行业').parentElement).toHaveTextContent('目标行业互联网');
    expect(screen.getByText('杭州 / 可远程')).toBeVisible();
    expect(screen.getByRole('button', { name: '点亮心形：前端岗位内推，当前 7' })).toBeVisible();
    expect(screen.queryByText('点赞')).not.toBeInTheDocument();
  });

  it('requests channels and optimistically toggles heart state with rollback on failure', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        requests: [{
          id: 502,
          ownerId: 10,
          type: 'trade',
          title: '自家红薯礼盒',
          details: {
            price: '68 元一箱',
            deliveryMethod: '快递',
          },
          images: [{ id: 1, url: '/uploads/request-images/a.png', sortOrder: 0 }],
          city: '成都',
          remote: false,
          expiresAt: '2030-01-01T00:00:00.000Z',
          reactionCount: 1,
          reactedByMe: false,
          owner: { nickname: '万花同门', verificationStatus: 'approved' },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        requests: [],
        meta: {},
      }));
    const user = userEvent.setup();

    render(<FeedPage onSelectRequest={() => {}} />);

    await user.click(await screen.findByRole('button', { name: '买卖交易' }));
    await waitFor(() => expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/requests?channel=trade&sort=recommended',
      expect.any(Object),
    ));

    await screen.findByText('暂时没有符合条件的委托。');

    fetch.mockResolvedValueOnce(jsonResponse({
      requests: [{
        id: 502,
        ownerId: 10,
        type: 'trade',
        title: '自家红薯礼盒',
        details: {
          price: '68 元一箱',
          deliveryMethod: '快递',
        },
        images: [{ id: 1, url: '/uploads/request-images/a.png', sortOrder: 0 }],
        city: '成都',
        remote: false,
        expiresAt: '2030-01-01T00:00:00.000Z',
        reactionCount: 1,
        reactedByMe: false,
        owner: { nickname: '万花同门', verificationStatus: 'approved' },
      }],
    }));
    await user.click(within(screen.getByRole('group', { name: '万事广场频道' })).getByRole('button', { name: '推荐' }));
    const heart = await screen.findByRole('button', {
      name: '点亮心形：自家红薯礼盒，当前 1',
    });
    const postReaction = deferred();
    fetch.mockReturnValueOnce(postReaction.promise);
    await user.click(heart);

    expect(screen.getByRole('button', {
      name: '取消心形：自家红薯礼盒，当前 2',
    })).toBeDisabled();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/requests/502/reaction',
      expect.objectContaining({ method: 'POST' }),
    );

    await act(async () => postReaction.resolve(jsonResponse({
      reactedByMe: true,
      reactionCount: 2,
    })));

    const activeHeart = await screen.findByRole('button', {
      name: '取消心形：自家红薯礼盒，当前 2',
    });
    const deleteReaction = deferred();
    fetch.mockReturnValueOnce(deleteReaction.promise);
    await user.click(activeHeart);

    expect(screen.getByRole('button', {
      name: '点亮心形：自家红薯礼盒，当前 1',
    })).toBeDisabled();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/requests/502/reaction',
      expect.objectContaining({ method: 'DELETE' }),
    );
    await act(async () => deleteReaction.reject(new Error('network down')));

    expect(await screen.findByRole('button', {
      name: '取消心形：自家红薯礼盒，当前 2',
    })).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
  });

  it('shows typed feed facts and covers', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      requests: [
        {
          id: 51,
          type: 'trade',
          title: '自家红薯礼盒',
          details: { price: '68元一箱', deliveryMethod: '快递' },
          createdAt: '2026-07-04T12:00:00.000Z',
          expiresAt: '2030-01-01T00:00:00.000Z',
          remote: false,
          city: '杭州',
          industry: '农副产品',
          images: [{ id: 1, url: '/uploads/request-images/a.png' }],
          owner: {},
        },
        {
          id: 52,
          type: 'job_referral',
          title: '前端岗位内推',
          details: { targetRole: '前端工程师' },
          createdAt: '2026-07-03T12:00:00.000Z',
          expiresAt: '2030-01-01T00:00:00.000Z',
          remote: true,
          city: null,
          industry: '互联网',
          owner: {},
        },
      ],
    }));

    render(<FeedPage onSelectRequest={() => {}} />);

    expect((await screen.findByText('价格/交换')).parentElement).toHaveTextContent('价格/交换68元一箱');
    expect(screen.getByText('目标岗位').parentElement).toHaveTextContent('目标岗位前端工程师');
    expect(screen.getByAltText('自家红薯礼盒 封面图')).toHaveClass('request-card-cover');
    expect(screen.getByText('目标行业').parentElement).toHaveTextContent('目标行业互联网');
    expect(screen.queryByText('行业：农副产品')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('类型')).getAllByRole('option')).toHaveLength(7);
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

describe('admin review pages', () => {
  const verification = {
    id: 31,
    contactValue: 'wx-qixiu',
    userId: 7,
    status: 'pending',
    supportMaterial: '工作证与游戏截图',
    rejectReason: null,
    user: {
      id: 7,
      account: 'qixiu-admin-review',
      nickname: '七秀同门',
      city: '杭州',
      status: 'active',
    },
    profile: {
      server: '梦江南',
      gameNickname: '秀秀',
      sect: '七秀',
      startedYear: 2012,
      industry: '互联网',
      occupation: '产品经理',
    },
  };
  const reviewedRequest = {
    id: 41,
    ownerId: 7,
    type: 'industry_consulting',
    title: '行业咨询委托',
    description: '想了解产品岗位。',
    city: '上海',
    remote: true,
    industry: '互联网',
    budgetOrReward: '一杯奶茶',
    expiresAt: '2099-12-31T23:59:59.000Z',
    status: 'pending',
    rejectReason: null,
    takedownReason: null,
    owner: {
      nickname: '七秀同门',
      server: '梦江南',
      gameNickname: '秀秀',
      sect: '七秀',
      startedYear: 2012,
      city: '杭州',
      industry: '互联网',
      occupation: '产品经理',
      verificationStatus: 'approved',
    },
  };
  const adminUsers = [
    {
      id: 1, nickname: '掌柜', city: '杭州', role: 'admin', status: 'active',
      verificationStatus: 'approved', server: '梦江南', gameNickname: '掌柜号',
      sect: '万花', startedYear: 2009, industry: '社区', occupation: '管理员',
      contactValue: 'must-not-render', passwordHash: 'must-not-render', openid: 'must-not-render',
    },
    {
      id: 7, nickname: '七秀同门', city: '成都', role: 'user', status: 'active',
      verificationStatus: 'approved', server: '梦江南', gameNickname: '秀秀',
      sect: '七秀', startedYear: 2012, industry: '互联网', occupation: '产品经理',
      canOffer: '行业经验', lookingFor: '同门交流',
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('loads pending verification details and enforces approve/reject request contracts', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ verifications: [verification] }))
      .mockResolvedValueOnce(jsonResponse({ verification: { ...verification, status: 'approved' } }))
      .mockResolvedValueOnce(jsonResponse({ verifications: [] }));
    const user = userEvent.setup();
    render(<AdminVerifications />);

    const verificationTable = await screen.findByRole('table', { name: '认证审核列表' });
    for (const value of ['七秀同门', '杭州', '梦江南', '秀秀', '七秀', '2012', '互联网', '产品经理']) {
      expect(verificationTable).toHaveTextContent(value);
    }
    expect(verificationTable).toHaveTextContent('账号：qixiu-admin-review');
    expect(verificationTable).toHaveTextContent('联系方式：wx-qixiu');
    expect(verificationTable).toHaveTextContent('工作证与游戏截图');
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/admin/verifications?status=pending', expect.any(Object));
    expect(screen.getByRole('button', { name: '拒绝认证' })).toBeDisabled();
    await user.type(screen.getByLabelText('认证拒绝理由'), '材料无法核验');
    expect(screen.getByRole('button', { name: '拒绝认证' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '通过认证' }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/verifications/7/approve', expect.objectContaining({
      method: 'POST',
    }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('status')).toHaveTextContent('认证审核已更新');
  });

  it('sends a trimmed verification rejection reason and reloads before unlocking', async () => {
    const reload = deferred();
    fetch
      .mockResolvedValueOnce(jsonResponse({ verifications: [verification] }))
      .mockResolvedValueOnce(jsonResponse({ verification: { ...verification, status: 'rejected' } }))
      .mockReturnValueOnce(reload.promise);
    const user = userEvent.setup();
    render(<AdminVerifications />);

    await screen.findByRole('table', { name: '认证审核列表' });
    await user.type(screen.getByLabelText('认证拒绝理由'), '  材料不足  ');
    await user.click(screen.getByRole('button', { name: '拒绝认证' }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/verifications/7/reject', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ reason: '材料不足' }),
    }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('button', { name: '拒绝认证' })).toBeDisabled();

    await act(async () => reload.resolve(jsonResponse({ verifications: [] })));
    expect(await screen.findByRole('status')).toHaveTextContent('认证审核已更新');
  });

  it('filters requests and supports approve, reject, and takedown reason gates', async () => {
    const approved = { ...reviewedRequest, id: 42, title: '已发布委托', status: 'approved' };
    fetch.mockImplementation(() => Promise.resolve(jsonResponse({ requests: [reviewedRequest, approved] })));
    const user = userEvent.setup();
    render(<AdminRequests />);

    await screen.findByRole('table', { name: '委托审核列表' });
    expect(screen.queryByText(/wx-|联系方式/)).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('委托状态')).getByRole('option', { name: '草稿' })).toHaveValue('draft');
    await user.selectOptions(screen.getByLabelText('委托状态'), 'pending');
    await user.selectOptions(screen.getByLabelText('委托类型'), 'industry_consulting');
    await user.type(screen.getByLabelText('委托城市'), '上海 浦东');
    await user.type(screen.getByLabelText('委托行业'), '游戏&互联网');
    await user.selectOptions(screen.getByLabelText('是否过期'), 'false');
    await user.click(screen.getByRole('button', { name: '筛选委托' }));
    await waitFor(() => expect(fetch.mock.calls.at(-1)[0]).toBe(
      '/api/admin/requests?status=pending&type=industry_consulting&city=%E4%B8%8A%E6%B5%B7+%E6%B5%A6%E4%B8%9C&industry=%E6%B8%B8%E6%88%8F%26%E4%BA%92%E8%81%94%E7%BD%91&expired=false',
    ));

    expect(screen.getByRole('button', { name: '拒绝委托' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下架委托' })).toBeDisabled();
    await user.type(screen.getByLabelText('委托 41 拒绝理由'), '范围不合适');
    await user.type(screen.getByLabelText('委托 42 下架理由'), '信息已失效');
    expect(screen.getByRole('button', { name: '拒绝委托' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下架委托' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '通过委托' })).toBeEnabled();
  });

  it('shows withdrawn and closed request statuses in the admin filter and list', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      requests: [{ ...reviewedRequest, status: 'closed' }],
    }));

    render(<AdminRequests />);

    await screen.findByRole('table', { name: '委托审核列表' });
    const statusFilter = screen.getByLabelText('委托状态');
    expect(within(statusFilter).getByRole('option', { name: '已撤回' })).toHaveValue('withdrawn');
    expect(within(statusFilter).getByRole('option', { name: '已关闭' })).toHaveValue('closed');
    expect(screen.getByText('已关闭', { selector: '.status-badge' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '通过委托' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下架委托' })).not.toBeInTheDocument();
  });

  it('hard deletes an admin request after confirmation text is entered', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ requests: [{ ...reviewedRequest, status: 'closed' }] }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }))
      .mockResolvedValueOnce(jsonResponse({ requests: [] }))
      .mockResolvedValueOnce(jsonResponse({ requests: [] }));
    const user = userEvent.setup();

    render(<AdminRequests />);

    await screen.findByRole('table', { name: '委托审核列表' });
    const confirmInput = screen.getByLabelText('委托 41 彻底删除确认');
    expect(screen.getByRole('button', { name: '彻底删除委托' })).toBeDisabled();
    await user.type(confirmInput, '彻底删除');
    await user.click(screen.getByRole('button', { name: '彻底删除委托' }));

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/admin/requests/41',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('uses page-specific admin table classes and explicit action button variants', async () => {
    const approved = { ...reviewedRequest, id: 42, status: 'approved' };
    fetch.mockImplementation(() => Promise.resolve(jsonResponse({ requests: [reviewedRequest, approved] })));
    const { container } = render(<AdminRequests />);

    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    expect(container.querySelector('table')).toHaveClass('admin-table', 'admin-table-requests');
    expect(container.querySelector('.admin-filters button[type="submit"]')).toHaveClass('button-primary');
    expect(container.querySelector('.admin-actions button')).toHaveClass('button-primary');

    const actionButtons = [...container.querySelectorAll('.admin-actions button')];
    expect(actionButtons.filter((button) => button.classList.contains('button-danger'))).toHaveLength(4);
  });

  it('renders admin typed detail summaries and trade image thumbnails', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({
      requests: [{
        ...reviewedRequest,
        id: 82,
        type: 'trade',
        title: '自家红薯礼盒',
        description: '物品：自家红薯礼盒；价格：68元一箱。',
        details: {
          itemName: '自家红薯礼盒',
          price: '68元一箱',
          condition: '5斤装',
          deliveryMethod: '快递',
        },
        images: [
          { id: 1, url: '/uploads/request-images/a.png', mimeType: 'image/png', sizeBytes: 12, sortOrder: 0 },
        ],
      }],
    }));

    render(<AdminRequests />);

    expect(await screen.findByText('物品/服务名称：自家红薯礼盒')).toBeVisible();
    expect(screen.getByText('价格或交换方式：68元一箱')).toBeVisible();
    expect(screen.getByAltText('委托 82 图片 1')).toBeVisible();
  });

  it.each([
    ['通过委托', '/api/admin/requests/41/approve', undefined],
    ['拒绝委托', '/api/admin/requests/41/reject', { reason: '范围不合适' }],
    ['下架委托', '/api/admin/requests/42/takedown', { reason: '信息已失效' }],
  ])('sends the %s mutation and refreshes the request list', async (buttonName, path, body) => {
    const approved = { ...reviewedRequest, id: 42, title: '已发布委托', status: 'approved' };
    fetch
      .mockResolvedValueOnce(jsonResponse({ requests: [reviewedRequest, approved] }))
      .mockResolvedValueOnce(jsonResponse({ request: reviewedRequest }))
      .mockResolvedValueOnce(jsonResponse({ requests: [] }))
      .mockResolvedValueOnce(jsonResponse({ requests: [] }));
    const user = userEvent.setup();
    render(<AdminRequests />);

    await screen.findByRole('table', { name: '委托审核列表' });
    if (buttonName === '拒绝委托') await user.type(screen.getByLabelText('委托 41 拒绝理由'), body.reason);
    if (buttonName === '下架委托') await user.type(screen.getByLabelText('委托 42 下架理由'), body.reason);
    await user.click(screen.getByRole('button', { name: buttonName }));
    expect(fetch).toHaveBeenNthCalledWith(2, path, expect.objectContaining({
      method: 'POST',
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  });

  it('uses all six user filters, hides sensitive fields, and prevents self-disable', async () => {
    fetch.mockImplementation(() => Promise.resolve(jsonResponse({ users: adminUsers })));
    const user = userEvent.setup();
    render(<AdminUsers currentUser={{ id: 1, role: 'admin' }} />);

    await screen.findByRole('table', { name: '安全用户列表' });
    for (const secret of ['must-not-render']) expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('用户认证状态')).getByRole('option', { name: '未提交' })).toHaveValue('not_submitted');
    expect(screen.getByText('当前管理员')).toBeVisible();
    expect(screen.getByRole('button', { name: '禁用用户：七秀同门' })).toBeEnabled();
    await user.type(screen.getByLabelText('用户昵称'), '七秀');
    await user.type(screen.getByLabelText('用户区服'), '梦江南');
    await user.type(screen.getByLabelText('用户城市'), '成都');
    await user.type(screen.getByLabelText('用户行业'), '互联网');
    await user.selectOptions(screen.getByLabelText('用户认证状态'), 'approved');
    await user.selectOptions(screen.getByLabelText('用户状态'), 'active');
    await user.click(screen.getByRole('button', { name: '筛选用户' }));
    await waitFor(() => expect(fetch.mock.calls.at(-1)[0]).toBe(
      '/api/admin/users?nickname=%E4%B8%83%E7%A7%80&server=%E6%A2%A6%E6%B1%9F%E5%8D%97&city=%E6%88%90%E9%83%BD&industry=%E4%BA%92%E8%81%94%E7%BD%91&verificationStatus=approved&status=active',
    ));
  });

  it('disables another user and presents a friendly 409 conflict', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ users: adminUsers }))
      .mockResolvedValueOnce(jsonResponse({ error: 'User is already disabled' }, { status: 409 }));
    const user = userEvent.setup();
    render(<AdminUsers currentUser={{ id: 1, role: 'admin' }} />);

    await user.click(await screen.findByRole('button', { name: '禁用用户：七秀同门' }));
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/admin/users/7/disable', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('用户状态已变化，请刷新后重试');
  });

  it('hides the disable action for admin users and keeps it row-specific for members', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ users: adminUsers }));
    render(<AdminUsers currentUser={{ id: 1, role: 'admin' }} />);

    await screen.findByRole('table', { name: '安全用户列表' });
    expect(screen.queryByRole('button', { name: '禁用用户：掌柜' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '禁用用户：七秀同门' })).toBeEnabled();
  });

  it('uses page-specific classes for verification and user review tables', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ verifications: [verification] }))
      .mockResolvedValueOnce(jsonResponse({ users: adminUsers }));
    const { container, rerender } = render(<AdminVerifications />);

    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    expect(container.querySelector('table')).toHaveClass('admin-table', 'admin-table-verifications');
    expect(container.querySelector('.admin-filters button[type="submit"]')).toHaveClass('button-primary');
    expect(container.querySelector('.admin-actions button')).toHaveClass('button-primary');
    expect(container.querySelectorAll('.admin-actions button')[1]).toHaveClass('button-danger');

    rerender(<AdminUsers currentUser={{ id: 1, role: 'admin' }} />);
    await waitFor(() => expect(container.querySelector('table')).not.toBeNull());
    expect(container.querySelector('table')).toHaveClass('admin-table', 'admin-table-users');
    expect(container.querySelector('.admin-filters button[type="submit"]')).toHaveClass('button-primary');
    expect(container.querySelector('tbody button')).toHaveClass('button-danger');
  });

  it('lazy-loads admin tabs and preserves visited tab state across navigation', async () => {
    fetch.mockImplementation((path) => {
      if (path.startsWith('/api/admin/verifications')) return Promise.resolve(jsonResponse({ verifications: [verification] }));
      if (path.startsWith('/api/admin/requests')) return Promise.resolve(jsonResponse({ requests: [reviewedRequest] }));
      if (path.startsWith('/api/admin/users')) return Promise.resolve(jsonResponse({ users: adminUsers }));
      throw new Error(`Unexpected request: ${path}`);
    });
    const user = userEvent.setup();
    render(<AdminDashboard currentUser={{ id: 1, role: 'admin' }} onLogout={() => {}} />);

    expect(await screen.findByText('待审认证 1')).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/admin/verifications?status=pending', expect.any(Object));
    for (const tab of ['认证审核', '委托审核', '用户列表']) expect(screen.getByRole('button', { name: tab })).toBeVisible();
    expect(screen.queryByRole('button', { name: '待掌柜审核' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '委托审核' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await user.type(screen.getByLabelText('委托城市'), '苏州');
    await user.click(screen.getByRole('button', { name: '用户列表' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await user.click(screen.getByRole('button', { name: '委托审核' }));
    expect(screen.getByLabelText('委托城市')).toHaveValue('苏州');
  });

  it('refreshes the pending request summary after a mutation even when a filter is active', async () => {
    const onSummaryChange = vi.fn();
    fetch
      .mockResolvedValueOnce(jsonResponse({
        requests: [
          reviewedRequest,
          { ...reviewedRequest, id: 42, title: '第二条待审单' },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ requests: [reviewedRequest] }))
      .mockResolvedValueOnce(jsonResponse({ request: { ...reviewedRequest, status: 'approved' } }))
      .mockResolvedValueOnce(jsonResponse({ requests: [] }))
      .mockResolvedValueOnce(jsonResponse({
        requests: [{ ...reviewedRequest, id: 42, title: '第二条待审单' }],
      }));
    const user = userEvent.setup();
    render(<AdminRequests onSummaryChange={onSummaryChange} />);

    await screen.findByRole('table', { name: '委托审核列表' });
    expect(onSummaryChange).toHaveBeenLastCalledWith(2);
    await user.type(screen.getByLabelText('委托城市'), '上海');
    await user.click(screen.getByRole('button', { name: '筛选委托' }));
    await waitFor(() => expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/admin/requests?city=%E4%B8%8A%E6%B5%B7',
      expect.any(Object),
    ));

    await user.click(screen.getByRole('button', { name: '通过委托' }));
    await waitFor(() => expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/api/admin/requests/41/approve',
      expect.objectContaining({ method: 'POST' }),
    ));
    await waitFor(() => expect(fetch).toHaveBeenNthCalledWith(
      5,
      '/api/admin/requests?status=pending',
      expect.any(Object),
    ));
    expect(onSummaryChange).toHaveBeenLastCalledWith(1);
  });

  it('aborts an admin mutation on unmount and never starts the success refresh', async () => {
    const mutation = deferred();
    fetch
      .mockResolvedValueOnce(jsonResponse({ verifications: [verification] }))
      .mockReturnValueOnce(mutation.promise);
    const user = userEvent.setup();
    const view = render(<AdminVerifications />);

    await user.click(await screen.findByRole('button', { name: '通过认证' }));
    const signal = fetch.mock.calls[1][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => mutation.resolve(jsonResponse({ verification: { ...verification, status: 'approved' } })));
    expect(fetch).toHaveBeenCalledTimes(2);
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
    expect(fetch).toHaveBeenNthCalledWith(
      5,
      '/api/requests?channel=recommended&sort=recommended',
      expect.any(Object),
    );
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
