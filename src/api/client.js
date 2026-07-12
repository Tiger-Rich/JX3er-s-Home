const TOKEN_KEY = 'fanshu-session-token';
const unauthorizedListeners = new Set();
let memoryToken = null;
let storageNeedsSync = false;

function getStorage() {
  try {
    const storage = globalThis.localStorage;
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function' &&
      typeof storage.removeItem === 'function'
    ) {
      return storage;
    }
  } catch {
    return null;
  }
  return null;
}

export function getToken() {
  const storage = getStorage();
  if (!storage) return memoryToken;

  if (storageNeedsSync) {
    try {
      if (memoryToken) storage.setItem(TOKEN_KEY, memoryToken);
      else storage.removeItem(TOKEN_KEY);
      storageNeedsSync = false;
    } catch {
      return memoryToken;
    }
  }

  try {
    memoryToken = storage.getItem(TOKEN_KEY) ?? null;
  } catch {
    storageNeedsSync = true;
  }
  return memoryToken;
}

export function setToken(token) {
  memoryToken = token || null;
  const storage = getStorage();
  if (!storage) {
    storageNeedsSync = true;
    return;
  }

  try {
    if (memoryToken) {
      storage.setItem(TOKEN_KEY, memoryToken);
    } else {
      storage.removeItem(TOKEN_KEY);
    }
    storageNeedsSync = false;
  } catch {
    storageNeedsSync = true;
  }
}

export function subscribeUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function publicErrorMessage(payload, status) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message;
    }
    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }
  }
  return `Request failed (${status})`;
}

function notifyUnauthorized(token) {
  if (!token || getToken() !== token) return;
  setToken(null);
  for (const listener of [...unauthorizedListeners]) {
    try {
      listener();
    } catch {
      // One subscriber must not prevent the request from rejecting.
    }
  }
}

export async function api(path, options = {}) {
  const {
    body,
    headers: customHeaders,
    notifyUnauthorized: shouldNotifyUnauthorized = true,
    ...requestOptions
  } = options;
  const headers = { ...customHeaders };
  const token = getToken();
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    ...requestOptions,
    headers,
    ...(body === undefined ? {} : { body: isFormData ? body : JSON.stringify(body) }),
  });

  if (response.status === 204) return null;

  const text = await response.text();
  let payload;
  let parsed = false;
  if (text) {
    try {
      payload = JSON.parse(text);
      parsed = true;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && shouldNotifyUnauthorized) {
      notifyUnauthorized(token);
    }
    const error = new Error(publicErrorMessage(payload, response.status));
    error.status = response.status;
    throw error;
  }

  if (!parsed) {
    const error = new Error('Invalid server response');
    error.status = response.status;
    throw error;
  }

  return payload;
}
