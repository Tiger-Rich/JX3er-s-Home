export const feedChannels = [
  { value: 'recommended', label: '推荐' },
  { value: 'latest', label: '最新' },
  { value: 'nearby', label: '同城' },
  { value: 'job_referral', label: '求职内推' },
  { value: 'industry_consulting', label: '行业咨询' },
  { value: 'trade', label: '买卖交易' },
];

export const feedSorts = [
  { value: 'recommended', label: '推荐' },
  { value: 'latest', label: '最新' },
];

function compactFacts(facts) {
  return facts.filter(({ value }) => Boolean(value)).slice(0, 3);
}

function locationLabel(request) {
  if (request.remote && request.city) return `${request.city} / 可远程`;
  if (request.remote) return '可远程';
  return request.city || '城市未标注';
}

export function buildRequestCardFacts(request) {
  const details = request.details ?? {};
  if (request.type === 'job_referral') {
    return compactFacts([
      { label: '目标岗位', value: details.targetRole },
      { label: '目标行业', value: details.targetIndustry || request.industry },
      { label: '地点方式', value: locationLabel(request) },
      { label: '希望帮助', value: details.helpWanted },
    ]);
  }
  if (request.type === 'industry_consulting') {
    return compactFacts([
      { label: '咨询方向', value: details.topic || request.industry },
      { label: '具体问题', value: details.questions },
      { label: '交流方式', value: details.preferredFormat },
    ]);
  }
  if (request.type === 'trade') {
    return compactFacts([
      { label: '价格/交换', value: details.price },
      { label: '交易方式', value: details.deliveryMethod },
      { label: '所在城市', value: request.city },
    ]);
  }
  if (request.type === 'commission') {
    return compactFacts([
      { label: '委托内容', value: details.commissionContent },
      { label: '预算', value: details.budget || request.budgetOrReward },
      { label: '交付时间', value: details.deadline },
    ]);
  }
  if (request.type === 'local_help') {
    return compactFacts([
      { label: '互助事项', value: details.helpTask },
      { label: '地点', value: details.area || request.city },
      { label: '时间窗口', value: details.timeWindow },
    ]);
  }
  return compactFacts([
    { label: '事情类型', value: details.requestKind },
    { label: '希望帮助', value: details.helpWanted },
    { label: '回报方式', value: details.reward || request.budgetOrReward },
  ]);
}
