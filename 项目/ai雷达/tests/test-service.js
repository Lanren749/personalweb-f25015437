'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const express = require('express');
const { createStore } = require('../server/intelligence/store');
const { createSchedulerService, mondayDateKey, nextScheduledAt } = require('../server/intelligence/schedule');
const { createIntelligenceRouter } = require('../server/routes/intelligence');
const { sign } = require('../server/auth');
const { DEFAULT_SETTINGS } = require('../server/intelligence/settings');

function fakeStore({ job = { status: 'idle', periodStart: null, attempts: 0 }, snapshot = null, lock = true, transactional = false } = {}) {
  let current = { ...job };
  let latest = snapshot;
  const history = [];
  let held = false;
  let backup;
  const events = [];
  const connection = transactional ? {
    beginTransaction: async () => { events.push('begin'); backup = { current: { ...current }, latest, history: history.slice() }; },
    commit: async () => { events.push('commit'); backup = null; },
    rollback: async () => {
      events.push('rollback');
      if (backup) { current = backup.current; latest = backup.latest; history.splice(0, history.length, ...backup.history); backup = null; }
    }
  } : {};
  const store = {
    history,
    getJob: async () => ({ ...current }),
    setJob: async update => {
      if ((update.status !== 'running' || current.status === 'running') && (update.runId || null) !== (current.runId || null)) return { ...current, changed: false };
      current = { ...current, ...update }; return { ...current, changed: true };
    },
    appendJobHistory: async item => { history.push({ ...item }); },
    latestSnapshot: async () => latest,
    saveSnapshot: async item => { latest = item; return item; },
    getSnapshot: async () => latest,
    reviews: async () => ({}),
    saveReview: async () => ({}),
    withAdvisoryLock: async fn => {
      if (!lock || held) return { acquired: false, value: null };
      held = true;
      try { return { acquired: true, value: await fn(connection) }; }
      finally { held = false; }
    }
  };
  store.read = () => ({ current, latest, history, held, events });
  return store;
}

test('weekly period uses Asia/Shanghai regardless of host timezone', () => {
  assert.equal(mondayDateKey(new Date('2026-10-18T15:59:00.000Z')), '2026-10-12');
  const sunday = new Date('2026-10-18T23:30:00.000Z'); // Monday 07:30 Beijing
  const monday = new Date('2026-10-19T01:00:00.000Z'); // Monday 09:00 Beijing
  assert.equal(mondayDateKey(sunday), '2026-10-19');
  assert.equal(mondayDateKey(monday), '2026-10-19');
  assert.equal(nextScheduledAt(sunday).toISOString(), '2026-10-19T01:00:00.000Z');
  assert.equal(nextScheduledAt(monday).toISOString(), '2026-10-26T01:00:00.000Z');
  const code = "const s=require('./server/intelligence/schedule');console.log(JSON.stringify([s.mondayDateKey(new Date('2026-10-18T23:30:00Z')),s.nextScheduledAt(new Date('2026-10-18T23:30:00Z')).toISOString()]));";
  for (const TZ of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, ['-e', code], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)), ['2026-10-19', '2026-10-19T01:00:00.000Z']);
  }
});

function newSnapshot(id = 's1') {
  return { id, periodStart: '2026-10-12', periodEnd: '2026-10-19', generatedAt: '2026-10-19T01:00:00Z', companies: [] };
}

function settingsStore(initial = {}) {
  const store = fakeStore();
  let settings = { ...DEFAULT_SETTINGS, ...initial };
  store.getSettings = async () => ({ ...settings });
  store.saveSettings = async value => { settings = { ...value }; return { ...settings }; };
  return store;
}

test('saved daily settings take effect without collecting until the next future slot', async () => {
  let now = new Date('2026-10-21T01:30:00Z');
  const store = settingsStore();
  const received = [];
  const service = createSchedulerService({ store, clock: () => now, pipeline: { collectAndBuild: async options => { received.push(options); return newSnapshot(`s${received.length}`); } } });
  const settings = await service.updateSettings({ frequency: 'daily', time: '10:00', lookbackDays: 30 });
  assert.equal(settings.nextRunAt, '2026-10-21T02:00:00.000Z');
  assert.equal(settings.frequency, 'daily');
  assert.equal(settings.timezone, 'Asia/Shanghai');
  assert.equal('scheduleAfter' in settings, false);
  assert.equal(received.length, 0);
  await service.tick();
  assert.equal(received.length, 0);
  // The persisted cutoff must also prevent catch-up after restarting.
  const restarted = createSchedulerService({ store, clock: () => now, pipeline: { collectAndBuild: async options => { received.push(options); return newSnapshot(`s${received.length}`); } } });
  await restarted.tick();
  assert.equal(received.length, 0);
  now = new Date('2026-10-21T02:00:00Z');
  await restarted.tick();
  await service.tick();
  assert.equal(received.length, 1);
  assert.equal(received[0].lookbackDays, 30);
  assert.equal(store.read().current.reason, 'daily-schedule');
  assert.equal(store.read().current.periodStart, '2026-10-21');
  now = new Date('2026-10-22T01:59:59Z');
  await restarted.tick();
  assert.equal(received.length, 1);
  now = new Date('2026-10-22T02:00:00Z');
  await restarted.tick();
  assert.equal(received.length, 2);
});

