const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require(process.env.ARK_TYPESCRIPT_PATH || require.resolve('typescript', { paths: [path.join(__dirname, '../web')] }));
require.extensions['.ets'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename);
const radar = require('../entry/src/main/ets/model/Radar.ets');
const model = require('../entry/src/main/ets/model/Competition.ets');
const parsers = require('../entry/src/main/ets/services/FeedParsers.ets');
const now = Date.parse('2026-10-19T12:00:00+08:00');
const cfRow = patch => ({ id: 1234, name: 'Fixture round', phase: 'BEFORE', startTimeSeconds: (now + 86400000) / 1000,
  durationSeconds: 7200, ...patch });
const cf = rows => JSON.stringify({ status: 'OK', result: rows });
const fixture = patch => ({ ...parsers.parseCodeforces(cf([cfRow()]), now)[0], ...patch });
const query = patch => ({ keyword: '', category: '全部方向', filter: '全部', view: '发现比赛',
  favoriteIds: [], plannedIds: [], now, ...patch });
const ncRow = patch => ({ contestId: 123, contestName: '牛客周赛 Round 100',
  contestStartTime: now + 3600000, contestEndTime: now + 10800000, topCategoryId: 13,
  settingInfo: { organizerName: '牛客竞赛' }, ...patch });
