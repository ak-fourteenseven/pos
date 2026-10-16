/** API 封裝：自動帶入登入身份頭部，統一錯誤處理 */
const BASE = '/api';

function authHeaders() {
  const raw = localStorage.getItem('pos_user');
  if (!raw) return {};
  try {
    const u = JSON.parse(raw);
    return { 'x-user-id': String(u.id), 'x-role': u.role };
  } catch {
    return {};
  }
}

async function request(path, { method = 'GET', body, raw } = {}) {
  const opts = { method, headers: { ...authHeaders() } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  if (raw !== undefined) {
    opts.headers['Content-Type'] = 'application/octet-stream';
    opts.body = raw;
  }
  let json = null;
  try {
    const res = await fetch(BASE + path, opts);
    json = await res.json();
    if (!res.ok || json.code !== 0) throw new Error(json.message || `請求失敗 (${res.status})`);
    return json.data;
  } catch (e) {
    if (e instanceof Error && e.message) throw e;
    throw new Error('無法連線本地服務端，請確認服務已啟動');
  }
}

export const api = {
  get: (p) => request(p),
  post: (p, b) => request(p, { method: 'POST', body: b }),
  put: (p, b) => request(p, { method: 'PUT', body: b }),
  patch: (p, b) => request(p, { method: 'PATCH', body: b }),
  del: (p) => request(p, { method: 'DELETE' }),
  upload: (p, buf) => request(p, { method: 'POST', raw: buf }),
};