test('weekly settings use Monday-one Sunday-seven and saved time is a strict lower bound', async () => {
  let now = new Date('2026-10-21T02:00:00Z');
  const store = settingsStore();
  let calls = 0;
  const service = createSchedulerService({ store, clock: () => now, pipeline: { collectAndBuild: async () => newSnapshot(`s${++calls}`) } });
  const settings = await service.updateSettings({ frequency: 'weekly', weekday: 7, time: '00:00' });
  assert.equal(settings.nextRunAt, '2026-10-24T16:00:00.000Z');
  await service.tick();
  assert.equal(calls, 0);
  now = new Date('2026-10-24T16:00:00Z');
  await service.tick();
  await service.tick();
  assert.equal(calls, 1);
  assert.equal(store.read().current.periodStart, '2026-10-25');
  assert.equal((await service.scheduleInfo()).nextRunAt, '2026-10-31T16:00:00.000Z');
  await service.updateSettings({ time: '00:00' });
  await service.tick();
  assert.equal(calls, 1);
});

test('changing the time on the same date creates a new future schedule slot', async () => {
  let now = new Date('2026-10-21T01:00:00Z');
  const store = settingsStore({ frequency: 'daily' });
  let calls = 0;
  const service = createSchedulerService({ store, clock: () => now, pipeline: { collectAndBuild: async () => newSnapshot(`s${++calls}`) } });
  await service.tick();
  assert.equal(calls, 1);
  now = new Date('2026-10-21T01:15:00Z');
  await service.updateSettings({ time: '10:00' });
  await service.tick();
  assert.equal(calls, 1);
  now = new Date('2026-10-21T02:00:00Z');
  await service.tick();
  await service.tick();
  assert.equal(calls, 2);
  assert.equal(store.read().current.scheduleKey, 'daily:*:10:00:2026-10-21');
});

test('daily failed jobs retry with backoff and successful retries deduplicate', async () => {
  let now = new Date('2026-10-21T01:00:00Z');
  const store = settingsStore({ frequency: 'daily' });
  let calls = 0;
  const service = createSchedulerService({ store, clock: () => now, retryBaseMs: 1000, pipeline: { collectAndBuild: async () => {
    calls += 1;
    if (calls === 1) throw new Error('transient failure');
    return newSnapshot();
  } } });
  await service.tick();
  await service.tick();
  assert.equal(calls, 1);
  now = new Date(now.getTime() + 1000);
  await service.tick();
  await service.tick();
  assert.equal(calls, 2);
  assert.equal(store.read().current.status, 'success');
});

test('settings disable automatic collection while preserving manual refresh and environment cap', async () => {
  let now = new Date('2026-10-21T01:00:00Z');
  const store = settingsStore();
  let calls = 0;
  const service = createSchedulerService({ store, clock: () => now, pipeline: { collectAndBuild: async () => newSnapshot(`s${++calls}`) } });
  assert.equal((await service.updateSettings({ enabled: false })).nextRunAt, null);
  await service.tick();
  assert.equal(calls, 0);
  await service.runRefresh();
  assert.equal(calls, 1);
  const previous = process.env.INTELLIGENCE_SCHEDULE_ENABLED;
  process.env.INTELLIGENCE_SCHEDULE_ENABLED = '0';
  try {
    assert.equal((await service.updateSettings({ enabled: true })).enabled, false);
    now = new Date('2026-10-26T01:00:00Z');
    await service.tick();
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.INTELLIGENCE_SCHEDULE_ENABLED;
    else process.env.INTELLIGENCE_SCHEDULE_ENABLED = previous;
  }
});

test('manual Monday-before-nine run does not consume the upcoming scheduled period', async () => {
  const store = fakeStore();
  let now = new Date('2026-10-19T00:59:00Z');
  let calls = 0;
  const service = createSchedulerService({ store, clock: () => now, pipeline: { collectAndBuild: async () => newSnapshot(`s${++calls}`) } });
  await service.runRefresh();
  assert.equal(store.read().current.periodStart, '2026-10-12');
  now = new Date('2026-10-19T01:00:00Z');
  await service.tick(now);
  assert.equal(calls, 2);
  assert.equal(store.read().current.periodStart, '2026-10-19');
  await service.tick(now);
  assert.equal(calls, 2);
});

