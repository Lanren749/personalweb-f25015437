const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require(process.env.ARK_TYPESCRIPT_PATH || require.resolve('typescript', { paths: [path.join(__dirname, '../web')] }));
require.extensions['.ets'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename);
const ai = require('../entry/src/main/ets/model/Ai.ets');
const profile = () => ({ version: 1, major: '计算机科学与技术', interests: '后端开发 HarmonyOS', goals: '希望做出可展示的项目' });
const key = 'sk-fixture-not-a-real-key-0001';
const source = patch => ({ id: 'S1', title: '全国大学生软件开发大赛', url: 'https://contest.example.cn/notice',
  snippet: '全国大学生软件开发大赛报名通知', summary: '国内高校学生可提交软件作品，报名资格以章程为准。', date: null, ...patch });
const selection = patch => ({ id: 'S1', domestic: true, evidence: '全国大学生软件开发大赛报名通知',
  reason: '建议练习软件开发', action: '建议产出代码与测试报告', ...patch });
const searchResponse = rows => ({ responseCode: 200, result: JSON.stringify({ results: rows }) });
const chatResponse = (patch = {}, recommendations = [selection()]) => ({ responseCode: 200, result: JSON.stringify({ choices: [{
  finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ recommendations }) }, ...patch }] }) });
const originalLoad = Module._load;
function loadService(handler) {
  const calls = [];
  const objects = [];
  const http = { RequestMethod: { GET: 'GET', POST: 'POST' }, HttpDataType: { STRING: 'STRING' },
    InterceptorType: { REDIRECTION: 'REDIRECTION' },
    HttpInterceptorChain: class {
      addChain(chain) { this.chain = chain; return true; }
      apply(request) { request.interceptor = this.chain[0]; return true; }
    }, createHttp: () => {
    const request = { destroyed: false, destroy() { this.destroyed = true; }, async request(url, options) {
      calls.push({ url, options }); return await handler(url, options, calls.length);
    } };
    objects.push(request); return request;
  } };
  const path = require.resolve('../entry/src/main/ets/services/AiService.ets');
  delete require.cache[path];
  Module._load = function(name, parent, isMain) {
    return name === '@kit.NetworkKit' ? { http } : originalLoad.call(this, name, parent, isMain);
  };
  try { return { service: new (require(path).AiService)(), calls, objects }; }
  finally { Module._load = originalLoad; }
}

