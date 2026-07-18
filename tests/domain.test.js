import {
  APPLICATION_STATUSES,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  VERIFICATION_STATUSES,
  canApplyContact,
  canPublishRequest,
  canSeeContact,
  isActiveVerifiedUser,
  isAdmin,
} from '../server/domain.js';
import {
  applicationStatusLabels,
  profileLabels,
  requestStatusLabels,
  requestTypes,
  verificationLabels,
} from '../src/domain/constants.js';

describe('domain constants', () => {
  it('defines request types and their labels', () => {
    expect(REQUEST_TYPES).toEqual({
      job_referral: '求职内推',
      industry_consulting: '行业咨询',
      trade: '买卖交易',
      commission: '约稿委托',
      local_help: '本地互助',
      other: '其他',
    });
    expect(requestTypes).toEqual([
      { value: 'job_referral', label: '求职内推' },
      { value: 'industry_consulting', label: '行业咨询' },
      { value: 'trade', label: '买卖交易' },
      { value: 'commission', label: '约稿委托' },
      { value: 'local_help', label: '本地互助' },
      { value: 'other', label: '其他' },
    ]);
  });

  it('defines verification, request, and application statuses', () => {
    expect(VERIFICATION_STATUSES).toEqual([
      'not_submitted',
      'pending',
      'approved',
      'rejected',
    ]);
    expect(REQUEST_STATUSES).toEqual([
      'draft',
      'pending',
      'approved',
      'rejected',
      'taken_down',
      'expired',
      'withdrawn',
      'closed',
    ]);
    expect(APPLICATION_STATUSES).toEqual(['pending', 'approved', 'rejected']);
  });

  it('provides clear status and profile labels without the retired profile copy', () => {
    expect(verificationLabels).toEqual({
      not_submitted: '未提交认证',
      pending: '待掌柜审核',
      approved: '已确认番薯身份',
      rejected: '认证未通过',
    });
    expect(requestStatusLabels).toEqual({
      draft: '草稿',
      pending: '待审核',
      approved: '已发布',
      rejected: '未通过',
      taken_down: '已下架',
      expired: '已过期',
      withdrawn: '已撤回',
      closed: '已关闭',
    });
    expect(applicationStatusLabels).toEqual({
      pending: '待确认',
      approved: '已通过',
      rejected: '暂不合适',
    });
    expect(profileLabels).toEqual({ title: '我的名片' });

    const retiredProfileCopy = ['我的', '番薯名片'].join('');
    const allLabels = JSON.stringify({
      requestTypes,
      verificationLabels,
      requestStatusLabels,
      applicationStatusLabels,
      profileLabels,
    });
    expect(allLabels).not.toContain(retiredProfileCopy);
  });
});

describe('user permissions', () => {
  const approvedUser = {
    id: 1,
    status: 'active',
    verificationStatus: 'approved',
    role: 'user',
  };

  it.each([
    ['unauthenticated', null],
    [
      'not submitted',
      { ...approvedUser, verificationStatus: 'not_submitted' },
    ],
    ['pending', { ...approvedUser, verificationStatus: 'pending' }],
    ['rejected', { ...approvedUser, verificationStatus: 'rejected' }],
    ['disabled', { ...approvedUser, status: 'disabled' }],
  ])('blocks %s users from publishing or applying', (_label, user) => {
    expect(isActiveVerifiedUser(user)).toBe(false);
    expect(canPublishRequest(user)).toBe(false);
    expect(canApplyContact(user)).toBe(false);
  });

  it('allows active approved users to publish and apply', () => {
    expect(isActiveVerifiedUser(approvedUser)).toBe(true);
    expect(canPublishRequest(approvedUser)).toBe(true);
    expect(canApplyContact(approvedUser)).toBe(true);
  });

  it('recognizes only active admins', () => {
    expect(isAdmin({ status: 'active', role: 'admin' })).toBe(true);
    expect(isAdmin({ status: 'disabled', role: 'admin' })).toBe(false);
    expect(isAdmin({ status: 'active', role: 'user' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});

describe('contact visibility', () => {
  const approvedApplication = {
    status: 'approved',
    applicantId: 11,
    ownerId: 22,
  };

  it('allows the applicant and owner to see contact details after approval', () => {
    expect(canSeeContact({ id: 11, status: 'active' }, approvedApplication)).toBe(
      true,
    );
    expect(canSeeContact({ id: 22, status: 'active' }, approvedApplication)).toBe(
      true,
    );
  });

  it.each(['pending', 'rejected'])(
    'hides contact details while an application is %s',
    (status) => {
      const application = { ...approvedApplication, status };
      expect(canSeeContact({ id: 11, status: 'active' }, application)).toBe(
        false,
      );
      expect(canSeeContact({ id: 22, status: 'active' }, application)).toBe(
        false,
      );
    },
  );

  it('hides contact details from unauthenticated and unrelated users', () => {
    expect(canSeeContact(null, approvedApplication)).toBe(false);
    expect(canSeeContact({ id: 33, status: 'active' }, approvedApplication)).toBe(
      false,
    );
    expect(canSeeContact({ id: 11, status: 'active' }, null)).toBe(false);
  });

  it.each([
    ['a missing user ID', { status: 'active' }, approvedApplication],
    [
      'a null user and applicant ID',
      { id: null, status: 'active' },
      { ...approvedApplication, applicantId: null },
    ],
    [
      'a missing applicant ID',
      { id: 22, status: 'active' },
      { status: 'approved', ownerId: 22 },
    ],
    [
      'a null applicant ID',
      { id: 22, status: 'active' },
      { ...approvedApplication, applicantId: null },
    ],
    [
      'a missing owner ID',
      { id: 11, status: 'active' },
      { status: 'approved', applicantId: 11 },
    ],
    [
      'a null owner ID',
      { id: 11, status: 'active' },
      { ...approvedApplication, ownerId: null },
    ],
    [
      'a disabled applicant',
      { id: 11, status: 'disabled' },
      approvedApplication,
    ],
    [
      'mixed numeric and string IDs',
      { id: 22, status: 'active' },
      { ...approvedApplication, applicantId: '11' },
    ],
    [
      'a zero user and applicant ID',
      { id: 0, status: 'active' },
      { ...approvedApplication, applicantId: 0 },
    ],
    [
      'a negative user and applicant ID',
      { id: -1, status: 'active' },
      { ...approvedApplication, applicantId: -1 },
    ],
    [
      'a fractional user and applicant ID',
      { id: 1.5, status: 'active' },
      { ...approvedApplication, applicantId: 1.5 },
    ],
  ])('hides contact details for %s', (_label, user, application) => {
    expect(canSeeContact(user, application)).toBe(false);
  });
});
