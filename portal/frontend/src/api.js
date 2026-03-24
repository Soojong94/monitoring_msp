const getToken = () => localStorage.getItem('token');

const apiFetch = async (path, options = {}) => {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    window.location.href = '/login';
    return;
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(error.detail || 'API Error');
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

export const api = {
  // Auth
  login: (username, password) =>
    apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  me: () => apiFetch('/api/auth/me'),

  // Servers
  getServers: (includeInactive = false) =>
    apiFetch(`/api/servers?include_inactive=${includeInactive}`),
  setAlias: (customerId, serverName, data) =>
    apiFetch(`/api/servers/${customerId}/${serverName}/alias`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deactivateServer: (customerId, serverName) =>
    apiFetch(`/api/servers/${customerId}/${serverName}?purge=false`, { method: 'DELETE' }),
  purgeServer: (customerId, serverName) =>
    apiFetch(`/api/servers/${customerId}/${serverName}?purge=true`, { method: 'DELETE' }),
  restoreServer: (customerId, serverName) =>
    apiFetch(`/api/servers/${customerId}/${serverName}/restore`, { method: 'POST' }),

  // Alert configs
  getVmCustomers: () => apiFetch('/api/alerts/customers'),
  getAlertConfigs: () => apiFetch('/api/alerts/config'),
  getAlertConfig: (customerId) => apiFetch(`/api/alerts/config/${customerId}`),
  updateAlertConfig: (customerId, data) =>
    apiFetch(`/api/alerts/config/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  addEmail: (customerId, email) =>
    apiFetch(`/api/alerts/config/${customerId}/emails`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  deleteEmail: (customerId, emailId) =>
    apiFetch(`/api/alerts/config/${customerId}/emails/${emailId}`, { method: 'DELETE' }),
  toggleEmail: (customerId, emailId) =>
    apiFetch(`/api/alerts/config/${customerId}/emails/${emailId}`, { method: 'PATCH' }),
  getFiringAlerts: () => apiFetch('/api/alerts/firing'),

  // Agent commands
  generateCommand: (data) =>
    apiFetch('/api/agent/command', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // System
  getSystemStatus: () => apiFetch('/api/system/status'),
  restartService: (service) =>
    apiFetch(`/api/system/restart/${service}`, { method: 'POST' }),
};