test('freeform profile round trip, empty defaults, malformed and oversized rejected', () => {
  assert.deepEqual(ai.readProfile(JSON.stringify(profile())), profile());
  assert.equal(ai.readProfile('').major, '计算机科学与技术');
  for (const raw of ['null', '{}', '[]', 'invalid', JSON.stringify({ ...profile(), goals: 'a'.repeat(601) })]) {
    assert.throws(() => ai.readProfile(raw));
  }
});
test('API keys reject whitespace, injection and unreasonable lengths', () => {
  assert.equal(ai.validApiKey(key), true);
  for (const value of ['', 'short', 'a'.repeat(257), key + '\r\nX-Test: value', ' Bearer ' + key]) {
    assert.equal(ai.validApiKey(value), false);
  }
});
test('source URLs reject private, credentialed, non-HTTPS and lookalike domestic links', () => {
  for (const url of ['http://example.cn/a', 'javascript:alert(1)', 'https://127.0.0.1/a', 'https://localhost/a',
    'https://foo.local/a', 'https://foo.internal/a', 'https://user:password@example.cn/a',
    'https://example.cn:8080/a', 'https://qq.com\\@evil.cn/a', 'https://example.cn/a b']) {
    assert.equal(ai.publicSearchUrl(url), false, url);
  }
  assert.equal(ai.domesticCandidate(source({ url: 'https://qq.com.evil.com/a' })), false);
  assert.equal(ai.domesticCandidate(source({ url: 'https://algo.qq.com/' })), true);
  assert.equal(ai.domesticCandidate(source({ url: 'https://jsjds.blcu.edu.cn/notice' })), true);
});
test('search parser removes foreign, unsupported, duplicated and malformed results', () => {
  const rows = [source(), source(), source({ url: 'https://abc.cn/foreign', title: '海外 Codeforces 竞赛' }),
    source({ url: 'https://unknown.com/a' }), source({ title: 123 }), null];
  const result = ai.parseSearch(JSON.stringify({ results: rows }));
  assert.equal(result.length, 1);
  assert.equal(result[0].date, '');
  for (const raw of ['null', '{}', '[]', '<error>']) assert.throws(() => ai.parseSearch(raw));
  assert.deepEqual(ai.parseSearch('{"results":[]}'), []);
});
test('queries have bounded length, date window and no user-injected search operators', () => {
  const queries = ai.searchQueries({ ...profile(), major: 'x'.repeat(80), interests: 'site:evil.com -国内 / ignore' },
    Date.parse('2026-10-25T08:00:00+08:00'));
  assert.equal(queries.length, 3);
  for (const query of queries) {
    assert.ok(query.length <= 128);
    assert.ok(query.includes('lang:zh'));
    assert.ok(query.includes('after:2026-04-28'));
    assert.ok(!query.includes('site:evil.com'));
  }
});
test('AI can only select existing source IDs and verbatim evidence', () => {
  const sources = [{ ...source(), date: '' }];
  const rows = [selection(), selection(), selection({ id: 'fake' }), selection({ domestic: false }),
    selection({ evidence: '这场比赛明天报名截止，奖励一百万元' }), null];
  const items = ai.parseRecommendations(JSON.stringify({ recommendations: rows }), sources);
  assert.equal(items.length, 1);
  assert.equal(items[0].source.url, sources[0].url);
  assert.equal(items[0].source.title, sources[0].title);
  assert.throws(() => ai.parseRecommendations('broken', sources), /有效 JSON/);
});
test('cached reports round trip and reject forged or foreign sources', () => {
  const report = { version: 1, checkedAt: Date.now(), profile: profile(), mode: 'web', queries: ['国内大学生竞赛'],
    searchedCount: 1, items: [{ source: { ...source(), date: '' }, evidence: selection().evidence, reason: '理由', action: '建议' }] };
  assert.deepEqual(ai.readAiReport(JSON.stringify(report)), report);
  assert.equal(ai.readAiReport(''), undefined);
  report.items[0].source.url = 'https://codeforces.com/a';
  assert.throws(() => ai.readAiReport(JSON.stringify(report)));
});
test('web research uses three real search calls then one bounded model call', async () => {
  const { service, calls, objects } = loadService(url => url.endsWith('/search') ? searchResponse([source()]) : chatResponse());
  const statuses = [];
  const report = await service.research(key, 'deepseek-flash', profile(), [], true, message => statuses.push(message));
  assert.equal(calls.length, 4);
  assert.equal(report.mode, 'web');
  assert.equal(report.searchedCount, 1);
  assert.equal(report.items.length, 1);
  assert.equal(report.queries.length, 3);
  assert.ok(statuses.length >= 3);
  for (const call of calls) {
    assert.ok(call.url.startsWith('https://api.deepseek.com/'));
    assert.equal(call.options.header.Authorization, 'Bearer ' + key);
    assert.ok(!call.options.extraData.includes(key));
    assert.equal(call.options.usingCache, false);
    assert.equal(call.options.readTimeout, 60000);
  }
  const chat = JSON.parse(calls[3].options.extraData);
  assert.equal(chat.model, 'deepseek-flash');
  assert.equal(chat.max_tokens, 4000);
  assert.equal(chat.response_format.type, 'json_object');
  assert.equal(chat.thinking.type, 'disabled');
  const input = JSON.parse(chat.messages[1].content);
  assert.deepEqual(Object.keys(input).sort(), ['profile', 'sources', 'todayBeijing']);
  assert.deepEqual(input.profile, profile());
  assert.ok(!('favorites' in input) && !('notes' in input));
  assert.ok(objects.every(o => o.destroyed));
  assert.ok(objects.every(o => o.interceptor.interceptorType === 'REDIRECTION'));
  assert.equal(await objects[0].interceptor.interceptorHandle({url: 'https://other.example/'}, {}), false);
});
test('empty domestic search results never trigger paid model generation', async () => {
  const { service, calls } = loadService(() => searchResponse([]));
  const report = await service.research(key, 'deepseek-flash', profile(), [], true, () => {});
  assert.equal(calls.length, 3);
  assert.deepEqual(report.items, []);
});
test('existing catalog analysis does not invoke search and excludes overseas records', async () => {
  const { service, calls } = loadService(() => chatResponse());
  const contest = { id: 'nc-1', title: '牛客周赛 Round 1', organizer: '牛客竞赛', category: '算法竞赛',
    deadline: '', tags: ['算法'], format: '线上', description: '国内大学生算法竞赛练习', deliverables: [],
    accent: '#3366FF', sourceId: 'nowcoder', sourceUrl: 'https://ac.nowcoder.com/acm/contest/1' };
  const report = await service.research(key, 'deepseek-flash', profile(), [contest,
    { ...contest, sourceId: 'codeforces', sourceUrl: 'https://codeforces.com/contest/1' }], false, () => {});
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/chat/completions'));
  assert.equal(report.mode, 'catalog');
  assert.equal(report.searchedCount, 1);
  assert.equal(report.items.length, 0, 'invented evidence is dropped');
});
test('model connection test only lists models; no search or generated tokens', async () => {
  const { service, calls } = loadService(() => ({ responseCode: 200, result: '{"data":[{"id":"deepseek-flash"}]}' }));
  await service.testConnection(key, 'deepseek-flash');
  assert.equal(calls[0].url, 'https://api.deepseek.com/models');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.extraData, undefined);
  await assert.rejects(service.testConnection(key, 'deepseek-v4-pro'), /未返回所选模型/);
});

