const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require(process.env.ARK_TYPESCRIPT_PATH || require.resolve('typescript', { paths: [path.join(__dirname, '../web')] }));

// Only compile pure model/data modules. ArkUI pages are validated by Hvigor.
require.extensions['.ets'] = (module, filename) => {
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename.replace(/\.ets$/, '.ts')
  });
  module._compile(result.outputText, filename);
};
const model = require('../entry/src/main/ets/model/Competition.ets');
const { DEMO_COMPETITIONS: items } = require('../entry/src/main/ets/data/DemoCompetitions.ets');
const fixedNow = Date.parse('2026-10-18T12:00:00+08:00');
const fixture = deadline => ({ ...items[0], deadline });
const query = patch => ({ keyword: '', category: '全部方向', filter: '全部', view: '发现比赛',
  favoriteIds: [], plannedIds: [], now: fixedNow, ...patch });

test('deadline remains open through the last millisecond in Beijing', () => {
  const item = fixture('2026-10-18');
  assert.equal(model.remainingDays(item, Date.parse('2026-10-18T23:59:59.999+08:00')), 0);
  assert.equal(model.remainingDays(item, Date.parse('2026-10-19T00:00:00+08:00')), -1);
  assert.equal(model.deadlineLabel(item, fixedNow), '今天截止');
});
test('date math uses Beijing dates even when host is another timezone', () => {
  assert.equal(model.remainingDays(fixture('2026-10-18'), Date.parse('2026-10-17T17:00:00Z')), 0);
});
test('past dates are not upcoming', () => {
  assert.equal(model.isDueSoon(fixture('2026-10-17'), fixedNow), false);
  assert.equal(model.deadlineLabel(fixture('2026-10-17'), fixedNow), '已截止');
});
test('upcoming includes today and seven calendar days but not eight', () => {
  assert.equal(model.isDueSoon(fixture('2026-10-18'), fixedNow), true);
  assert.equal(model.isDueSoon(fixture('2026-10-25'), fixedNow), true);
  assert.equal(model.isDueSoon(fixture('2026-10-26'), fixedNow), false);
});
test('invalid or rolled-over dates are rejected, leap days are supported', () => {
  for (const date of ['', 'NA', '2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-1-01']) {
    assert.equal(Number.isNaN(model.deadlineTimestamp(date)), true, date);
    assert.equal(model.remainingDays(fixture(date), fixedNow), null, date);
  }
  assert.equal(Number.isFinite(model.deadlineTimestamp('2028-02-29')), true);
});
test('search normalizes spaces and case and matches skill tags', () => {
  assert.deepEqual(model.filterCompetitions(items, query({ keyword: '  aRkTs  ' })).map(i => i.id), ['demo-software']);
  assert.equal(model.filterCompetitions(items, query({ keyword: '演示主办方' })).length, 5);
});
test('keyword and category filters intersect', () => {
  assert.equal(model.filterCompetitions(items, query({ keyword: 'Python', category: '软件开发' })).length, 0);
});
test('favorites view only shows favorited records', () => {
  assert.deepEqual(model.filterCompetitions(items, query({ view: '我的收藏', favoriteIds: ['demo-ai'] })).map(i => i.id), ['demo-ai']);
});
test('plan view does not leak favorites into plans', () => {
  assert.deepEqual(model.filterCompetitions(items, query({ view: '报名计划', plannedIds: ['demo-cloud'], favoriteIds: ['demo-ai'] })).map(i => i.id), ['demo-cloud']);
});
test('empty favorites are actually empty', () => {
  assert.equal(model.filterCompetitions(items, query({ view: '我的收藏' })).length, 0);
});
test('upcoming excludes expired events and honors the seven day boundary', () => {
  assert.deepEqual(model.filterCompetitions(items, query({ filter: '7 天内截止' })).map(i => i.id), ['demo-software']);
});
test('expired and available filters are mutually exclusive', () => {
  assert.equal(model.filterCompetitions(items, query({ filter: '已截止' })).length, 1);
  assert.equal(model.filterCompetitions(items, query({ filter: '未截止' })).length, 4);
});
test('sort puts upcoming deadlines first without modifying source order', () => {
  const before = items.map(i => i.id);
  assert.deepEqual(model.filterCompetitions(items, query({})).map(i => i.id),
    ['demo-software', 'demo-ai', 'demo-cloud', 'demo-innovation', 'demo-algorithm']);
  assert.deepEqual(items.map(i => i.id), before);
});
test('unknown deadlines sort last and never count as available', () => {
  const unknown = { ...items[0], id: 'unknown', deadline: '' };
  const all = [...items, unknown];
  assert.equal(model.filterCompetitions(all, query({})).at(-1).id, 'unknown');
  assert.equal(model.filterCompetitions(all, query({ filter: '未截止' })).some(i => i.id === 'unknown'), false);
});
test('toggle returns new arrays and supports removing a favorite', () => {
  const initial = [];
  const selected = model.toggleId(initial, 'demo-ai');
  assert.deepEqual(initial, []);
  assert.deepEqual(selected, ['demo-ai']);
  assert.deepEqual(model.toggleId(selected, 'demo-ai'), []);
});
test('stored IDs are deduplicated and unknown or malformed IDs removed', () => {
  assert.deepEqual(model.validIds(['demo-ai', 'missing', 'demo-ai', 12], items), ['demo-ai']);
});
test('time settings accept only exact valid 24-hour HH:mm', () => {
  for (const value of ['00:00', '08:00', '23:59']) assert.equal(model.validTime(value), true);
  for (const value of ['24:00', '08:60', '8:00', '', '09:0', 'aa:bb']) assert.equal(model.validTime(value), false);
});
test('demo records have stable unique keys and disclose fictional status', () => {
  assert.equal(new Set(items.map(i => i.id)).size, items.length);
  assert.ok(items.every(i => i.title.includes('示例') && i.organizer === '演示主办方'));
});

