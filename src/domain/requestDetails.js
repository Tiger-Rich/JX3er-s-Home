export const requestDetailSchemas = {
  job_referral: [
    { name: 'targetRole', label: '目标岗位', required: true },
    { name: 'targetIndustry', label: '目标行业', required: true },
    { name: 'careerStage', label: '当前阶段', required: true },
    { name: 'helpWanted', label: '希望获得的帮助', required: true, multiline: true },
    { name: 'targetCompany', label: '期望公司/方向', required: false },
    { name: 'resumeHighlights', label: '简历亮点', required: false, multiline: true },
  ],
  industry_consulting: [
    { name: 'topic', label: '咨询方向', required: true },
    { name: 'questions', label: '具体问题', required: true, multiline: true },
    { name: 'preferredFormat', label: '期望交流方式', required: true },
    { name: 'background', label: '我的背景', required: false, multiline: true },
    { name: 'expectedPeer', label: '希望对方资历', required: false },
    { name: 'reward', label: '可提供回报', required: false },
  ],
  trade: [
    { name: 'itemName', label: '物品/服务名称', required: true },
    { name: 'price', label: '价格或交换方式', required: true },
    { name: 'condition', label: '成色/规格', required: true },
    { name: 'deliveryMethod', label: '交易/发货方式', required: true },
    { name: 'negotiable', label: '是否可议价', required: false },
    {
      name: 'afterSalesBoundary',
      label: '售后边界',
      required: false,
      multiline: true,
      placeholder: '例：签收后 24 小时内可沟通破损问题，生鲜不支持无理由退换。',
    },
  ],
  commission: [
    { name: 'commissionContent', label: '委托内容', required: true, multiline: true },
    { name: 'deliverables', label: '交付物', required: true },
    { name: 'budget', label: '预算/回报', required: true },
    { name: 'deadline', label: '期望交付时间', required: true },
    { name: 'styleReference', label: '风格参考', required: false, multiline: true },
    { name: 'usage', label: '使用场景', required: false },
    { name: 'commercialUse', label: '商用/非商用', required: false },
  ],
  local_help: [
    { name: 'helpTask', label: '互助事项', required: true, multiline: true },
    { name: 'area', label: '地点/区域', required: true },
    { name: 'timeWindow', label: '时间窗口', required: true },
    { name: 'headcount', label: '需要几人', required: true },
    { name: 'costShare', label: '费用 AA/回报', required: false },
    { name: 'safetyNote', label: '安全注意事项', required: false, multiline: true },
  ],
  other: [
    { name: 'requestKind', label: '事情类型', required: true },
    { name: 'helpWanted', label: '委托内容', required: true, multiline: true },
    { name: 'reward', label: '回报方式', required: true },
    { name: 'background', label: '背景说明', required: false, multiline: true },
    { name: 'constraints', label: '限制条件', required: false, multiline: true },
  ],
};

export function emptyDetailsForType(type) {
  return Object.fromEntries([
    ...(requestDetailSchemas[type] ?? []).map((field) => [field.name, '']),
    ['extraNote', ''],
  ]);
}

export function validateDetails(type, details = {}) {
  for (const field of requestDetailSchemas[type] ?? []) {
    if (field.required && !details[field.name]?.trim()) return `${field.label}为必填`;
  }
  return '';
}

export function visibleDetailRows(type, details = {}) {
  const source = details && typeof details === 'object' ? details : {};
  return (requestDetailSchemas[type] ?? [])
    .map((field) => ({ label: field.label, value: source[field.name] }))
    .filter((row) => (typeof row.value === 'string' ? row.value.trim() : row.value));
}