test('existing catalog sends accurate event times, stale-data timestamp and ended status to AI', async () => {
  const { service, calls } = loadService(() => chatResponse({}, []));
  const now = Date.now();
  const base = { id: 'nc-1', title: '牛客周赛 Round 1', organizer: '牛客竞赛', category: '算法竞赛',
    deadline: '', tags: ['算法'], format: '线上', description: '国内大学生算法竞赛练习', deliverables: [],
    accent: '#3366FF', sourceId: 'nowcoder', sourceUrl: 'https://ac.nowcoder.com/acm/contest/1',
    startsAt: now - 7200000, endsAt: now - 3600000, fetchedAt: now - 86400000 };
  const future = { ...base, id: 'nc-2', title: '牛客周赛 Round 2', sourceUrl: 'https://ac.nowcoder.com/acm/contest/2',
    startsAt: now + 86400000, endsAt: now + 90000000 };
  await service.research(key, 'deepseek-flash', profile(), [base, future], false, () => {});
  const input = JSON.parse(JSON.parse(calls[0].options.extraData).messages[1].content);
  assert.equal(input.sources[0].title, future.title, 'current and upcoming precede ended contests');
  assert.ok(input.sources[1].summary.includes('比赛已结束'));
  assert.ok(input.sources[0].summary.includes('尚未开赛'));
  assert.ok(input.sources.every(s => s.summary.includes('报名截止：未知')));
  const format = require('../entry/src/main/ets/model/Radar.ets').formatBeijing;
  assert.ok(input.sources[1].summary.includes('开赛时间（北京时间）：' + format(base.startsAt)));
  assert.ok(input.sources[1].summary.includes('结束时间（北京时间）：' + format(base.endsAt)));
  assert.ok(input.sources[1].summary.includes('资料读取时间（北京时间）：' + format(base.fetchedAt)));
});

function reportFixture(count = 1) {
  return { version: 1, checkedAt: Date.now(), mode: 'web', profile: profile(), queries: ['国内软件竞赛'],
    searchedCount: count, items: Array.from({ length: count }, (_, i) => ({
      source: { ...source({ id: 'S' + (i+1), url: 'https://contest.example.cn/' + i }), date: '',
        summary: '国内大学生软件大赛项目说明。'.repeat(100) },
      evidence: selection().evidence, reason: '建议积累代码和测试报告。'.repeat(20), action: '建议先阅读报名规则。'.repeat(20)
    })) };
}

