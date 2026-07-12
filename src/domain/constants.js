export const requestTypes = [
  { value: 'job_referral', label: '求职内推' },
  { value: 'industry_consulting', label: '行业咨询' },
  { value: 'trade', label: '买卖交易' },
  { value: 'commission', label: '约稿委托' },
  { value: 'local_help', label: '本地互助' },
  { value: 'other', label: '其他' },
];

export const verificationLabels = {
  not_submitted: '未提交认证',
  pending: '待掌柜审核',
  approved: '已确认番薯身份',
  rejected: '认证未通过',
};

export const requestStatusLabels = {
  draft: '草稿',
  pending: '待审核',
  approved: '已发布',
  rejected: '未通过',
  taken_down: '已下架',
  expired: '已过期',
};

export const applicationStatusLabels = {
  pending: '待确认',
  approved: '已通过',
  rejected: '暂不合适',
};

export const profileLabels = {
  title: '我的名片',
};