test('scheduler catches up a missed Monday run after restart', async () => {
  const store = fakeStore();
  let calls = 0;
  const service = createSchedulerService({
    store,
    clock: () => new Date('2026-10-20T00:00:00.000Z'),
    pipeline: { collectAndBuild: async () => { calls += 1; return { id: 's1', periodStart: '2026-10-13', periodEnd: '2026-10-20', generatedAt: '2026-10-20T00:00:00Z' }; } }
  });
  const result = await service.tick(new Date('2026-10-20T00:00:00.000Z'));
  assert.equal(calls, 1);
  assert.equal(result.status, 'success');
  assert.equal(store.read().current.periodStart, '2026-10-19');
});

test('failed collection keeps the previous snapshot and schedules a retry', async () => {
  const previous = { id: 'old', periodStart: '2026-10-12', periodEnd: '2026-10-19' };
  const store = fakeStore({ snapshot: previous });
  const service = createSchedulerService({
    store,
    retryBaseMs: 1000,
    clock: () => new Date('2026-10-19T02:00:00.000Z'),
    pipeline: { collectAndBuild: async () => { throw new Error('source unavailable'); } }
  });
  await assert.rejects(service.runRefresh({ reason: 'manual' }), /source unavailable/);
  const state = store.read();
  assert.equal(state.latest, previous);
  assert.equal(state.current.status, 'failed');
  assert.ok(state.current.retryAfter);
  assert.equal(state.history.at(-1).status, 'failed');
});

test('concurrent refreshes do not run two pipelines', async () => {
  const store = fakeStore();
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const service = createSchedulerService({
    store,
    pipeline: { collectAndBuild: async () => { calls += 1; await gate; return { id: `s${calls}`, periodStart: '2026-10-12', periodEnd: '2026-10-19', generatedAt: '2026-10-19T01:00:00Z' }; } }
  });
  const first = await service.beginRefresh({ reason: 'manual' });
  const second = await service.beginRefresh({ reason: 'manual' });
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  release();
  await first.promise;
  assert.equal(calls, 1);
});

test('independent scheduler instances share the lock and cannot overwrite a live job', async () => {
  const store = fakeStore({ transactional: true });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const pipeline = { collectAndBuild: async () => { calls++; await gate; return newSnapshot(); } };
  const firstService = createSchedulerService({ store, pipeline });
  const otherService = createSchedulerService({ store, pipeline });
  const first = await firstService.beginRefresh();
  const originalRunId = store.read().current.runId;
  const second = await otherService.beginRefresh();
  assert.equal(second.acquired, false);
  await otherService.stopScheduler();
  assert.equal(store.read().current.runId, originalRunId);
  assert.equal(store.read().current.status, 'running');
  release();
  await first.promise;
  assert.equal(calls, 1);
  assert.equal(store.read().held, false);
});

test('orphan running row is recovered only after the advisory lock is acquired', async () => {
  for (const runId of [null, 'previous-process']) {
    const store = fakeStore({ transactional: true, job: { status: 'running', runId, periodStart: '2026-10-19', startedAt: '2026-10-19T01:00:00Z', attempts: 1 } });
    const service = createSchedulerService({ store, clock: () => new Date('2026-10-19T01:01:00Z'), pipeline: { collectAndBuild: async () => newSnapshot() } });
    await service.tick();
    assert.equal(store.read().current.status, 'success');
    assert.notEqual(store.read().current.runId, runId);
    assert.equal(store.read().history[0].status, 'failed');
    assert.equal(store.read().held, false);
  }
});

test('failed jobs back off and retry, including manual requests', async () => {
  let now = new Date('2026-10-19T02:00:00Z');
  const store = fakeStore();
  let calls = 0;
  const service = createSchedulerService({ store, clock: () => now, retryBaseMs: 1000, pipeline: { collectAndBuild: async () => { calls++; throw new Error('failure'); } } });
  await service.tick();
  assert.equal(calls, 1);
  await service.tick();
  const blocked = await service.beginRefresh();
  assert.equal(blocked.rateLimited, true);
  await blocked.promise;
  assert.equal(calls, 1);
  now = new Date(now.getTime() + 1000);
  await service.tick();
  assert.equal(calls, 2);
  assert.equal(new Date(store.read().current.retryAfter).getTime() - now.getTime(), 2000);
});

test('timeout aborts collection and late pipeline completion cannot replace old snapshot', async () => {
  const previous = newSnapshot('old');
  const store = fakeStore({ snapshot: previous, transactional: true });
  let finish;
  let signal;
  const service = createSchedulerService({ store, timeoutMs: 20, pipeline: { collectAndBuild: async options => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } } });
  await assert.rejects(service.runRefresh(), error => error.code === 'INTELLIGENCE_TIMEOUT');
  assert.equal(signal.aborted, true);
  finish(newSnapshot('late'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.read().latest, previous);
  assert.equal(store.read().current.status, 'failed');
  assert.equal(store.read().held, false);
});

