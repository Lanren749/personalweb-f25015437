import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStore } from './store.mjs';
import { Auth } from './auth.mjs';
import { Accounts } from './accounts.mjs';
import { Catalog } from './catalog.mjs';
import { Personal } from './personal.mjs';
import { Ai } from './ai.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failure = (message, status) => Object.assign(new Error(message), { status });
async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw failure('请求必须使用 JSON', 415);
  if (Number(req.headers['content-length']) > 256 * 1024) { req.resume(); throw failure('请求内容过大', 413); }
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 256 * 1024) throw failure('请求内容过大', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_) { throw failure('请求 JSON 格式无效', 400); }
}
export async function createApp(options = {}) {
  const env = options.env || process.env;
  const readOnly = env.READ_ONLY === '1';
  if (readOnly && (env.ADMIN_PASSWORD_HASH || env.DEEPSEEK_API_KEY || env.DATA_ENCRYPTION_KEY)) throw new Error('公开只读进程不得配置密码、AI 或数据加密密钥');
  const origin = new URL(env.APP_ORIGIN || 'http://localhost:18080');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('APP_ORIGIN 必须是完整来源，不含路径或凭证');
  const store = options.store || new JsonStore(env.DATA_DIR || path.join(root, 'data'));
  const catalogStore = env.CATALOG_DIR ? new JsonStore(env.CATALOG_DIR) : store;
  const catalog = new Catalog(catalogStore, { time: env.REFRESH_TIME || '09:00', fetchImpl: options.fetchImpl });
  const accounts = new Accounts(store, { dataKey: env.DATA_ENCRYPTION_KEY || '', legacyPasswordHash: env.ADMIN_PASSWORD_HASH || '',
    legacyEmail: env.OWNER_EMAIL || 'owner@local.invalid', legacyKey: env.DEEPSEEK_API_KEY || '' });
  const auth = new Auth(accounts);
  if (readOnly) await catalog.init(); else await Promise.all([catalog.init(), accounts.init()]);
  const personalCache = new Map(); const aiCache = new Map();
  const personalFor = async userId => {
    let personal = personalCache.get(userId);
    if (!personal) { personal = new Personal(accounts.userStore(userId)); await personal.init(); personalCache.set(userId, personal); }
    return personal;
  };
  const aiFor = async userId => {
    let ai = aiCache.get(userId);
    if (!ai) { ai = new Ai(accounts.userStore(userId), { key: accounts.apiKey(userId), model: env.DEEPSEEK_MODEL || 'deepseek-flash', dailyLimit: Number(env.AI_DAILY_LIMIT || 5), fetchImpl: options.fetchImpl }); await ai.init(); aiCache.set(userId, ai); }
    return ai;
  };
  const secure = req => {
    if (readOnly) return false;
    if (origin.protocol === 'https:') return !!req.socket.encrypted || (env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https');
    // Plain HTTP is reserved for the documented local development port. A
    // separate public HTTP listener must remain read-only even on loopback.
    return ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
      && (!origin.port || origin.port === '18080')
      && req.headers.host === origin.host;
  };
  const staticFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']], ['/icon.svg', ['icon.svg', 'image/svg+xml']],
    ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']]
  ]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, body) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); } };
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/healthz' && req.method === 'GET') return send(200, { ok: true });
      if (req.headers.host !== origin.host) throw failure('访问地址与服务器 APP_ORIGIN 不一致', 421);
      const safe = secure(req);
      if (safe && origin.protocol === 'https:') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
      if (staticFiles.has(pathname) && ['GET', 'HEAD'].includes(req.method)) {
        const [file, type] = staticFiles.get(pathname);
        const data = await fs.readFile(path.join(root, 'dist/public', file));
        res.writeHead(200, { 'Content-Type': type }); return res.end(req.method === 'HEAD' ? undefined : data);
      }
      if (!pathname.startsWith('/api/')) throw failure('页面不存在', 404);
      const session = safe ? auth.session(req) : null;
      if (pathname === '/api/session' && req.method === 'GET') return send(200, {
        authenticated: !!session, csrf: session?.csrf || '', loginConfigured: accounts.userCount > 0,
        registrationEnabled: safe && !readOnly, secureTransport: safe, user: session ? accounts.publicUser(accounts.findById(session.userId)) : null,
        ai: session ? (await aiFor(session.userId)).info() : { configured: false }, refreshTime: catalog.time
      });
      if (pathname === '/api/catalog' && req.method === 'GET') {
        if (readOnly) await catalog.init();
        return send(200, catalog.snapshot());
      }
      if (!safe) throw failure('公网 HTTP 仅允许查看公开赛事；登录与 AI 需要 HTTPS 或本机 SSH 隧道', 426);
      const mutate = !['GET', 'HEAD'].includes(req.method);
      if (mutate && (req.headers.origin !== origin.origin || req.headers['sec-fetch-site'] === 'cross-site')) throw failure('跨站请求被拒绝', 403);
      const setSessionCookie = created => res.setHeader('Set-Cookie', 'radar_session=' + created.id + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200' + (origin.protocol === 'https:' ? '; Secure' : ''));
      if (pathname === '/api/register' && req.method === 'POST') {
        const body = await jsonBody(req); const created = await auth.register(body?.email, body?.password, req.socket.remoteAddress);
        if (!created) throw failure('注册请求过于频繁，请稍后再试', 429); setSessionCookie(created); return send(200, { csrf: created.csrf });
      }
      if (pathname === '/api/login' && req.method === 'POST') {
        const body = await jsonBody(req);
        const created = await auth.login(body?.email, body?.password, req.socket.remoteAddress);
        if (!created) throw failure('邮箱或密码不正确，或尝试过于频繁，请稍后再试', 401); setSessionCookie(created);
        return send(200, { csrf: created.csrf });
      }
      if (!session) throw failure('请先登录个人空间', 401);
      if (mutate && req.headers['x-csrf-token'] !== session.csrf) throw failure('会话校验失败，请刷新页面', 403);
      if (pathname === '/api/logout' && req.method === 'POST') {
        auth.logout(req); res.setHeader('Set-Cookie', 'radar_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + (origin.protocol === 'https:' ? '; Secure' : '')); return send(200, { ok: true });
      }
      const personal = await personalFor(session.userId);
      if (pathname === '/api/personal' && req.method === 'GET') return send(200, personal.value);
      if (pathname === '/api/personal' && req.method === 'PUT') return send(200, await personal.update(await jsonBody(req), catalog.cache.items));
      if (pathname === '/api/refresh' && req.method === 'POST') {
        if (!auth.allow('refresh', 2, 60000)) throw failure('请稍后重试更新', 429);
        return send(200, await catalog.refresh());
      }
      if (pathname === '/api/ai/key' && req.method === 'PUT') {
        const body = await jsonBody(req); const result = await accounts.saveApiKey(session.userId, typeof body?.key === 'string' ? body.key.trim() : ''); aiCache.delete(session.userId);
        return send(200, { ...result, ...(await aiFor(session.userId)).info() });
      }
      if (pathname === '/api/ai/key' && req.method === 'DELETE') {
        const result = await accounts.saveApiKey(session.userId, ''); aiCache.delete(session.userId); return send(200, { ...result, ...(await aiFor(session.userId)).info() });
      }
      const ai = await aiFor(session.userId);
      if (pathname === '/api/ai/chat' && req.method === 'GET') return send(200, { history: ai.history, ...ai.info() });
      if (pathname === '/api/ai/report' && req.method === 'GET') return send(200, { report: ai.report, ...ai.info() });
      if (['/api/ai/test', '/api/ai/research', '/api/ai/chat'].includes(pathname) && req.method === 'POST') {
        const body = await jsonBody(req);
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', abort);
        try {
          if (pathname === '/api/ai/test') return send(200, await ai.test(controller.signal));
          if (pathname === '/api/ai/chat') {
            const result = await ai.conversation(personal.value.profile, catalog.cache.items, body?.history, body?.message, controller.signal);
            return send(200, { ...result, ...ai.info() });
          }
          if (body?.confirm !== true || !['catalog', 'web'].includes(body.mode)) throw failure('请确认本次数据发送和可能产生的费用', 400);
          return send(200, { report: await ai.research(personal.value.profile, body.mode, catalog.cache.items, controller.signal), ...ai.info() });
        } finally { res.off('close', abort); }
      }
      throw failure('接口不存在或请求方式不支持', 404);
    } catch (error) { send(error.status && error.status < 500 ? error.status : 400, { error: error.message?.slice(0, 200) || '服务暂不可用' }); }
  });
  server.requestTimeout = 300000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return { server, catalog, accounts, auth, personalFor, aiFor, startSchedule: () => { if (!readOnly) catalog.start(); }, close: async () => { catalog.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(process.env.PORT || 18080);
  app.server.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log('Career Radar web listening on port ' + port + '; secrets are never logged.');
    app.startSchedule();
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
