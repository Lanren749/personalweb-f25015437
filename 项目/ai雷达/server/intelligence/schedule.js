'use strict';

const defaultStore = require('./store');
const defaultPipeline = { collectAndBuild: options => require('./pipeline').collectAndBuild(options) };
const { randomUUID } = require('node:crypto');
const { DEFAULT_SETTINGS, TIMEZONE, validateSettings, normalizeSettings } = require('./settings');

const DEFAULT_TIMEZONE = TIMEZONE;
const DEFAULT_INTERVAL = 60 * 1000;
const DEFAULT_TIMEOUT = 12 * 60 * 1000;
const DEFAULT_RETRY_BASE = 5 * 60 * 1000;
const DEFAULT_RETRY_MAX = 6 * 60 * 60 * 1000;

function localParts(date, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  const out = {};
  for (const part of parts) if (part.type !== 'literal') out[part.type] = Number(part.value);
  // Some ICU versions render midnight as 24:xx. Normalise it for Date.UTC.
  if (out.hour === 24) out.hour = 0;
  return out;
}

function dateKeyFromParts(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function localDateAt(parts, timeZone = DEFAULT_TIMEZONE) {
  // Find the UTC instant whose displayed wall clock equals the requested
  // local time. Asia/Shanghai has a fixed UTC+08 offset, but calculating the
  // offset through Intl keeps this helper valid if the timezone is changed.
  const guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0));
  const shown = localParts(guess, timeZone);
  const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
  const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  return new Date(guess.getTime() + (targetAsUtc - shownAsUtc));
}