test('stopScheduler aborts only its own active task and keeps old snapshot', async () => {
  const previous = newSnapshot('old');
  const store = fakeStore({ snapshot: previous, transactional: true });
  let signal;
  const service = createSchedulerService({ store, pipeline: { collectAndBuild: async options => { signal = options.signal; return new Promise(() => {}); } } });
  const started = await service.beginRefresh();
  await service.stopScheduler();
  await assert.rejects(started.promise, error => error.code === 'INTELLIGENCE_STOPPED');
  assert.ok(!signal || signal.aborted);
  assert.equal(store.read().latest, previous);
  assert.equal(store.read().current.status, 'failed');
  assert.equal(store.read().held, false);
});

test('initial running write failure rolls back and rejects beginRefresh without unhandled promise', async () => {
  const store = fakeStore({ transactional: true });
  const original = store.appendJobHistory;
  let first = true;
  store.appendJobHistory = async job => { if (first) { first = false; throw new Error('write failed'); } return original(job); };
  let calls = 0;
  const service = createSchedulerService({ store, pipeline: { collectAndBuild: async () => { calls++; return newSnapshot(); } } });
  await assert.rejects(service.beginRefresh(), /write failed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.read().current.status, 'idle');
  assert.equal(store.read().held, false);
  assert.equal(calls, 0);
  const retried = await service.beginRefresh();
  await retried.promise;
  assert.equal(store.read().current.status, 'success');
});

test('snapshot and terminal job changes roll back together when history commit fails', async () => {
  const previous = newSnapshot('old');
  const store = fakeStore({ snapshot: previous, transactional: true });
  const original = store.appendJobHistory;
  store.appendJobHistory = async job => { if (job.status === 'success') throw new Error('history unavailable'); return original(job); };
  const service = createSchedulerService({ store, pipeline: { collectAndBuild: async () => newSnapshot('new') } });
  await assert.rejects(service.runRefresh(), /history unavailable/);
  assert.equal(store.read().latest, previous);
  assert.equal(store.read().current.status, 'failed');
  assert.equal(store.read().events.filter(event => event === 'rollback').length, 1);
  assert.equal(store.read().held, false);
});

test('lost lock prevents publication and does not modify another process job', async () => {
  const previous = newSnapshot('old');
  const store = fakeStore({ snapshot: previous, transactional: true });
  const withLock = store.withAdvisoryLock;
  let owned = true;
  store.withAdvisoryLock = callback => withLock(connection => callback(connection, async () => {
    if (!owned) { const error = new Error('lost lock'); error.code = 'INTELLIGENCE_LOCK_LOST'; throw error; }
  }));
  const service = createSchedulerService({ store, pipeline: { collectAndBuild: async () => { owned = false; return newSnapshot('new'); } } });
  await assert.rejects(service.runRefresh(), error => error.code === 'INTELLIGENCE_LOCK_LOST');
  assert.equal(store.read().latest, previous);
  assert.equal(store.read().current.status, 'running');
  assert.equal(store.read().history.filter(job => job.status === 'failed').length, 0);
  assert.equal(store.read().held, false);
});