const nc = rows => rows.map(row => '<div class="platform-item js-item" data-json="' +
  JSON.stringify(row).replace(/&/g, '&amp;').replace(/"/g, '&amp;quot;') + '"></div>').join('');
const domesticFixture = patch => ({ ...parsers.parseNowcoder(nc([ncRow()]), now)[0], ...patch });

test('domestic source list never requests overseas feeds', () => {
  const sources = require('../entry/src/main/ets/data/OfficialSources.ets').OFFICIAL_SOURCES;
  assert.deepEqual(sources.filter(s => s.automatic).map(s => s.id), ['4c', 'nowcoder']);
  assert.equal(sources.some(s => /atcoder|codeforces/.test(s.url)), false);
});
test('Nowcoder parses official escaped data, exact times and deduplicates contests', () => {
  const row = ncRow();
  const items = parsers.parseNowcoder(nc([row, row]), now);
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceUrl, 'https://ac.nowcoder.com/acm/contest/123');
  assert.equal(items[0].startsAt, row.contestStartTime);
  assert.equal(items[0].endsAt, row.contestEndTime);
  assert.equal(items[0].deadline, '');
  assert.equal(model.isDomesticCompetition(items[0]), true);
  assert.equal(radar.isSafeOfficialUrl(items[0].sourceUrl), true);
});
test('Nowcoder excludes foreign reprints, unverified organizers and out-of-window records', () => {
  const rows = [ncRow(), ncRow({contestId: 124, contestName: 'AtCoder ABC 481'}),
    ncRow({contestId: 125, settingInfo: {organizerName: 'Codeforces'}}),
    ncRow({contestId: 126, topCategoryId: 99}),
    ncRow({contestId: 127, contestStartTime: now - 10*86400000, contestEndTime: now - 8*86400000}),
    ncRow({contestId: 128, contestStartTime: now + 121*86400000, contestEndTime: now + 122*86400000})];
  assert.deepEqual(parsers.parseNowcoder(nc(rows), now).map(i => i.id), ['nc-123']);
  assert.throws(() => parsers.parseNowcoder('<html>Access denied</html>', now));
  assert.throws(() => parsers.parseNowcoder(nc([ncRow({contestEndTime: 0})]), now));
});
test('domestic catalog projection hides overseas cache without deleting saved records', () => {
  const local = domesticFixture({});
  const notice = parsers.parse4C('<li><a href="info/1042/999.htm">国内公告</a><i>2026-10-18</i></li>', now)[0];
  const foreign = fixture({});
  const items = [foreign, local, notice, domesticFixture({sourceUrl: 'https://atcoder.jp/contests/x'}),
    domesticFixture({organizer: 'unknown'})];
  assert.deepEqual(items.filter(model.isDomesticCompetition).map(i => i.id), [local.id, notice.id]);
  assert.equal(items[0], foreign);
});

test('daily scheduler uses Beijing time, catches up, and respects retry cooldown', () => {
  const t = Date.parse('2026-10-19T08:00:00+08:00');
  assert.equal(radar.shouldRefresh(t, 0, t - 86400000, '08:00'), true);
  assert.equal(radar.shouldRefresh(t - 1, 0, t - 86400000, '08:00'), false);
  assert.equal(radar.shouldRefresh(t + 3600000, t, t, '08:00'), false);
  assert.equal(radar.shouldRefresh(t + 899999, t, 0, '08:00'), false);
  assert.equal(radar.shouldRefresh(t + 900000, t, 0, '08:00'), true);
  assert.equal(radar.shouldRefresh(t, 0, 0, '24:00'), false);
  assert.equal(radar.shouldRefresh(t - 3600000, 0, 0, '08:00'), true);
});
test('Beijing formatting crosses UTC calendar day correctly', () => {
  assert.equal(radar.formatBeijing(Date.parse('2026-10-18T16:30:00Z')), '2026-10-19 00:30');
});
test('official links reject unsafe URLs and lookalike domains', () => {
  for (const value of ['https://atcoder.jp/contests/abc481', 'https://algo.qq.com/', 'https://jsjds.blcu.edu.cn/info/1042/1.htm']) {
    assert.equal(radar.isSafeOfficialUrl(value), true, value);
  }
  for (const value of ['javascript:alert(1)', 'http://atcoder.jp/', 'https://atcoder.jp.evil.test/',
    'https://atcoder.jp@evil.test/', 'https://atcoder.jp\\@evil.test/', 'https://atcoder.jp/ test',
    'file:///tmp/test', 'https://atcoder.jp:9999/']) assert.equal(radar.isSafeOfficialUrl(value), false, value);
});
test('Codeforces parser keeps recent and upcoming schedule without inventing deadlines', () => {
  const items = parsers.parseCodeforces(cf([cfRow(), cfRow({ id: 0 }), cfRow({ id: 2, startTimeSeconds: 0 }),
    cfRow({ id: 3, startTimeSeconds: (now + 121 * 86400000) / 1000 }), null]), now);
  assert.equal(items.length, 1);
  assert.equal(items[0].deadline, '');
  assert.equal(items[0].startsAt, now + 86400000);
  assert.equal(items[0].sourceUrl, 'https://codeforces.com/contest/1234');
});
test('invalid API responses fail explicitly', () => {
  for (const text of ['not json', 'null', JSON.stringify({ status: 'FAILED' })]) {
    assert.throws(() => parsers.parseCodeforces(text, now));
  }
  assert.throws(() => parsers.parseCodeforces(cf([{ renamedId: 12 }]), now));
  assert.deepEqual(parsers.parseCodeforces(cf([]), now), []);
});
test('AtCoder timezone and long contests are parsed correctly', () => {
  const html = '<title>AtCoder</title><div id="contest-table-upcoming"><tr><td><time class="fixtime">2026-10-24 21:00:00+0900</time></td>' +
    '<td><a href="/contests/fixture">Fixture &amp; Practice</a></td><td>240:00</td></tr></div>';
  const [item] = parsers.parseAtCoder(html, now);
  assert.equal(item.title, 'Fixture & Practice');
  assert.equal(radar.formatBeijing(item.startsAt), '2026-10-24 20:00');
  assert.equal(item.endsAt - item.startsAt, 240 * 3600000);
  assert.throws(() => parsers.parseAtCoder('<html>Access denied</html>', now));
  assert.throws(() => parsers.parseAtCoder('<title>AtCoder</title><div id="contest-table-upcoming"><tr><td>Changed markup</td></tr></div>', now));
  assert.throws(() => parsers.parseAtCoder(html.replace('2026-10-24', '2026-02-30'), now));
});
test('4C retains actual announcement dates and never infers open registration', () => {
  const html = '<li><a href="info/1042/999.htm">Fixture notice</a><i>2026-10-18</i></li>';
  const [item] = parsers.parse4C(html, now);
  assert.equal(item.publishedAt, '2026-10-18');
  assert.equal(item.kind, 'announcement');
  assert.equal(item.deadline, '');
  assert.equal(model.filterCompetitions([item], query({ filter: '未截止' })).length, 0);
  assert.throws(() => parsers.parse4C('<html>Changed markup</html>', now));
});
test('refresh preserves saved events missing from latest feed and deduplicates', () => {
  const a = fixture({ id: 'a' }), b = fixture({ id: 'b' }), c = fixture({ id: 'c', sourceId: 'atcoder' });
  const incoming = fixture({ id: 'd' });
  const merged = radar.mergeSourceItems([a, b, c], [incoming, incoming], 'codeforces', ['a']);
  assert.deepEqual(merged.map(x => x.id), ['a', 'c', 'd']);
});
test('live schedule ranks active and upcoming first, then newest announcements', () => {
  const old = fixture({ id: 'old', startsAt: now - 86400000, endsAt: now - 3600000 });
  const near = fixture({ id: 'near', startsAt: now + 3600000 });
  const far = fixture({ id: 'far', startsAt: now + 7200000 });
  const a = fixture({ id: 'a', startsAt: undefined, endsAt: undefined, kind: 'announcement', publishedAt: '2026-10-18' });
  const b = { ...a, id: 'b', publishedAt: '2026-10-19' };
  assert.deepEqual(model.filterCompetitions([old, a, far, b, near], query({})).map(x => x.id), ['near', 'far', 'b', 'a', 'old']);
  assert.equal(model.filterCompetitions([old, near], query({ filter: '已结束' }))[0].id, 'old');
});
test('running event is not mislabeled as a registration deadline', () => {
  const item = fixture({ startsAt: now - 1000, endsAt: now + 1000 });
  assert.equal(model.deadlineLabel(item, now), '比赛进行中');
  assert.equal(model.deadlineLabel(item, now + 1000), '比赛已结束');
  assert.equal(model.filterCompetitions([item], query({ filter: '进行中' })).length, 1);
  assert.equal(model.isDueSoon(item, now), false);
});

function serviceWith({ response, disk = new Map(), failRename = false } = {}) {
  const filename = require('node:path').resolve(__dirname, '../entry/src/main/ets/services/RadarService.ets');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const exports = {};
  const requests = [];
  const mockFs = {
    OpenMode: { CREATE: 1, READ_WRITE: 2, TRUNC: 4 },
    accessSync: key => disk.has(key), readTextSync: key => disk.get(key),
    openSync: key => ({ fd: key }), writeSync: (key, value) => { disk.set(key, value); return value.length; },
    fsyncSync: () => {}, closeSync: () => {},
    renameSync: (a,b) => { if (failRename) throw new Error('Disk full'); disk.set(b, disk.get(a)); disk.delete(a); }
  };
  new Function('require', 'exports', code)(name => {
    if (name === '@kit.CoreFileKit') return { fileIo: mockFs };
    if (name === '@kit.NetworkKit') return { http: {
      RequestMethod: { GET: 'GET' }, HttpDataType: { STRING: 'STRING' },
      createHttp: () => { const request = { destroyed: false, request: (url, options) => response(url, options),
        destroy() { this.destroyed = true; } }; requests.push(request); return request; }
    } };
    if (name.startsWith('../model/')) return require('../entry/src/main/ets/model/' + name.split('/').at(-1) + '.ets');
    if (name === '../data/OfficialSources') return require('../entry/src/main/ets/data/OfficialSources.ets');
    if (name === './FeedParsers') return parsers;
    throw new Error('Unexpected dependency ' + name);
  }, exports);
  return { service: new exports.RadarService({ filesDir: '/fixture' }), requests, disk };
}

test('partial domestic update preserves failed source and archived foreign records', async () => {
  const prior = { ...radar.emptyCache(), items: [domesticFixture({ id: 'saved-nc' }),
    fixture({ id: 'saved-at', sourceId: 'atcoder' }), domesticFixture({ id: 'saved-4c', sourceId: '4c' })], lastSuccess: 123 };
  const urls = [];
  const { service, requests } = serviceWith({ response: async url => {
    urls.push(url);
    if (url.includes('nowcoder')) return { responseCode: 200, result: nc([ncRow({
      contestStartTime: Date.now() + 3600000, contestEndTime: Date.now() + 7200000})]) };
    throw new Error('Offline fixture');
  }});
  const result = await service.refresh(prior, ['saved-nc']);
  assert.equal(result.reports.filter(r => r.success).length, 1);
  assert.equal(result.reports.length, 2);
  assert.ok(result.items.some(i => i.id === 'saved-at'));
  assert.ok(result.items.some(i => i.id === 'saved-nc'));
  assert.ok(result.items.some(i => i.id === 'saved-4c'));
  assert.equal(urls.some(url => /atcoder|codeforces/.test(url)), false);
  assert.equal(result.lastSuccess, 123);
  assert.equal(requests.every(r => r.destroyed), true);
});
test('legacy cache migration resets source update timers and retains all old entries', () => {
  const old = { version: 1, items: [fixture({})], reports: [{id:'codeforces',success:true,count:1,checkedAt:now,message:'读取成功'}],
    lastAttempt: now, lastSuccess: now };
  const disk = new Map([['/fixture/radar-cache-v1.json', JSON.stringify(old)]]);
  const migrated = serviceWith({disk}).service.readCache();
  assert.deepEqual(migrated.items, old.items);
  assert.equal(migrated.sourceScope, 'domestic-v1');
  assert.equal(migrated.lastAttempt, 0);
  assert.equal(migrated.lastSuccess, 0);
  assert.deepEqual(migrated.reports, []);
});
test('complete offline failure keeps catalog intact and allows throttled retry', async () => {
  const prior = { ...radar.emptyCache(), items: [fixture({})], lastSuccess: 123 };
  const { service } = serviceWith({ response: async () => { throw new Error('Offline'); } });
  const result = await service.refresh(prior, []);
  assert.deepEqual(result.items, prior.items);
  assert.equal(result.reports.every(r => !r.success), true);
  assert.ok(result.lastAttempt > 0);
  assert.equal(result.lastSuccess, 123);
});
test('cache round trip, schema validation and atomic commit failure', () => {
  const snapshot = { ...radar.emptyCache(), items: [fixture({})] };
  const disk = new Map();
  const { service } = serviceWith({disk});
  assert.deepEqual(service.readCache(), radar.emptyCache());
  service.saveCache(snapshot);
  assert.deepEqual(service.readCache(), snapshot);
  const failed = serviceWith({disk, failRename: true}).service;
  assert.throws(() => failed.saveCache(radar.emptyCache()), /缓存保存失败/);
  assert.deepEqual(service.readCache(), snapshot);
  disk.set('/fixture/radar-cache-v1.json', JSON.stringify({ ...snapshot, items: [null] }));
  assert.throws(() => service.readCache(), /缓存读取失败/);
});
