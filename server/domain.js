export const REQUEST_TYPES = {
  job_referral: '求职内推',
  industry_consulting: '行业咨询',
  trade: '买卖交易',
  commission: '约稿委托',
  local_help: '本地互助',
  other: '其他',
};

export const VERIFICATION_STATUSES = [
  'not_submitted',
  'pending',
  'approved',
  'rejected',
];

export const REQUEST_STATUSES = [
  'draft',
  'pending',
  'approved',
  'rejected',
  'taken_down',
  'expired',
  'withdrawn',
  'closed',
];

export const APPLICATION_STATUSES = ['pending', 'approved', 'rejected'];

export function isActiveVerifiedUser(user) {
  return Boolean(
    user &&
      user.status === 'active' &&
      user.verificationStatus === 'approved',
  );
}

export function canPublishRequest(user) {
  return isActiveVerifiedUser(user);
}

export function canApplyContact(user) {
  return isActiveVerifiedUser(user);
}

function isValidId(id) {
  return Number.isInteger(id) && id > 0;
}

export function canSeeContact(user, application) {
  return Boolean(
    user &&
      user.status === 'active' &&
      application?.status === 'approved' &&
      isValidId(user.id) &&
      isValidId(application.applicantId) &&
      isValidId(application.ownerId) &&
      (user.id === application.applicantId || user.id === application.ownerId),
  );
}

export function isAdmin(user) {
  return Boolean(user && user.status === 'active' && user.role === 'admin');
}