test('background rejection after beginRefresh is handled while failure is persisted', async () => {
  const store = fakeStore({ transactional: true });
  let rejectPipeline;
  const service = createSchedulerService({ store, pipeline: { collectAndBuild: async () => new Promise((_, reject) => { rejectPipeline = reject; }) } });
  const accepted = await service.beginRefresh();
  assert.equal(accepted.job.status, 'running');
  await new Promise(resolve => setImmediate(resolve));
  rejectPipeline(new Error('background failure'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.read().current.status, 'failed');
  assert.equal(store.read().held, false);
});

test('schema setup executes one DDL per query and can retry after failure', async () => {
  let calls = 0;
  const queries = [];
  const dbPool = {
    query: async sql => {
      queries.push(String(sql));
      calls += 1;
      if (calls === 1) throw new Error('temporary connection failure');
      return [[], {}];
    }
  };
  const store = createStore(dbPool);
  await assert.rejects(store.ensureSchema(), /temporary connection failure/);
  await store.ensureSchema();
  assert.ok(queries.length > 3);
  assert.ok(queries.every(sql => !sql.includes('\nCREATE TABLE')));
  assert.ok(queries.every(sql => !/\bDROP\b/i.test(sql)));
});

test('existing column migrations are idempotent and do not mask permission errors', async () => {
  let attempts = 0;
  const store = createStore({ query: async sql => {
    if (sql.startsWith('ALTER TABLE')) { attempts++; const error = new Error('duplicate'); error.code = 'ER_DUP_FIELDNAME'; throw error; }
    return [[], {}];
  } });
  await store.ensureSchema();
  const firstCount = attempts;
  await store.ensureSchema();
  assert.equal(attempts, firstCount);
  const forbidden = createStore({ query: async sql => {
    if (sql.startsWith('ALTER TABLE')) { const error = new Error('permission'); error.code = 'ER_TABLEACCESS_DENIED_ERROR'; throw error; }
    return [[], {}];
  } });
  await assert.rejects(forbidden.ensureSchema(), /permission/);
});

test('lease owns one connection and releases or destroys it on every exit', async () => {
  for (const scenario of ['ok', 'callback-fails', 'busy', 'owner-lost', 'release-fails', 'acquire-fails']) {
    const events = [];
    let callbackCalled = false;
    const connection = {
      query: async sql => {
        events.push(sql);
        if (sql.includes('GET_LOCK')) { if (scenario === 'acquire-fails') throw new Error('connection failed'); return [[{ acquired: scenario === 'busy' ? 0 : 1 }]]; }
        if (sql.includes('IS_USED_LOCK')) return [[{ owned: scenario === 'owner-lost' ? 0 : 1 }]];
        if (sql.includes('RELEASE_LOCK')) { if (scenario === 'release-fails') throw new Error('release failed'); return [[{ released: 1 }]]; }
        throw new Error('unexpected SQL');
      },
      release: () => events.push('release'),
      destroy: () => events.push('destroy')
    };
    const store = createStore({ query: async () => [[], {}], getConnection: async () => connection });
    const promise = store.withAdvisoryLock(async (leased, assertOwned) => {
      callbackCalled = true; assert.equal(leased, connection); await assertOwned();
      if (scenario === 'callback-fails') throw new Error('callback failed');
      return 42;
    });
    if (['callback-fails', 'owner-lost', 'acquire-fails'].includes(scenario)) await assert.rejects(promise);
    else { const value = await promise; assert.equal(value.acquired, scenario !== 'busy'); }
    assert.equal(callbackCalled, !['busy', 'owner-lost', 'acquire-fails'].includes(scenario));
    assert.equal(events.filter(event => event === 'release' || event === 'destroy').length, 1);
    assert.equal(events.at(-1), ['owner-lost', 'release-fails', 'acquire-fails'].includes(scenario) ? 'destroy' : 'release');
    if (!['busy', 'acquire-fails'].includes(scenario)) assert.ok(events.some(event => event.includes('RELEASE_LOCK')));
  }
});

test('store formats DATE columns in SQL and preserves JSON generatedAt precision', async () => {
  const queries = [];
  const row = { id: 's1', period_start: '2026-10-12', period_end: '2026-10-19', generated_at: '2026-10-19T01:00:00Z', mode: 'rules', payload: { generatedAt: '2026-10-19T01:00:00.123Z' }, payload_generated_at: '2026-10-19T01:00:00.123Z', status: 'success', run_id: 'r1' };
  const store = createStore({ query: async sql => { queries.push(sql); return sql.trim().startsWith('SELECT') ? [[row], {}] : [[], {}]; } });
  assert.equal((await store.latestSnapshot()).generatedAt, row.payload.generatedAt);
  assert.equal((await store.getSnapshot('s1')).periodStart, '2026-10-12');
  assert.equal((await store.history())[0].generatedAt, row.payload.generatedAt);
  assert.equal((await store.getJob()).periodStart, '2026-10-12');
  assert.equal((await store.jobHistory())[0].periodStart, '2026-10-12');
  for (const sql of queries.filter(query => query.trim().startsWith('SELECT'))) assert.match(sql, /DATE_FORMAT\(period_start/);
});

test('duplicate snapshot insert creates a new immutable id without overwriting the old row', async () => {
  const old = newSnapshot('same');
  const rows = new Map([[old.id, { id: old.id, payload: old }]]);
  const queries = [];
  const store = createStore({ query: async (sql, args = []) => {
    queries.push(sql);
    if (sql.trim().startsWith('INSERT INTO intelligence_snapshots')) {
      if (rows.has(args[0])) { const error = new Error('duplicate'); error.code = 'ER_DUP_ENTRY'; throw error; }
      rows.set(args[0], { id: args[0], payload: JSON.parse(args[5]) });
    }
    if (sql.includes('FROM intelligence_snapshots WHERE')) return [[rows.get(args[0])]];
    return [[], {}];
  } });
  const saved = await store.saveSnapshot({ ...old, mode: 'ai' });
  assert.notEqual(saved.id, old.id);
  assert.equal(rows.get('same').payload, old);
  assert.equal(rows.size, 2);
  assert.ok(queries.filter(sql => sql.includes('INSERT INTO intelligence_snapshots')).every(sql => !sql.includes('ON DUPLICATE')));
});

test('terminal job update is guarded by matching run id even when another job has finished', async () => {
  let update;
  const store = createStore({ query: async (sql, args) => {
    if (sql.trim().startsWith('UPDATE intelligence_jobs')) { update = { sql, args }; return [{ affectedRows: 0 }]; }
    if (sql.includes('FROM intelligence_jobs WHERE')) return [[{ status: 'success', run_id: 'newer' }]];
    return [[], {}];
  } });
  const result = await store.setJob({ status: 'failed', runId: 'stale' });
  assert.equal(result.changed, false);
  assert.equal(result.runId, 'newer');
  assert.match(update.sql, /WHERE singleton=1 AND run_id <=> \?/);
  assert.equal(update.args.at(-1), 'stale');
});

async function withServer(router, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api/intelligence', router);
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    return await callback(server.address().port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(port, method, path, token, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    }}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString()); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

test('intelligence routes enforce auth/admin and review the requested snapshot', async () => {
  const snapshot = { id: 'snap-old', companies: [{ id: 'co-1', name: '候选企业' }] };
  const store = {
    latestSnapshot: async () => snapshot,
    getSnapshot: async id => id === snapshot.id ? snapshot : null,
    history: async () => [],
    getJob: async () => ({ status: 'idle' }),
    reviews: async () => ({}),
    saveReview: async value => ({ ...value, reviewerName: value.reviewerName })
  };
  let beginCalls = 0;
  const service = {
    scheduleInfo: () => ({ schedule: 'test' }),
    beginRefresh: async () => { beginCalls += 1; return { acquired: true, job: { status: 'running' }, promise: Promise.resolve() }; }
  };
  const { router } = createIntelligenceRouter({ store, service });
  const userToken = sign({ uid: 2, username: 'user', role: 'user', displayName: '普通用户' });
  const adminToken = sign({ uid: 1, username: 'admin', role: 'admin', displayName: '管理员' });
  await withServer(router, async port => {
    for (const [method, path] of [['GET', '/dashboard'], ['GET', '/settings'], ['PUT', '/settings'], ['GET', '/history'], ['GET', '/history/snap-old'], ['POST', '/refresh'], ['PUT', '/reviews/co-1']]) {
      assert.equal((await request(port, method, '/api/intelligence' + path)).status, 401);
    }
    assert.equal((await request(port, 'POST', '/api/intelligence/refresh', userToken)).status, 403);
    assert.equal((await request(port, 'POST', '/api/intelligence/refresh', adminToken)).status, 202);
    assert.equal(beginCalls, 1);
    const missingId = await request(port, 'PUT', '/api/intelligence/reviews/co-1', userToken, { status: '继续研究' });
    assert.equal(missingId.status, 400);
    const wrongSnapshot = await request(port, 'PUT', '/api/intelligence/reviews/co-1', userToken, { snapshotId: 'snap-new', status: '继续研究' });
    assert.equal(wrongSnapshot.status, 404);
    const wrongCompany = await request(port, 'PUT', '/api/intelligence/reviews/missing', userToken, { snapshotId: 'snap-old', status: '继续研究' });
    assert.equal(wrongCompany.status, 404);
    const reviewed = await request(port, 'PUT', '/api/intelligence/reviews/co-1', userToken, { snapshotId: 'snap-old', status: '继续研究', note: '保留来源核验' });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.review.reviewerName, '普通用户');
  });
});

test('direction focus and notes are authenticated, snapshot-bound, and isolated per user', async () => {
  const snapshot = { id: 'snap-1', directions: [{ id: 'dir-ai', name: 'AI 与企业自动化' }] };
  const rows = new Map();
  const store = {
    getSnapshot: async id => id === snapshot.id ? snapshot : null,
    directionActions: async userId => Object.fromEntries([...rows].filter(([key]) => key.startsWith(String(userId) + '/')).map(([key, value]) => [key.slice(String(userId).length + 1), value])),
    saveDirectionAction: async value => {
      const action = { directionId: value.directionId, directionName: value.directionName, focused: value.focused, note: value.note, updatedAt: '2026-10-22T00:00:00Z' };
      rows.set(value.userId + '/' + value.directionId, action);
      return action;
    }
  };
  const tokenA = sign({ uid: 2, username: 'a', role: 'user' });
  const tokenB = sign({ uid: 3, username: 'b', role: 'user' });
  await withServer(createIntelligenceRouter({ store, service: {} }).router, async port => {
    const path = '/api/intelligence/direction-actions/dir-ai';
    assert.equal((await request(port, 'PUT', path, null, { snapshotId: snapshot.id, focused: true })).status, 401);
    assert.equal((await request(port, 'PUT', path, tokenA, { snapshotId: snapshot.id, focused: 1 })).status, 400);
    assert.equal((await request(port, 'PUT', path, tokenA, { snapshotId: 'missing', focused: true })).status, 404);
    assert.equal((await request(port, 'PUT', '/api/intelligence/direction-actions/nope', tokenA, { snapshotId: snapshot.id, focused: true })).status, 404);
    const saved = await request(port, 'PUT', path, tokenA, { snapshotId: snapshot.id, focused: true, note: '负责人安排访谈' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.action.focused, true);
    assert.equal(saved.body.action.note, '负责人安排访谈');
    assert.equal(rows.has('2/dir-ai'), true);
    assert.equal(rows.has('3/dir-ai'), false);
    const cleared = await request(port, 'PUT', path, tokenA, { snapshotId: snapshot.id, focused: false, note: '负责人安排访谈' });
    assert.equal(cleared.body.action.focused, false);
    assert.equal(cleared.body.action.note, '负责人安排访谈');
  });
});

test('settings API allows authenticated reads and admin-only validated saves without collection', async () => {
  const store = settingsStore();
  store.history = async () => [];
  let calls = 0;
  const service = createSchedulerService({ store, clock: () => new Date('2026-10-21T01:30:00Z'), pipeline: { collectAndBuild: async () => { calls += 1; return newSnapshot(); } } });
  const { router } = createIntelligenceRouter({ store, service });
  const admin = sign({ uid: 1, role: 'admin' });
  const user = sign({ uid: 2, role: 'user' });
  await withServer(router, async port => {
    const before = await request(port, 'GET', '/api/intelligence/settings', user);
    assert.equal(before.status, 200);
    assert.equal(before.body.settings.frequency, 'weekly');
    assert.equal(before.body.settings.weekday, 1);
    assert.equal((await request(port, 'PUT', '/api/intelligence/settings', user, { enabled: false })).status, 403);
    for (const body of [{ frequency: 'hourly' }, { weekday: 0 }, { time: '25:00' }, { lookbackDays: 91 }, { timezone: 'UTC' }, { aiConfigured: true }]) {
      assert.equal((await request(port, 'PUT', '/api/intelligence/settings', admin, body)).status, 400);
    }
    const saved = await request(port, 'PUT', '/api/intelligence/settings', admin, { enabled: true, frequency: 'daily', weekday: 7, time: '10:00', lookbackDays: 14, timezone: 'Asia/Shanghai' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.settings.frequency, 'daily');
    assert.equal(saved.body.settings.lookbackDays, 14);
    assert.equal(saved.body.settings.nextRunAt, '2026-10-21T02:00:00.000Z');
    assert.equal('scheduleAfter' in saved.body.settings, false);
    const dashboard = await request(port, 'GET', '/api/intelligence/dashboard', user);
    assert.deepEqual(dashboard.body.settings, saved.body.settings);
    assert.equal(calls, 0);
  });
});

test('API returns persisted running state, conflict, and retry cooldown status', async () => {
  const store = fakeStore({ transactional: true });
  store.history = async () => [];
  let finish;
  const pipeline = { collectAndBuild: async () => new Promise(resolve => { finish = resolve; }) };
  const service = createSchedulerService({ store, pipeline });
  const { router } = createIntelligenceRouter({ store, service });
  const token = sign({ uid: 1, username: 'admin', role: 'admin' });
  await withServer(router, async port => {
    const accepted = await request(port, 'POST', '/api/intelligence/refresh', token);
    assert.equal(accepted.status, 202);
    assert.equal(accepted.body.job.status, 'running');
    assert.equal(accepted.body.job.runId, store.read().current.runId);
    assert.ok(store.read().events.includes('commit'));
    assert.equal((await request(port, 'POST', '/api/intelligence/refresh', token)).status, 409);
    finish(newSnapshot());
    await new Promise(resolve => setImmediate(resolve));
  });
  await service.stopScheduler();
  const failedStore = fakeStore({ job: { status: 'failed', runId: 'failed', periodStart: '2026-10-19', retryAfter: '2026-10-19T03:00:00Z' } });
  const failedService = createSchedulerService({ store: failedStore, clock: () => new Date('2026-10-19T02:00:00Z'), pipeline: { collectAndBuild: async () => assert.fail('must not run') } });
  await withServer(createIntelligenceRouter({ store: failedStore, service: failedService }).router, async port => {
    assert.equal((await request(port, 'POST', '/api/intelligence/refresh', token)).status, 429);
  });
});

test('API sanitizes database/provider failure messages', async () => {
  const secret = 'SECRET_SAMPLE_DO_NOT_EXPOSE';
  const store = { latestSnapshot: async () => { throw new Error('DB password=' + secret); } };
  const service = { scheduleInfo: () => ({}) };
  const token = sign({ uid: 1, role: 'admin' });
  await withServer(createIntelligenceRouter({ store, service }).router, async port => {
    const failed = await request(port, 'GET', '/api/intelligence/dashboard', token);
    assert.equal(failed.status, 500);
    assert.equal(JSON.stringify(failed.body).includes(secret), false);
  });
  const failedStore = { latestSnapshot: async () => null, history: async () => [], getJob: async () => ({ status: 'failed', error: 'AI_KEY=' + secret }) };
  await withServer(createIntelligenceRouter({ store: failedStore, service }).router, async port => {
    const result = await request(port, 'GET', '/api/intelligence/dashboard', token);
    assert.equal(result.status, 200);
    assert.equal(JSON.stringify(result.body).includes(secret), false);
  });
});

test('history review stays on requested snapshot and records displayed reviewer name', async () => {
  const snapshots = { old: { id: 'old', companies: [{ id: 'co1' }] }, latest: { id: 'latest', companies: [{ id: 'co1' }] } };
  const reviews = { old: {}, latest: {} };
  const store = {
    getSnapshot: async id => snapshots[id],
    latestSnapshot: async () => snapshots.latest,
    saveReview: async value => { reviews[value.snapshotId][value.companyId] = value; return value; }
  };
  const token = sign({ uid: 2, username: 'reviewer', displayName: '业务复核人', role: 'user' });
  const { router } = createIntelligenceRouter({ store, service: {} });
  await withServer(router, async port => {
    const result = await request(port, 'PUT', '/api/intelligence/reviews/co1', token, { snapshotId: 'old', status: '暂缓', synergyLevel: '高', note: '历史复核' });
    assert.equal(result.status, 200);
    assert.equal(result.body.review.synergyLevel, '高');
    assert.equal(reviews.old.co1.synergyLevel, '高');
    assert.equal(reviews.old.co1.reviewerName, '业务复核人');
    assert.deepEqual(reviews.latest, {});
    assert.deepEqual(snapshots.latest, { id: 'latest', companies: [{ id: 'co1' }] });
  });
});

test('review API rejects invalid synergy levels without changing reviews', async () => {
  let saves = 0;
  const store = {
    getSnapshot: async () => ({ id: 'snap', companies: [{ id: 'co1' }] }),
    saveReview: async value => { saves += 1; return value; }
  };
  const token = sign({ uid: 2, username: 'reviewer', role: 'user' });
  await withServer(createIntelligenceRouter({ store, service: {} }).router, async port => {
    for (const synergyLevel of ['低', '', null, 1, true, ['高']]) {
      const result = await request(port, 'PUT', '/api/intelligence/reviews/co1', token, { snapshotId: 'snap', status: '未复核', synergyLevel });
      assert.equal(result.status, 400);
    }
    assert.equal(saves, 0);
    const omitted = await request(port, 'PUT', '/api/intelligence/reviews/co1', token, { snapshotId: 'snap', status: '继续研究' });
    assert.equal(omitted.status, 200);
    assert.equal(saves, 1);
  });
});

test('review synergy migration defaults historical records and optional updates preserve existing level', async () => {
  const rows = new Map([['old/co1', { snapshot_id: 'old', company_id: 'co1', status: '暂缓', note: '旧复核' }]]);
  let migrationCount = 0;
  const pool = { query: async (sql, params = []) => {
    if (sql.startsWith('ALTER TABLE intelligence_reviews ADD COLUMN synergy_level')) {
      migrationCount += 1;
      assert.ok(sql.includes("ENUM('高','中','待核实') NOT NULL DEFAULT '待核实'"));
      for (const row of rows.values()) row.synergy_level = row.synergy_level || '待核实';
    }
    if (sql.startsWith('INSERT INTO intelligence_reviews')) {
      assert.ok(sql.includes('synergy_level=IF(?, VALUES(synergy_level), synergy_level)'));
      const [snapshotId, companyId, status, note, userId, reviewerName, synergyLevel, updateSynergy] = params;
      const key = snapshotId + '/' + companyId;
      const previous = rows.get(key);
      rows.set(key, { snapshot_id: snapshotId, company_id: companyId, status, note, user_id: userId, reviewer_name: reviewerName,
        synergy_level: !previous || updateSynergy ? synergyLevel : previous.synergy_level, updated_at: '2026-10-20T10:00:00Z' });
    }
    if (sql.startsWith('SELECT company_id')) return [[...rows.values()].filter(row => row.snapshot_id === params[0])];
    return [[]];
  } };
  const store = createStore(pool);
  assert.equal((await store.reviews('old')).co1.synergyLevel, '待核实');
  assert.equal(migrationCount, 1);
  const base = { snapshotId: 'new', companyId: 'co1', status: '未复核', userId: 2 };
  assert.equal((await store.saveReview(base)).synergyLevel, '待核实');
  assert.equal((await store.saveReview({ ...base, synergyLevel: '高' })).synergyLevel, '高');
  assert.equal((await store.saveReview({ ...base, status: '继续研究' })).synergyLevel, '高');
  assert.equal((await store.saveReview({ ...base, synergyLevel: '中' })).synergyLevel, '中');
  assert.equal((await store.saveReview({ ...base, synergyLevel: '待核实' })).synergyLevel, '待核实');
  assert.equal((await store.reviews('old')).co1.status, '暂缓');
  assert.equal((await store.reviews('old')).co1.note, '旧复核');
  assert.equal((await store.reviews('old')).co1.synergyLevel, '待核实');
});
