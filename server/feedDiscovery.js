const CHANNEL_TO_TYPE = {
  job_referral: 'job_referral',
  industry_consulting: 'industry_consulting',
  trade: 'trade',
};

const CHANNELS = new Set([
  'recommended',
  'latest',
  'nearby',
  'job_referral',
  'industry_consulting',
  'trade',
]);

const SORTS = new Set(['recommended', 'latest']);

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

function queryText(value, field) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || !value.trim()) {
    throw clientError(400, `Invalid ${field} filter`);
  }
  return value.trim();
}

export function normalizeFeedQuery(query) {
  const channel = queryText(query.channel, 'channel') || 'recommended';
  const sort =
    queryText(query.sort, 'sort') ||
    (channel === 'latest' ? 'latest' : 'recommended');
  if (!CHANNELS.has(channel)) throw clientError(400, 'Invalid channel');
  if (!SORTS.has(sort)) throw clientError(400, 'Invalid sort');
  return {
    channel,
    sort,
    typeFromChannel: CHANNEL_TO_TYPE[channel] ?? '',
  };
}

function freshnessScore(createdAt) {
  const ageHours = Math.max(
    0,
    (Date.now() - new Date(createdAt).getTime()) / 36e5,
  );
  return Math.max(0, 24 - Math.min(ageHours, 168) / 7);
}

function typeWeight(type) {
  if (type === 'job_referral') return 7;
  if (type === 'industry_consulting') return 6;
  if (type === 'local_help') return 3;
  return 1;
}

function profileCompletenessScore(row) {
  const fields = [
    row.ownerServer,
    row.ownerGameNickname,
    row.ownerSect,
    row.ownerStartedYear,
    row.ownerIndustry,
    row.ownerOccupation,
  ];
  return fields.filter(Boolean).length;
}

function riskPenalty(row) {
  const hoursToExpiry =
    (new Date(row.expiresAt).getTime() - Date.now()) / 36e5;
  return hoursToExpiry < 24 ? 8 : 0;
}

function selfExcludedReactionCount(row) {
  return Math.max(
    0,
    Number(row.reactionCount ?? 0) - Number(row.ownerReactionCount ?? 0),
  );
}

export function scoreRequest(row, context = {}) {
  const matchScore =
    (context.channel === 'nearby' && row.city === context.viewer?.city ? 8 : 0) +
    (context.typeFromChannel && row.type === context.typeFromChannel ? 6 : 0);
  return (
    freshnessScore(row.createdAt) +
    typeWeight(row.type) +
    matchScore +
    Math.log1p(selfExcludedReactionCount(row)) * 2 +
    Math.log1p(Number(row.favoriteCount ?? 0)) * 4 +
    Math.log1p(Number(row.applicationCount ?? 0)) * 5 +
    profileCompletenessScore(row) -
    riskPenalty(row)
  );
}

function newestFirst(left, right) {
  const createdDifference =
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  return createdDifference || right.id - left.id;
}

export function sortFeedRows(rows, context) {
  if (context.sort === 'latest') return [...rows].sort(newestFirst);
  return [...rows].sort((left, right) => {
    const scoreDifference =
      scoreRequest(right, context) - scoreRequest(left, context);
    return scoreDifference || newestFirst(left, right);
  });
}
