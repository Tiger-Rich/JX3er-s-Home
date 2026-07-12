function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

const MAX_FIELD_LENGTH = 800;

export const REQUEST_DETAIL_SCHEMAS = {
  job_referral: {
    required: ['targetRole', 'targetIndustry', 'careerStage', 'helpWanted'],
    optional: ['targetCompany', 'resumeHighlights', 'extraNote'],
    industryField: 'targetIndustry',
    summary: [
      ['targetRole', '目标岗位'],
      ['targetIndustry', '目标行业'],
      ['careerStage', '当前阶段'],
      ['helpWanted', '希望获得'],
    ],
  },
  industry_consulting: {
    required: ['topic', 'questions', 'preferredFormat'],
    optional: ['background', 'expectedPeer', 'reward', 'extraNote'],
    industryField: 'topic',
    summary: [
      ['topic', '咨询方向'],
      ['questions', '具体问题'],
      ['preferredFormat', '交流方式'],
    ],
  },
  trade: {
    required: ['itemName', 'price', 'condition', 'deliveryMethod'],
    optional: ['negotiable', 'afterSalesBoundary', 'extraNote'],
    summary: [
      ['itemName', '物品'],
      ['price', '价格'],
      ['condition', '成色/规格'],
      ['deliveryMethod', '交易方式'],
    ],
  },
  commission: {
    required: ['commissionContent', 'deliverables', 'budget', 'deadline'],
    optional: ['styleReference', 'usage', 'commercialUse', 'extraNote'],
    summary: [
      ['commissionContent', '委托内容'],
      ['deliverables', '交付物'],
      ['budget', '预算'],
      ['deadline', '交付时间'],
    ],
  },
  local_help: {
    required: ['helpTask', 'area', 'timeWindow', 'headcount'],
    optional: ['costShare', 'safetyNote', 'extraNote'],
    summary: [
      ['helpTask', '互助事项'],
      ['area', '地点'],
      ['timeWindow', '时间'],
      ['headcount', '人数'],
    ],
  },
  other: {
    required: ['requestKind', 'helpWanted', 'reward'],
    optional: ['background', 'constraints', 'extraNote'],
    summary: [
      ['requestKind', '事情类型'],
      ['helpWanted', '希望帮助'],
      ['reward', '回报方式'],
    ],
  },
};

function schemaFor(type) {
  const schema = REQUEST_DETAIL_SCHEMAS[type];
  if (!schema) {
    throw clientError(400, 'Invalid request type');
  }
  return schema;
}

function normalizeTextField(rawDetails, field, required) {
  const value = rawDetails[field];
  if (value === undefined || value === null) {
    if (required) throw clientError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') {
    throw clientError(400, `${field} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    if (required) throw clientError(400, `${field} is required`);
    return null;
  }
  if (normalized.length > MAX_FIELD_LENGTH) {
    throw clientError(
      400,
      `${field} must be at most ${MAX_FIELD_LENGTH} characters`,
    );
  }
  return normalized;
}

export function normalizeRequestDetails(type, rawDetails) {
  const schema = schemaFor(type);
  if (
    !rawDetails ||
    typeof rawDetails !== 'object' ||
    Array.isArray(rawDetails)
  ) {
    throw clientError(400, 'details is required');
  }

  const details = {};
  for (const field of schema.required) {
    details[field] = normalizeTextField(rawDetails, field, true);
  }
  for (const field of schema.optional) {
    const value = normalizeTextField(rawDetails, field, false);
    if (value !== null) details[field] = value;
  }
  return details;
}

export function buildRequestDescription(type, details) {
  const schema = schemaFor(type);
  const parts = schema.summary
    .map(([field, label]) => {
      const value = details[field];
      return value ? `${label}：${value}` : null;
    })
    .filter(Boolean);

  if (details.extraNote) {
    parts.push(`补充说明：${details.extraNote}`);
  }
  return parts.slice(0, 5).join('；');
}

export function parseRequestDetails(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

export function requestIndustry(type, details, fallback) {
  const schema = REQUEST_DETAIL_SCHEMAS[type];
  if (schema?.industryField) {
    return details[schema.industryField] ?? fallback;
  }
  return fallback;
}
