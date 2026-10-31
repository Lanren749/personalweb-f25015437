/* API 封装：统一带 token、错误提示 */
(function () {
  const KEY = 'radar-x-token';
  /* Derive the deployment prefix from this script, including nested paths and index.html. */
  const script = document.currentScript;
  const root = script && script.src ? new URL('../', script.src) : new URL('./', location.href);
  const BASE = root.pathname.replace(/\/$/, '');
  const TOKEN = {
    get: () => localStorage.getItem(KEY) || '',
    set: (t) => t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY)
  };

  async function req(method, url, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const opt = { method, signal: controller.signal, cache: 'no-store', headers: { 'Content-Type': 'application/json' } };
    const tk = TOKEN.get();
    if (tk) opt.headers['Authorization'] = 'Bearer ' + tk;
    if (body !== undefined) opt.body = JSON.stringify(body);
    let res;
    try { res = await fetch(BASE + url, opt); }
    catch (e) { throw new Error(e.name === 'AbortError' ? '请求超时，请稍后重试' : '网络异常，请检查服务是否可达'); }
    finally { clearTimeout(timeout); }
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (res.status === 401) {
      TOKEN.set('');
      window.dispatchEvent(new CustomEvent('auth-expired'));
      throw new Error((data && data.error) || '登录已过期，请重新登录');
    }
    if (!res.ok) throw new Error((data && data.error) || `请求失败（${res.status}）`);
    if (data === null) throw new Error('接口未返回有效 JSON，请检查服务或代理配置');
    return data;
  }

  window.API = {
    token: TOKEN,
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b),
    put: (u, b) => req('PUT', u, b),
    del: (u) => req('DELETE', u)
  };
})();
