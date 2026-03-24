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
  deleteAlertConfig: (customerId) =>
    apiFetch(`/api/alerts/config/${customerId}`, { method: 'DELETE' }),
  getFiringAlerts: () => apiFetch('/api/alerts/firing'),
  getAlertHistory: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return apiFetch(`/api/alerts/history${qs ? '?' + qs : ''}`);
  },

  // Agent commands
  generateCommand: (data) =>
    apiFetch('/api/agent/command', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Users
  getUsers: () => apiFetch('/api/users'),
  createUser: (data) => apiFetch('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => apiFetch(`/api/users/${id}`, { method: 'DELETE' }),
  changeMyPassword: (password) => apiFetch('/api/users/me/password', { method: 'PUT', body: JSON.stringify({ password }) }),

  // Grafana users
  getGrafanaUsers: () => apiFetch('/api/grafana/users'),
  createGrafanaUser: (data) => apiFetch('/api/grafana/users', { method: 'POST', body: JSON.stringify(data) }),
  deleteGrafanaUser: (id) => apiFetch(`/api/grafana/users/${id}`, { method: 'DELETE' }),
  resetGrafanaPassword: (id, password) => apiFetch(`/api/grafana/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) }),
  updateGrafanaRole: (id, role) => apiFetch(`/api/grafana/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),

  // Reports
  downloadMonthlyReport: async (customerId, year, month) => {
    const token = getToken();
    const resp = await fetch(
      `/api/reports/monthly?customer_id=${encodeURIComponent(customerId)}&year=${year}&month=${month}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Report generation failed' }));
      throw new Error(err.detail || 'Report generation failed');
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${customerId}_${year}${String(month).padStart(2, '0')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // System
  getSystemStatus: () => apiFetch('/api/system/status'),
  restartService: (service) =>
    apiFetch(`/api/system/restart/${service}`, { method: 'POST' }),
};
