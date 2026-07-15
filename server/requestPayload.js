import {
  buildRequestDescription,
  normalizeRequestDetails,
  requestIndustry,
} from './requestDetails.js';
import { REQUEST_TYPES } from './domain.js';

const UTC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.exposeToClient = true;
  return error;
}

function requiredText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw clientError(400, `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw clientError(400, `${field} must be at most ${maxLength} characters`);
  }
  return normalized;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw clientError(400, `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw clientError(400, `${field} must be at most ${maxLength} characters`);
  }
  return normalized || null;
}

function parseMultipartDetails(value) {
  if (typeof value !== 'string') {
    throw clientError(400, 'details must be a JSON object');
  }
  try {
    return JSON.parse(value);
  } catch {
    throw clientError(400, 'details must be valid JSON');
  }
}

function parseRemote(value, multipart) {
  if (value === undefined) return false;
  if (multipart) {
    if (!['true', 'false'].includes(value)) {
      throw clientError(400, 'remote must be true or false');
    }
    return value === 'true';
  }
  if (typeof value !== 'boolean') {
    throw clientError(400, 'remote must be a boolean');
  }
  return value;
}

function futureUtcIso(value) {
  const input = requiredText(value, 'expiresAt', 64);
  if (input !== value || !UTC_ISO_PATTERN.test(input)) {
    throw clientError(400, 'expiresAt must be a valid future UTC ISO date');
  }
  const expiry = new Date(input);
  const normalized = Number.isNaN(expiry.getTime()) ? null : expiry.toISOString();
  const canonicalInput = input.includes('.')
    ? input
    : input.replace('Z', '.000Z');
  if (!normalized || normalized !== canonicalInput || expiry.getTime() <= Date.now()) {
    throw clientError(400, 'expiresAt must be a valid future UTC ISO date');
  }
  return normalized;
}

export function buildRequestValuesFromBody(ownerId, body, { multipart = false } = {}) {
  const type = requiredText(body.type, 'type', 40);
  if (!Object.hasOwn(REQUEST_TYPES, type)) {
    throw clientError(400, 'Invalid request type');
  }
  const title = requiredText(body.title, 'title', 160);
  const rawDetails = multipart ? parseMultipartDetails(body.details) : body.details;
  const details = normalizeRequestDetails(type, rawDetails);
  const city = optionalText(body.city, 'city', 80);
  const remote = parseRemote(body.remote, multipart);
  if (!city && !remote) {
    throw clientError(400, 'city or remote=true is required');
  }

  return {
    ownerId,
    type,
    title,
    description: buildRequestDescription(type, details),
    details: JSON.stringify(details),
    city,
    remote: remote ? 1 : 0,
    industry: requestIndustry(type, details, optionalText(body.industry, 'industry', 120)),
    budgetOrReward: optionalText(body.budgetOrReward, 'budgetOrReward', 500),
    expiresAt: futureUtcIso(body.expiresAt),
  };
}
