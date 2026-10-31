import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { scryptSync } from 'node:crypto';
import { createApp } from '../server/main.mjs';
import { JsonStore } from '../server/store.mjs';
import { Auth } from '../server/auth.mjs';
import { Accounts } from '../server/accounts.mjs';
import { Personal, emptyPersonal } from '../server/personal.mjs';
import { Catalog } from '../server/catalog.mjs';
import { Ai } from '../server/ai.mjs';
import { requestText } from '../server/network.mjs';
import { shouldRefresh } from '../dist/shared/model/Radar.js';
const password = 'test-only-password-123456';
const email = 'owner@example.com';
const dataKey = 'a'.repeat(64);
const salt = 'a'.repeat(32);
const hash = 'scrypt:' + salt + ':' + scryptSync(password, salt, 32).toString('hex');
const key = 'sk-not-a-real-key-test-only';
const profile = { version: 1, major: '计算机科学与技术', interests: '软件开发', goals: '积累项目' };
const now = Date.parse('2026-10-27T10:00:00+08:00');
const contest = { id: 'nc-123', title: '牛客周赛 Round 123', organizer: '牛客竞赛', category: '算法竞赛', deadline: '',
  tags: ['国内赛事'], format: '线上算法赛', description: '来自牛客官网的自办赛程。大学生算法竞赛。', deliverables: ['保存代码'], accent: '#167b69', sourceId: 'nowcoder',
  sourceUrl: 'https://ac.nowcoder.com/acm/contest/123', fetchedAt: now, startsAt: now + 86400000, endsAt: now + 90000000, kind: 'contest' };
