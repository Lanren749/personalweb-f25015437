'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, normalizeSettings, validateSettings } = require('../server/intelligence/settings');
const { createStore } = require('../server/intelligence/store');

test('settings validate editable fields and reject unsafe or ambiguous values', () => {
  assert.deepEqual(validateSettings({}), DEFAULT_SETTINGS);
  for (const frequency of ['daily', 'weekly']) {
    for (const weekday of [1, 7]) {
      for (const lookbackDays of [1, 90]) {
        const result = validateSettings({ frequency, weekday, time: '23:59', lookbackDays, enabled: false });
        assert.equal(result.frequency, frequency);
        assert.equal(result.weekday, weekday);
        assert.equal(result.lookbackDays, lookbackDays);
      }
    }
  }
  for (const input of [null, [], 'weekly', { enabled: 1 }, { enabled: 'false' }, { frequency: 'hourly' },
    { weekday: 0 }, { weekday: 8 }, { weekday: '1' }, { weekday: 1.5 },
    { time: '9:00' }, { time: '24:00' }, { time: '12:60' }, { time: '09:00:00' },
    { lookbackDays: 0 }, { lookbackDays: 91 }, { lookbackDays: 7.5 }, { lookbackDays: '7' },
    { timezone: 'UTC' }, { scheduleAfter: '2000-01-01' }, { nextRunAt: null }, { unknown: true }]) {
    assert.throws(() => validateSettings(input), error => error.code === 'INVALID_INTELLIGENCE_SETTINGS');
  }
});

test('normalization keeps defaults and trusted schedule cutoff without leaking derived fields', () => {
  assert.deepEqual(normalizeSettings(null), { ...DEFAULT_SETTINGS, scheduleAfter: null });
  assert.deepEqual(normalizeSettings({ frequency: 'bad', time: '10:30' }), { ...DEFAULT_SETTINGS, scheduleAfter: null });
  const value = normalizeSettings({ frequency: 'daily', lookbackDays: 14, scheduleAfter: '2026-10-21T10:00:00+08:00', aiConfigured: 'not trusted' });
  assert.equal(value.frequency, 'daily');
  assert.equal(value.lookbackDays, 14);
  assert.equal(value.scheduleAfter, '2026-10-21T02:00:00.000Z');
  assert.equal('aiConfigured' in value, false);
});

test('settings live in an independent singleton JSON table and survive store recreation', async () => {
  let payload = null;
  const statements = [];
  const pool = { query: async (sql, params = []) => {
    statements.push(sql);
    if (sql.trim().startsWith('INSERT INTO intelligence_settings')) {
      if (!payload || sql.includes('payload=VALUES(payload)')) payload = params[0];
    }
    if (sql.startsWith('SELECT payload FROM intelligence_settings')) return [[{ payload }]];
    return [[], {}];
  } };
  const store = createStore(pool);
  assert.deepEqual(await store.getSettings(), { ...DEFAULT_SETTINGS, scheduleAfter: null });
  const configured = { ...DEFAULT_SETTINGS, enabled: false, frequency: 'daily', weekday: 7, time: '00:00', lookbackDays: 90, scheduleAfter: '2026-10-21T01:00:00.123Z' };
  assert.deepEqual(await store.saveSettings(configured), configured);
  assert.deepEqual(await createStore(pool).getSettings(), configured);
  assert.ok(statements.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS intelligence_settings')));
  assert.equal(statements.some(sql => /\bDROP\b|\bTRUNCATE\b/.test(sql)), false);
});