function storeWith(mock) {
  const filename = path.resolve(__dirname, '../entry/src/main/ets/services/LocalStore.ets');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name === '@kit.ArkData') return { preferences: { getPreferencesSync: () => mock } };
    throw new Error('Unexpected dependency ' + name);
  }, exports);
  return new exports.LocalStore({});
}
test('storage discards malformed IDs and invalid preference types', () => {
  const store = storeWith({ getSync: key => key === 'ids' ? ['demo-ai', 22] : false });
  assert.deepEqual(store.readIds('ids'), ['demo-ai']);
  assert.equal(store.readText('direction', '软件开发'), '软件开发');
});
test('storage writes all preferences and waits for disk flush', async () => {
  const values = new Map(); let flushed = false;
  const store = storeWith({ putSync: (key, value) => values.set(key, value), flush: async () => { flushed = true; } });
  await store.save(['demo-ai'], ['demo-cloud'], '网络安全', '09:30');
  assert.deepEqual(values.get('favorites'), ['demo-ai']);
  assert.deepEqual(values.get('planned'), ['demo-cloud']);
  assert.equal(values.get('direction'), '网络安全');
  assert.equal(values.get('updateTime'), '09:30');
  assert.equal(flushed, true);
});
test('storage read failures propagate instead of silently resetting user data', () => {
  const store = storeWith({ getSync: () => { throw new Error('I/O'); } });
  assert.throws(() => store.readIds('favorites'), /读取本地列表失败/);
  assert.throws(() => store.readText('direction', ''), /读取本地偏好失败/);
});
test('storage flush failures reject so UI can show an unsaved warning', async () => {
  const store = storeWith({ putSync: () => {}, flush: async () => { throw new Error('I/O'); } });
  await assert.rejects(store.save([], [], '软件开发', '08:00'), /持久化失败/);
});
test('project notes persist and only the selected note is removed', async () => {
  const values = new Map([['note.keep', 'preserve']]); let flushes = 0;
  const store = storeWith({
    putSync: (key, value) => values.set(key, value), getSync: (key, fallback) => values.get(key) ?? fallback,
    deleteSync: key => values.delete(key), flush: async () => { flushes++; }
  });
  const note = JSON.stringify({id:'fixture', stage:'准备中', text:'个人职责：实现解析器', updatedAt:123});
  await store.saveText('note.fixture', note);
  assert.equal(store.readText('note.fixture', ''), note);
  await store.removeText('note.fixture');
  assert.equal(store.readText('note.fixture', ''), '');
  assert.equal(store.readText('note.keep', ''), 'preserve');
  assert.equal(flushes, 2);
});
test('note write and delete failures remain visible to callers', async () => {
  const store = storeWith({putSync:()=>{}, deleteSync:()=>{}, flush:async()=>{throw new Error('I/O');}});
  await assert.rejects(store.saveText('note.fixture', 'text'), /保存失败/);
  await assert.rejects(store.removeText('note.fixture'), /清除本地记录失败/);
});