class Memory {
  data = new Map();
  async read(name, fallback) { return structuredClone(this.data.get(name) ?? fallback); }
  async write(name, value) { this.data.set(name, structuredClone(value)); }
}
async function fixture(t, extra = {}) {
  const app = await createApp({ store: new Memory(), env: { APP_ORIGIN: 'http://localhost:18080', ADMIN_PASSWORD_HASH: hash, OWNER_EMAIL: email, DATA_ENCRYPTION_KEY: dataKey, ...extra } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const url = 'http://127.0.0.1:' + app.server.address().port;
  const call = async (endpoint, { method = 'GET', body, cookie, csrf, origin = 'http://localhost:18080', host = 'localhost:18080', headers = {} } = {}) => {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const request = http.request(url + endpoint, { method, headers: { Host: host, Origin: origin, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers } }, response => {
        let raw = ''; response.setEncoding('utf8'); response.on('data', chunk => { raw += chunk; });
        response.on('end', () => {
          const type = response.headers['content-type'] || '';
          resolve({ status: response.statusCode, headers: { get: name => Array.isArray(response.headers[name]) ? response.headers[name].join(', ') : response.headers[name] }, data: type.includes('application/json') ? JSON.parse(raw) : raw });
        });
      });
      request.on('error', reject); request.end(payload);
    });
  };
  const login = async (accountEmail = email, accountPassword = password) => { const result = await call('/api/login', { method: 'POST', body: { email: accountEmail, password: accountPassword } }); assert.equal(result.status, 200); return { cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.data.csrf }; };
  const register = async (accountEmail, accountPassword = password) => { const result = await call('/api/register', { method: 'POST', body: { email: accountEmail, password: accountPassword } }); assert.equal(result.status, 200); return { cookie: result.headers.get('set-cookie').split(';')[0], csrf: result.data.csrf }; };
  return { app, call, login, register };
}
test('public catalog works without authentication, private and paid routes do not', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/api/catalog')).status, 200);
  assert.equal((await call('/api/personal')).status, 401);
  assert.equal((await call('/api/ai/research', { method: 'POST', body: { confirm: true } })).status, 401);
});
test('login cookie is HttpOnly, SameSite and works after another cookie', async t => {
  const { call, login } = await fixture(t); const credentials = await login();
  const info = await call('/api/session', { cookie: 'other=1; ' + credentials.cookie });
  assert.equal(info.data.authenticated, true); assert.ok(info.data.csrf);
  const result = await call('/api/login', { method: 'POST', body: { email, password } });
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.ok(!JSON.stringify(info.data).includes(hash));
});
test('origin, CSRF and Host protections reject unsafe writes', async t => {
  const { call, login } = await fixture(t); const auth = await login();
  assert.equal((await call('/api/session', { host: 'evil.example' })).status, 421);
  assert.equal((await call('/api/login', { method: 'POST', body: { email, password }, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('/api/personal', { method: 'PUT', body: emptyPersonal(), cookie: auth.cookie })).status, 403);
  assert.equal((await call('/api/personal', { method: 'PUT', body: emptyPersonal(), ...auth, origin: 'https://evil.example' })).status, 403);
});
test('public HTTP cannot authenticate even with configured admin password', async t => {
  const { call } = await fixture(t, { APP_ORIGIN: 'http://127.0.0.1:18081' });
  const options = { host: '127.0.0.1:18081', origin: 'http://127.0.0.1:18081' };
  assert.equal((await call('/api/session', options)).data.secureTransport, false);
  assert.equal((await call('/api/login', { ...options, method: 'POST', body: { email, password } })).status, 426);
  assert.equal((await call('/api/register', { ...options, method: 'POST', body: { email: 'new@example.com', password } })).status, 426);
  assert.equal((await call('/api/ai/key', { ...options, method: 'PUT', body: { key } })).status, 426);
});
test('public-only process never loads personal state and rejects secret configuration', async t => {
  await assert.rejects(createApp({ store: new Memory(), env: { READ_ONLY: '1', ADMIN_PASSWORD_HASH: hash } }), /不得配置/);
  const { app, call } = await fixture(t, { READ_ONLY: '1', ADMIN_PASSWORD_HASH: '', DATA_ENCRYPTION_KEY: '' });
  assert.equal(app.accounts.userCount, 0);
  assert.equal((await call('/api/personal')).status, 426);
  assert.equal((await call('/api/session')).data.authenticated, false);
  assert.ok(!JSON.stringify((await call('/api/catalog')).data).includes('private marker'));
});
test('HTTPS trusts only explicit proxy setup, cookie gains Secure', async t => {
  const { call } = await fixture(t, { APP_ORIGIN: 'https://radar.example.cn', TRUST_PROXY: '1' });
  const options = { host: 'radar.example.cn', origin: 'https://radar.example.cn' };
  assert.equal((await call('/api/login', { ...options, method: 'POST', body: { email, password } })).status, 426);
  const result = await call('/api/login', { ...options, method: 'POST', body: { email, password }, headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /; Secure/);
});
test('registration creates an isolated personal space for each account', async t => {
  const { app, call, register } = await fixture(t, { ADMIN_PASSWORD_HASH: '' });
  const alice = await register('alice@example.com', 'alice-password-123456');
  assert.equal((await call('/api/session', alice)).data.user.email, 'alice@example.com');
  const alicePersonal = (await call('/api/personal', alice)).data;
  alicePersonal.profile = { version: 1, major: '人工智能', interests: '计算机视觉', goals: '完成一个可展示项目' };
  assert.equal((await call('/api/personal', { ...alice, method: 'PUT', body: alicePersonal })).status, 200);
  assert.equal((await call('/api/ai/key', { ...alice, method: 'PUT', body: { key } })).data.configured, true);
  const bob = await register('bob@example.com', 'bob-password-123456');
  assert.equal((await call('/api/personal', bob)).data.profile.major, '计算机科学与技术');
  assert.equal((await call('/api/ai/report', bob)).data.configured, false);
  assert.equal((await call('/api/personal', alice)).data.profile.major, '人工智能');
  assert.ok(app.accounts.value.users.find(user => user.email === 'alice@example.com').apiKey.startsWith('v1:'));
  assert.ok(!JSON.stringify(app.accounts.value).includes(key));
});
test('legacy single-user data migrates to the owner account without plaintext Key', async () => {
  const store = new Memory();
  const oldPersonal = emptyPersonal(); oldPersonal.profile = profile;
  await store.write('personal', oldPersonal);
  await store.write('ai-usage', { day: '2026-10-27', count: 2 });
  const accounts = new Accounts(store, { dataKey, legacyPasswordHash: hash, legacyEmail: 'legacy@example.com', legacyKey: key });
  await accounts.init();
  const owner = accounts.findByEmail('legacy@example.com');
  assert.ok(owner); assert.deepEqual(owner.personal.profile, profile); assert.equal(owner.aiUsage.count, 2);
  assert.equal(accounts.apiKey(owner.id), key); assert.ok(owner.apiKey.startsWith('v1:')); assert.ok(!JSON.stringify((await store.read('accounts', {}))).includes(key));
});
test('personal state syncs, retains saved competitions, rejects stale revisions', async t => {
  const { app, call, login } = await fixture(t); const auth = await login(); app.catalog.cache.items = [contest];
  const initial = (await call('/api/personal', auth)).data; initial.favorites.push(contest.id); initial.profile = profile;
  const saved = await call('/api/personal', { ...auth, method: 'PUT', body: initial });
  assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1); assert.equal(saved.data.savedItems[0].id, contest.id);
  assert.equal((await call('/api/personal', { ...auth, method: 'PUT', body: initial })).status, 409);
  assert.deepEqual((await call('/api/personal', auth)).data.profile, profile);
  assert.equal((await call('/api/logout', { ...auth, method: 'POST' })).status, 200);
  assert.equal((await call('/api/personal', auth)).status, 401);
});
test('personal writes reject unknown competition IDs and invalid notes', async () => {
  const personal = new Personal(new Memory()); await personal.init();
  await assert.rejects(personal.update({ ...emptyPersonal(), favorites: ['nc-999'] }, []), /条目已变化/);
  await assert.rejects(personal.update({ ...emptyPersonal(), notes: { 'nc-123': { stage: 'x', text: '' } } }, [contest]), /格式无效/);
  const next = emptyPersonal(); next.notes['nc-123'] = { text: 'real contribution', stage: '准备中', updatedAt: now };
  await personal.update(next, [contest]); assert.equal(personal.value.savedItems.length, 1);
});
test('bounded auth attempts and expired sessions', async () => {
  let time = 1000;
  const auth = new Auth({ verify: async (accountEmail, accountPassword) => accountEmail === email && accountPassword === password ? { id: 'user-1' } : null }, () => time);
  const session = await auth.login(email, password, 'client'); assert.ok(session);
  time += 13 * 3600000;
  assert.equal(auth.session({ headers: { cookie: 'radar_session=' + session.id } }), null);
  for (let i = 0; i < 8; i++) assert.equal(await auth.login('bad@example.com', 'other-password', 'client'), null);
  assert.equal(await auth.login(email, password, 'client'), null);
});
test('static assets use CSP and traversal does not reveal files', async t => {
  const { call } = await fixture(t);
  for (const endpoint of ['/', '/app.js', '/style.css', '/manifest.webmanifest', '/icon.svg']) {
    const result = await call(endpoint); assert.equal(result.status, 200, endpoint); assert.match(result.headers.get('content-security-policy'), /script-src 'self'/);
  }
  assert.equal((await call('/.env')).status, 404); assert.equal((await call('/server/main.mjs')).status, 404);
});
test('large JSON and wrong content type are rejected', async t => {
  const { call, login } = await fixture(t); const auth = await login();
  assert.equal((await call('/api/personal', { ...auth, method: 'PUT', body: { text: 'x'.repeat(270000) } })).status, 413);
  assert.equal((await call('/api/personal', { ...auth, method: 'PUT', body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
});
test('atomic disk persistence round-trips without partial or plaintext temp files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'radar-test-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new JsonStore(directory);
  await Promise.all([store.write('record', { version: 1 }), store.write('record', { version: 2, text: 'x'.repeat(20000) })]);
  assert.equal((await store.read('record')).version, 2); assert.deepEqual(await fs.readdir(directory), ['record.json']);
  assert.equal((await fs.stat(path.join(directory, 'record.json'))).mode & 0o777, 0o600);
});
test('source failure retains cache and success is independently merged', async () => {
  const store = new Memory(); const catalog = new Catalog(store, { now: () => now, fetchImpl: async url => {
    if (url.includes('nowcoder')) throw new Error('offline');
    return new Response('<li><a href="info/1042/456.htm">全国大学生计算机设计大赛通知</a><i>2026-10-20</i></li>');
  } }); await catalog.init(); catalog.cache.items = [contest]; await catalog.refresh();
  assert.ok(catalog.cache.items.some(x => x.id === contest.id)); assert.ok(catalog.cache.items.some(x => x.id === '4c-456'));
  assert.equal(catalog.cache.reports.find(x => x.id === 'nowcoder').success, false);
});
test('scheduling uses Beijing time and throttles retries', () => {
  const morning = Date.parse('2026-10-27T09:00:00+08:00');
  assert.equal(shouldRefresh(morning, 0, morning - 86400000, '09:00'), true);
  assert.equal(shouldRefresh(morning - 60000, 0, morning - 86400000, '09:00'), false);
  assert.equal(shouldRefresh(morning + 60000, morning, morning - 86400000, '09:00'), false);
});
test('fetch always refuses redirects and bounds response size', async () => {
  let options;
  assert.equal(await requestText('https://api.deepseek.com/models', { key, fetchImpl: async (_, value) => { options = value; return new Response('{}'); } }), '{}');
  assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer ' + key);
  await assert.rejects(requestText('https://api.deepseek.com/models', { fetchImpl: async () => new Response('x', { headers: { 'content-length': 3000000 } }) }), /过大/);
});
test('AI no-key, daily persisted limit, private note exclusion and strict source evidence', async () => {
  const store = new Memory(); const calls = [];
  const ai = new Ai(store, { key, dailyLimit: 1, now: () => now, fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/chat/completions') && calls.length === 1) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'analyze_catalog', arguments: '{}' } }]
    } }] });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ recommendations: [
      { id: 'S1', domestic: true, evidence: '来自牛客官网的自办赛程', reason: '可以练习', action: '保存代码' },
      { id: 'fake', domestic: true, evidence: 'fake', reason: 'x', action: 'x' }
    ] }) } }] });
  } }); await ai.init();
  const result = await ai.research(profile, 'catalog', [{ ...contest, notes: 'SECRET_NOTE' }]);
  assert.equal(calls.length, 2); assert.equal(calls[0].body.tool_choice, 'required'); assert.ok(calls[1].body.messages.some(message => message.role === 'tool'));
  assert.equal(result.items.length, 1); assert.equal(result.toolCalls[0].name, 'analyze_catalog'); assert.ok(!JSON.stringify(calls).includes('SECRET_NOTE'));
  const restarted = new Ai(store, { key, dailyLimit: 1, now: () => now }); await restarted.init();
  await assert.rejects(restarted.research(profile, 'catalog', [contest]), /上限/);
  const none = new Ai(new Memory()); await assert.rejects(none.research(profile, 'catalog', []), /配置/);
});
test('web research makes at most three searches, skips AI on empty results', async () => {
  let searches = 0; let chats = 0;
  const ai = new Ai(new Memory(), { key, now: () => now, fetchImpl: async (url) => {
    if (url.endsWith('/v1/tools/search')) { searches++; return Response.json({ results: [] }); }
    chats++; return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [
      { id: 'call-1', type: 'function', function: { name: 'search_competitions', arguments: '{"query":"计算机 国内竞赛"}' } },
      { id: 'call-2', type: 'function', function: { name: 'search_competitions', arguments: '{"query":"企业 挑战赛"}' } },
      { id: 'call-3', type: 'function', function: { name: 'search_competitions', arguments: '{"query":"高校 大赛"}' } }
    ] } }] });
  } }); await ai.init();
  const report = await ai.research(profile, 'web', []); assert.equal(searches, 3); assert.equal(chats, 1); assert.equal(report.items.length, 0);
});
test('AI failure does not retry, retains previous report and counts reserved usage', async () => {
  let count = 0; const ai = new Ai(new Memory(), { key, now: () => now, fetchImpl: async () => { count++; return new Response('', { status: 401 }); } }); await ai.init();
  const previous = { marker: 'old' }; ai.report = previous;
  await assert.rejects(ai.research(profile, 'web', []), /密钥无效/);
  assert.equal(count, 1); assert.equal(ai.report, previous); assert.equal(ai.usage.count, 1);
});
test('aborted AI request does not incur calls or usage', async () => {
  const ai = new Ai(new Memory(), { key, fetchImpl: () => { throw new Error('must not run'); } }); await ai.init();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(ai.research(profile, 'web', [], controller.signal), /取消/);
  assert.equal(ai.usage.count, 0); assert.equal(ai.busy, false);
});
test('natural language chat keeps conversation, uses domestic sources and bounded search tools', async () => {
  const calls = [];
  const store = new Memory();
  const ai = new Ai(store, { key, now: () => now, fetchImpl: async (url, options) => {
    calls.push({ url, body: options?.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/v1/tools/search')) return Response.json({ results: [{
      title: '华为大学生创新挑战赛（中国区）', url: 'https://www.huawei.com/cn/competition/student',
      snippet: '面向中国高校学生的技术创新挑战赛。', summary: '华为企业挑战赛，国内大学生竞赛公开通知。', date: '2026-10-20'
    }] });
    if (calls.filter(call => call.url.endsWith('/chat/completions')).length === 1) return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null, tool_calls: [{ id: 'chat-search', type: 'function', function: { name: 'search_competitions', arguments: '{"query":"华为 大学生 国内 挑战赛"}' } }]
    } }] });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '可以先看 S1 和 S2。请打开来源核实报名资格与截止时间，再决定是否参赛。' } }] });
  } });
  await ai.init();
  const result = await ai.conversation(profile, [{ ...contest, notes: 'PRIVATE_NOTE' }], [{ role: 'user', content: '我想做能写进简历的项目' }], '请帮我找近期国内比赛', undefined);
  assert.match(result.reply, /S1/); assert.equal(result.toolCalls.length, 1); assert.ok(result.sources.length >= 2);
  assert.equal(calls.filter(call => call.url.endsWith('/v1/tools/search')).length, 1);
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_NOTE'));
  assert.equal(calls[0].body.tools[0].function.name, 'search_competitions');
  const restarted = new Ai(store, { key, now: () => now }); await restarted.init();
  assert.equal(restarted.history.length, 3); assert.equal(restarted.history[0].content, '我想做能写进简历的项目'); assert.equal(restarted.history[1].content, '请帮我找近期国内比赛');
  await assert.rejects(ai.conversation(profile, [], [], '', undefined), /1 至 2000/);
});
