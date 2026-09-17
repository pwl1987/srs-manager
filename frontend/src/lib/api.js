let accessToken = null;
let refreshPromise = null;

// 一次性 refresh token：并发 401 必须共享同一次刷新，否则第二个请求重放已作废的 cookie 会误登出
const AUTH_PATHS = ['/auth/login', '/auth/refresh'];

export function setToken(token) {
  accessToken = token;
  if (token) localStorage.setItem('access_token', token);
  else localStorage.removeItem('access_token');
}

export function getToken() {
  return accessToken;
}

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include'
    })
      .then(async (res) => {
        if (!res.ok) {
          const err = new Error('Refresh failed');
          err.status = res.status;
          throw err;
        }
        const data = await res.json();
        setToken(data.access_token);
        return data.access_token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  let res = await fetch(`/api${path}`, { ...options, headers });

  if (res.status === 401 && !AUTH_PATHS.includes(path)) {
    try {
      const token = await refreshAccessToken();
      headers['Authorization'] = `Bearer ${token}`;
      res = await fetch(`/api${path}`, { ...options, headers });
    } catch {
      setToken(null);
      window.location.href = '/login';
      const authError = new Error('Unauthorized');
      authError.code = 'AUTH_UNAUTHORIZED';
      authError.status = 401;
      throw authError;
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(data.error || res.statusText);
    error.code = data.code;
    error.detail = data.detail;
    error.status = res.status;
    throw error;
  }

  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, data, options = {}) => request(path, { method: 'POST', body: JSON.stringify(data), ...options, headers: options.headers || {} }),
  put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  login: (data) => request('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => request('/auth/logout', { method: 'POST' })
};