function reportStoreWith(disk = new Map(), failure = '') {
  const path = require.resolve('../entry/src/main/ets/services/AiReportStore.ets');
  delete require.cache[path];
  const fileIo = { OpenMode: { CREATE: 1, READ_WRITE: 2, TRUNC: 4 },
    accessSync: path => disk.has(path), statSync: path => ({ size: Buffer.byteLength(disk.get(path)) }),
    readTextSync: path => disk.get(path), openSync: path => ({ fd: path }),
    writeSync: (path, value) => disk.set(path, failure === 'partial' ? value.slice(0, 100) : value),
    fsyncSync: () => { if (failure === 'sync') throw new Error('fsync failed'); }, closeSync: () => {},
    renameSync: (a, b) => { if (failure === 'rename') throw new Error('rename failed'); disk.set(b, disk.get(a)); disk.delete(a); }
  };
  Module._load = function(name, parent, isMain) {
    return name === '@kit.CoreFileKit' ? { fileIo } : originalLoad.call(this, name, parent, isMain);
  };
  try { return new (require(path).AiReportStore)({ filesDir: '/fixture' }); }
  finally { Module._load = originalLoad; }
}

test('large AI report beyond preference string limit survives file store reload', () => {
  const disk = new Map();
  const report = reportFixture(8);
  assert.ok(JSON.stringify(report).length > 8192);
  const store = reportStoreWith(disk);
  assert.equal(store.read(), undefined);
  store.save(report);
  assert.deepEqual(reportStoreWith(disk).read(), report);
  assert.equal(disk.has('/fixture/ai-report-v1.json.tmp'), false);
});

test('partial report write, fsync or rename failure never replace previous saved report', () => {
  const disk = new Map();
  const previous = reportFixture();
  reportStoreWith(disk).save(previous);
  for (const failure of ['partial', 'sync', 'rename']) {
    assert.throws(() => reportStoreWith(disk, failure).save(reportFixture(8)), /旧报告文件保留/);
    assert.deepEqual(reportStoreWith(disk).read(), previous);
  }
});

test('report reload revalidates evidence, field limits, item counts and displayable time', () => {
  for (const patch of [{ checkedAt: 1e30 }, { searchedCount: 0 }, { searchedCount: 2.5 },
    { queries: ['a', 'b', 'c', 'd'] }, { items: [{ ...reportFixture().items[0], evidence: '模型凭空生成的假证据内容' }] },
    { items: [{ ...reportFixture().items[0], reason: 'x'.repeat(701) }] }]) {
    const raw = JSON.stringify({ ...reportFixture(), ...patch });
    assert.throws(() => ai.readAiReport(raw));
    const disk = new Map([['/fixture/ai-report-v1.json', raw]]);
    assert.throws(() => reportStoreWith(disk).read(), /原文件未覆盖/);
    assert.equal(disk.get('/fixture/ai-report-v1.json'), raw);
  }
  assert.throws(() => reportStoreWith(new Map([['/fixture/ai-report-v1.json', '']])).read(), /原文件未覆盖/);
});
test('API failures are safe, explain cause, stop later calls and do not retry', async () => {
  for (const status of [400, 401, 402, 403, 404, 429, 500, 504]) {
    const { service, calls } = loadService(() => ({ responseCode: status, result: 'secret-body-' + key }));
    await assert.rejects(service.research(key, 'deepseek-flash', profile(), [], true, () => {}), error => {
      assert.ok(!error.message.includes(key));
      assert.ok(!error.message.includes('secret-body'));
      return true;
    });
    assert.equal(calls.length, 1);
  }
});
test('network failures do not leak raw headers or keys', async () => {
  const { service } = loadService(() => { throw new Error('Authorization: Bearer ' + key); });
  await assert.rejects(service.testConnection(key, 'deepseek-flash'), error => !error.message.includes(key));
});
test('malformed or truncated responses fail without leaking raw response content', async () => {
  for (const response of [{ responseCode: 200, result: key }, chatResponse({ finish_reason: 'length' }),
    chatResponse({ message: null }), chatResponse({ message: {} })]) {
    const { service } = loadService(url => url.endsWith('/search') ? searchResponse([source()]) : response);
    await assert.rejects(service.research(key, 'deepseek-flash', profile(), [], true, () => {}), error => !error.message.includes(key));
  }
});
test('cancellation prevents subsequent search and model calls and destroys request', async () => {
  let harness;
  harness = loadService(() => { harness.service.cancel(); return searchResponse([source()]); });
  await assert.rejects(harness.service.research(key, 'deepseek-flash', profile(), [], true, () => {}), /已取消/);
  assert.equal(harness.calls.length, 1);
  assert.ok(harness.objects.every(o => o.destroyed));
});
test('invalid key or model fails before any HTTP request', async () => {
  const { service, calls } = loadService(() => { throw new Error('Must not execute'); });
  await assert.rejects(service.research('bad', 'deepseek-flash', profile(), [], true, () => {}));
  await assert.rejects(service.research(key, 'fake-model', profile(), [], true, () => {}));
  assert.equal(calls.length, 0);
});

