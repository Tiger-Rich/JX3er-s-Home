const TOKEN_KEY = 'fanshu-session-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const { body, headers: customHeaders, ...requestOptions } = options;
  const headers = { ...customHeaders };
  const token = getToken();

  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(path, {
    ...requestOptions,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') ?? '';
  let payload = null;
  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else {
    const text = await response.text();
    payload = text ? { message: text } : null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.message ?? payload?.error ?? `Request failed (${response.status})`,
    );
    error.status = response.status;
    throw error;
  }

  return payload;
}