function mondayDateKey(now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const p = localParts(now, timeZone);
  const localMidnight = localDateAt({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() || 7;
  localMidnight.setUTCDate(localMidnight.getUTCDate() - weekday + 1);
  return dateKeyFromParts(localParts(localMidnight, timeZone));
}

function scheduledAt(periodStart, timeZone = DEFAULT_TIMEZONE, time = DEFAULT_SETTINGS.time) {
  const [year, month, day] = String(periodStart).split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return localDateAt({ year, month, day, hour, minute, second: 0 }, timeZone);
}

function scheduleWindow(now, settings = DEFAULT_SETTINGS, timeZone = DEFAULT_TIMEZONE) {
  const p = localParts(now, timeZone);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (settings.frequency === 'weekly') {
    const weekday = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() - ((weekday - settings.weekday + 7) % 7));
  }
  let dueAt = scheduledAt(day.toISOString().slice(0, 10), timeZone, settings.time);
  const days = settings.frequency === 'daily' ? 1 : 7;
  if (dueAt > now) dueAt = new Date(dueAt.getTime() - days * 86400000);
  const periodStart = dateKeyFromParts(localParts(dueAt, timeZone));
  return {
    dueAt, periodStart,
    nextAt: new Date(dueAt.getTime() + days * 86400000),
    scheduleKey: `${settings.frequency}:${settings.frequency === 'weekly' ? settings.weekday : '*'}:${settings.time}:${periodStart}`
  };
}

function nextScheduledAt(now = new Date(), timeZone = DEFAULT_TIMEZONE, settings = DEFAULT_SETTINGS) {
  return scheduleWindow(now, settings, timeZone).nextAt;
}

function sameScheduleSlot(job, window, settings) {
  if (job.scheduleKey) return job.scheduleKey === window.scheduleKey;
  // Rows saved before schedule settings existed used Monday's date alone.
  return job.periodStart === window.periodStart && settings.frequency === 'weekly'
    && settings.weekday === 1 && settings.time === '09:00';
}

function slotAllowed(window, settings) {
  return !settings.scheduleAfter || window.dueAt > new Date(settings.scheduleAfter);
}

function errorText(error) {
  if (error && error.code === 'INTELLIGENCE_TIMEOUT') return '采集任务超时，旧快照已保留，请稍后重试';
  if (error && error.code === 'INTELLIGENCE_STOPPED') return '服务关闭，更新任务已取消，旧快照已保留';
  if (error && error.code === 'ALL_SOURCES_FAILED') return '全部公开信息源采集失败，旧快照已保留';
  return '情报更新失败，旧快照已保留，请检查服务运行状态后重试';
}

function createSchedulerService(options = {}) {
  const store = options.store || defaultStore;
  const pipeline = options.pipeline || defaultPipeline;
  const clock = options.clock || (() => new Date());
  const timezone = DEFAULT_TIMEZONE;
  const intervalMs = Number(options.intervalMs || DEFAULT_INTERVAL);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT);
  const retryBaseMs = Number(options.retryBaseMs || DEFAULT_RETRY_BASE);
  const retryMaxMs = Number(options.retryMaxMs || DEFAULT_RETRY_MAX);
  let timer = null;
  let interval = null;
  let stopped = false;
  let active = null;
  let activeController = null;
  let infrastructureRetryAt = 0;

  async function readSettings(connection) {
    return normalizeSettings(typeof store.getSettings === 'function' ? await store.getSettings(connection) : DEFAULT_SETTINGS);
  }

  function publicSettings(settings, now) {
    const enabled = settings.enabled && process.env.INTELLIGENCE_SCHEDULE_ENABLED !== '0';
    const weekday = ['一', '二', '三', '四', '五', '六', '日'][settings.weekday - 1];
    return {
      ...validateSettings({ enabled: settings.enabled, frequency: settings.frequency, weekday: settings.weekday,
        time: settings.time, lookbackDays: settings.lookbackDays, timezone }),
      enabled,
      schedule: `${settings.frequency === 'daily' ? '每天' : `每周${weekday}`} ${settings.time}（北京时间）`,
      timezone,
      nextRunAt: enabled ? nextScheduledAt(new Date(Math.max(now.getTime(), settings.scheduleAfter ? new Date(settings.scheduleAfter).getTime() : 0)), timezone, settings).toISOString() : null,
      aiConfigured: Boolean(process.env.AI_KEY && (process.env.AI_URL || process.env.AI_BASE))
    };
  }

  async function scheduleInfo(now = clock()) {
    return publicSettings(await readSettings(), now);
  }

  async function updateSettings(input, now = clock()) {
    const previous = await readSettings();
    const validated = validateSettings(input, previous);
    if (typeof store.saveSettings !== 'function') throw new Error('当前存储不支持保存更新设置');
    const saved = normalizeSettings(await store.saveSettings({ ...validated, scheduleAfter: new Date(now).toISOString() }));
    // The existing interval will read the persisted value at its next tick.
    // Saving never starts a collection, even when a previous slot was missed.
    infrastructureRetryAt = 0;
    return publicSettings(saved, now);
  }

  async function executeRefresh({ reason = 'manual', now = clock(), onStarted } = {}) {
    const started = new Date(now);
    if (Number.isNaN(started.getTime())) throw new Error('now 不是有效日期');
    const runId = `intel_${randomUUID()}`;
    let startedSignalled = false;
    const signalStarted = value => {
      if (startedSignalled) return;
      startedSignalled = true;
      if (typeof onStarted === 'function') onStarted(value);
    };

    const outcome = await store.withAdvisoryLock(async (connection, assertOwned = async () => {}) => {
      const settings = await readSettings(connection);
      const window = scheduleWindow(started, settings, timezone);
      const { periodStart, scheduleKey } = window;
      const scheduled = reason === 'weekly-schedule' || reason === 'daily-schedule';
      if (scheduled && (!settings.enabled || process.env.INTELLIGENCE_SCHEDULE_ENABLED === '0' || !slotAllowed(window, settings))) {
        const result = { acquired: false, skipped: true, job: await store.getJob(connection) };
        signalStarted(result);
        return result.job;
      }
      const transaction = async (fn, signal) => {
        if (signal && signal.aborted) throw signal.reason;
        if (!connection || typeof connection.beginTransaction !== 'function') return fn();
        await connection.beginTransaction();
        try {
          const value = await fn();
          await assertOwned();
          if (signal && signal.aborted) throw signal.reason;
          await connection.commit();
          return value;
        } catch (error) {
          try { await connection.rollback(); } catch (_) {}
          throw error;
        }
      };
      const current = await store.getJob(connection);
      const sameSlot = sameScheduleSlot(current, window, settings);
      if (sameSlot && current.retryAfter && new Date(current.retryAfter) > started) {
        signalStarted({ acquired: false, rateLimited: true, job: current });
        return current;
      }
      if (scheduled && current.status === 'success' && sameSlot) {
        signalStarted({ acquired: false, skipped: true, job: current });
        return current;
      }
      if (current.status === 'running') {
        // Holding GET_LOCK proves no other worker owns this task. A leftover
        // running row can therefore be recovered immediately after a restart.
        const abandoned = { ...current, status: 'failed', finishedAt: started,
          error: '上次任务因服务中断未完成，正在恢复', retryAfter: null };
        await transaction(async () => {
          await store.setJob(abandoned, connection);
          await store.appendJobHistory(abandoned, connection);
        });
      }
      const attempts = Number(sameSlot ? current.attempts : 0) + 1;
      const runningData = {
        status: 'running', periodStart, scheduleKey, runId, reason,
        startedAt: started, finishedAt: null, retryAfter: null, attempts, error: null
      };

      const controller = new AbortController();
      activeController = controller;
      let timeoutReject;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutReject = reject;
      });
      timeoutPromise.catch(() => {});
      const deadline = setTimeout(() => {
        const timeoutError = new Error('采集任务超时');
        timeoutError.code = 'INTELLIGENCE_TIMEOUT';
        controller.abort(timeoutError);
      }, timeoutMs);
      const onAbort = () => timeoutReject(controller.signal.reason || new Error('任务已取消'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (stopped) {
        const error = new Error('服务关闭');
        error.code = 'INTELLIGENCE_STOPPED';
        controller.abort(error);
      }
      let runningWritten = false;
      try {
        if (controller.signal.aborted) throw controller.signal.reason;
        const running = await transaction(async () => {
          const persisted = await store.setJob(runningData, connection);
          if (persisted.status !== 'running' || persisted.runId !== runId || persisted.changed === false) throw new Error('任务状态未写入');
          await store.appendJobHistory(runningData, connection);
          return persisted;
        }, controller.signal);
        runningWritten = true;
        signalStarted({ acquired: true, job: running });
        const output = await Promise.race([
          (async () => {
            const previousSnapshot = await store.latestSnapshot(connection);
            if (controller.signal.aborted) throw controller.signal.reason;
            return pipeline.collectAndBuild({
              now: started,
              lookbackDays: settings.lookbackDays,
              previousSnapshot,
              onProgress: options.onProgress || (() => {}),
              signal: controller.signal
            });
          })(),
          timeoutPromise
        ]);
        if (controller.signal.aborted) throw controller.signal.reason;
        if (!output || !output.id) throw new Error('采集模块未返回有效快照');
        const finished = new Date(clock());
        const successData = {
          status: 'success', periodStart, scheduleKey, runId, reason,
          startedAt: started, finishedAt: finished, retryAfter: null, attempts: 0, error: null
        };
        await assertOwned();
        const success = await transaction(async () => {
          await store.saveSnapshot(output, connection);
          const persisted = await store.setJob(successData, connection);
          if (persisted.runId !== runId || persisted.status !== 'success' || persisted.changed === false) throw new Error('任务归属已变化');
          await store.appendJobHistory(successData, connection);
          if (controller.signal.aborted) throw controller.signal.reason;
          return persisted;
        }, controller.signal);
        console.log('[intelligence] snapshot saved', output.id, reason);
        return success;
      } catch (error) {
        const finished = new Date(clock());
        const delay = Math.min(retryMaxMs, retryBaseMs * Math.pow(2, Math.max(0, attempts - 1)));
        const failedData = {
          status: 'failed', periodStart, scheduleKey, runId, reason,
          startedAt: started, finishedAt: finished,
          retryAfter: new Date(finished.getTime() + delay), attempts,
          error: errorText(error)
        };
        if (runningWritten) {
          await assertOwned();
          await transaction(async () => {
            const persisted = await store.setJob(failedData, connection);
            if (persisted.runId !== runId || persisted.status !== 'failed' || persisted.changed === false) throw new Error('任务归属已变化');
            await store.appendJobHistory(failedData, connection);
          });
        }
        console.error('[intelligence] refresh failed:', errorText(error));
        throw error;
      } finally {
        clearTimeout(deadline);
        controller.signal.removeEventListener('abort', onAbort);
        activeController = null;
      }
    });
    signalStarted({ acquired: Boolean(outcome && outcome.acquired), job: outcome && outcome.value ? outcome.value : outcome });
    return outcome && outcome.acquired ? outcome.value : outcome;
  }

  function runRefresh(options = {}) {
    if (active) {
      const result = { acquired: false, job: { status: 'running' } };
      if (options.onStarted) options.onStarted(result);
      return Promise.resolve(result);
    }
    active = executeRefresh(options).finally(() => { active = null; });
    return active;
  }

  async function beginRefresh(options = {}) {
    let resolveStarted;
    let rejectStarted;
    const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
    let startedSignalled = false;
    const promise = runRefresh({ ...options, onStarted: info => { startedSignalled = true; resolveStarted(info); } });
    promise.catch(error => { if (!startedSignalled) rejectStarted(error); });
    const info = await started;
    return { ...info, promise };
  }

  async function tick(now = clock()) {
    if (stopped || active || now.getTime() < infrastructureRetryAt) return null;
    try {
      const settings = await readSettings();
      if (!settings.enabled || process.env.INTELLIGENCE_SCHEDULE_ENABLED === '0') return null;
      const window = scheduleWindow(now, settings, timezone);
      if (!slotAllowed(window, settings)) return null;
      const current = await store.getJob();
      const sameSlot = sameScheduleSlot(current, window, settings);
      if (sameSlot && current.retryAfter) {
        const retry = new Date(current.retryAfter);
        if (!Number.isNaN(retry.getTime()) && retry.getTime() > now.getTime()) return null;
      }
      // Default installations keep restart catch-up. An explicit save adds
      // a persistent lower bound, so only future configured slots may run.
      if (current.status === 'success' && sameSlot) return null;
      return await runRefresh({ reason: settings.frequency === 'daily' ? 'daily-schedule' : 'weekly-schedule', now });
    } catch (_) {
      infrastructureRetryAt = new Date(clock()).getTime() + retryBaseMs;
      return null;
    }
  }

  function startScheduler() {
    if (stopped) stopped = false;
    if (timer || interval || process.env.INTELLIGENCE_SCHEDULE_ENABLED === '0') return;
    timer = setTimeout(() => { timer = null; tick().catch(error => console.error('[intelligence] scheduler:', errorText(error))); }, 0);
    interval = setInterval(() => tick().catch(error => console.error('[intelligence] scheduler:', errorText(error))), intervalMs);
    if (typeof interval.unref === 'function') interval.unref();
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stopScheduler() {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (interval) clearInterval(interval);
    timer = null;
    interval = null;
    if (activeController) {
      const error = new Error('服务关闭');
      error.code = 'INTELLIGENCE_STOPPED';
      activeController.abort(error);
    }
    return active ? active.catch(() => null) : Promise.resolve();
  }

  return { runRefresh, beginRefresh, tick, startScheduler, stopScheduler, scheduleInfo, updateSettings, mondayDateKey, nextScheduledAt };
}

const defaultService = createSchedulerService();
module.exports = {
  createSchedulerService,
  runRefresh: defaultService.runRefresh,
  beginRefresh: defaultService.beginRefresh,
  tick: defaultService.tick,
  startScheduler: defaultService.startScheduler,
  stopScheduler: defaultService.stopScheduler,
  scheduleInfo: defaultService.scheduleInfo,
  updateSettings: defaultService.updateSettings,
  mondayDateKey,
  nextScheduledAt
};