test('secure key store uses AssetStore only, supports replace/read/delete and no plaintext fallback', async () => {
  let values;
  let fail = false;
  const Tag = { ALIAS: 1, SECRET: 2, RETURN_TYPE: 3, ACCESSIBILITY: 4, SYNC_TYPE: 5, CONFLICT_RESOLUTION: 6 };
  const asset = { Tag, ReturnType: { ALL: 0, ATTRIBUTES: 1 }, Accessibility: { DEVICE_UNLOCKED: 2 },
    SyncType: { THIS_DEVICE: 1 }, ConflictResolution: { OVERWRITE: 0 },
    add: async map => { if (fail) throw new Error(key); values = map; },
    query: async query => {
      if (fail) throw Object.assign(new Error(key), { code: 24000001 });
      if (!values) throw Object.assign(new Error('missing'), { code: 24000002 });
      return [query.get(Tag.RETURN_TYPE) === 1 ? new Map([[Tag.ALIAS, values.get(Tag.ALIAS)]]) : values];
    }, remove: async () => { values = undefined; } };
  const path = require.resolve('../entry/src/main/ets/services/AiKeyStore.ets');
  delete require.cache[path];
  Module._load = function(name, parent, isMain) {
    if (name === '@kit.AssetStoreKit') return { asset };
    if (name === '@kit.ArkTS') return { util: {
      TextEncoder: class { encodeInto(value) { return new TextEncoder().encode(value); } },
      TextDecoder: class { decodeToString(value) { return new TextDecoder().decode(value); } }
    } };
    return originalLoad.call(this, name, parent, isMain);
  };
  let store;
  try { store = new (require(path).AiKeyStore)(); } finally { Module._load = originalLoad; }
  assert.equal(await store.exists(), false);
  assert.equal(await store.read(), '');
  await store.save(key);
  assert.equal(await store.exists(), true);
  assert.equal(await store.read(), key);
  assert.equal(values.get(Tag.ACCESSIBILITY), 2);
  assert.equal(values.get(Tag.SYNC_TYPE), 1);
  assert.equal(values.get(Tag.CONFLICT_RESOLUTION), 0);
  await store.save(key + '2');
  assert.equal(await store.read(), key + '2');
  fail = true;
  await assert.rejects(store.save(key), error => !error.message.includes(key));
  await assert.rejects(store.read(), /不会改用明文/);
  fail = false;
  await store.remove();
  assert.equal(await store.exists(), false);
});
test('UI keeps AI opt-in, no scheduling hook, masked key and separate scrolling report', () => {
  const code = fs.readFileSync(require.resolve('../entry/src/main/ets/pages/Index.ets'), 'utf8');
  assert.ok(code.includes('type(InputType.Password).showPasswordIcon(false)'));
  assert.ok(code.includes(".id('aiResearchScroll')"));
  assert.ok(code.includes('同意并开始'));
  assert.ok(!code.slice(code.indexOf('private checkSchedule()'), code.indexOf('private async refreshOnline()')).includes('runAi'));
  const store = fs.readFileSync(require.resolve('../entry/src/main/ets/services/AiKeyStore.ets'), 'utf8');
  assert.ok(!store.includes('LocalStore') && !store.includes('fileIo'));
});
