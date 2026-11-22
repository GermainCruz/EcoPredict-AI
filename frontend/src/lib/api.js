const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// El refresh token vive en una cookie httpOnly (no accesible por JS). Solo el
// access token de corta vida se conserva en sessionStorage para sobrevivir recargas.
export const session = {
  read: () => {
    try {
      return JSON.parse(sessionStorage.getItem('eco_session') || 'null');
    } catch {
      return null;
    }
  },
  save: (s) => sessionStorage.setItem('eco_session', JSON.stringify(s)),
  clear: () => sessionStorage.removeItem('eco_session'),
};

export async function api(path, { method = 'GET', body, download = false } = {}) {
  let s = session.read();
  const call = (token) =>
    fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let response = await call(s?.accessToken);
  if (response.status === 401 && !path.includes('/auth/')) {
    // Renovación silenciosa: la cookie httpOnly viaja automáticamente.
    const refresh = await fetch(BASE + '/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (refresh.ok) {
      const next = await refresh.json();
      s = { ...(s || {}), accessToken: next.accessToken };
      session.save(s);
      response = await call(next.accessToken);
    } else {
      session.clear();
      window.location.href = '/login';
      throw Error('Sesión vencida');
    }
  }
  if (!response.ok) {
    let data = {};
    try {
      data = await response.json();
    } catch {}
    throw Error(data.error || `Error HTTP ${response.status}`);
  }
  return download ? response.blob() : response.json();
}

export const downloadReport = async (format, filters = {}) => {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  const data = await api(`/reports/${format}?${q}`, { download: true });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ecopredict_reporte.${format}`;
  a.click();
  URL.revokeObjectURL(url);
};
