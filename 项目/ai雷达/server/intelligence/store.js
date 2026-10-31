'use strict';

const { pool: defaultPool } = require('../db');
const { randomUUID } = require('node:crypto');
const { DEFAULT_SETTINGS, normalizeSettings } = require('./settings');

/*
 * The intelligence tables are deliberately independent from the original
 * radar tables.  Keep each DDL statement separate: mysql2 does not enable
 * multi-statements by default and a failed schema creation must be retryable.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS intelligence_settings (
    singleton TINYINT PRIMARY KEY,
    payload JSON NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS intelligence_snapshots (
    id VARCHAR(100) PRIMARY KEY,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    generated_at DATETIME NOT NULL,
    mode VARCHAR(20) NOT NULL DEFAULT 'rules',
    payload JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_intel_period (period_start),
    INDEX idx_intel_generated (generated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS intelligence_jobs (
    singleton TINYINT PRIMARY KEY,
    status ENUM('idle','running','success','failed') NOT NULL DEFAULT 'idle',
    period_start DATE NULL,
    run_id VARCHAR(100) NULL,
    reason VARCHAR(50) NULL,
    schedule_key VARCHAR(100) NULL,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    retry_after DATETIME NULL,
    attempts INT NOT NULL DEFAULT 0,
    error TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS intelligence_job_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    run_id VARCHAR(100) NOT NULL,
    period_start DATE NULL,
    reason VARCHAR(50) NULL,
    schedule_key VARCHAR(100) NULL,
    status ENUM('running','success','failed') NOT NULL,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_intel_job_run (run_id),
    INDEX idx_intel_job_period (period_start),
    INDEX idx_intel_job_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS intelligence_reviews (
    snapshot_id VARCHAR(100) NOT NULL,
    company_id VARCHAR(120) NOT NULL,
    status ENUM('继续研究','暂缓','排除','未复核') NOT NULL DEFAULT '未复核',
    synergy_level ENUM('高','中','待核实') NOT NULL DEFAULT '待核实',
    note VARCHAR(1000) NOT NULL DEFAULT '',
    user_id INT NULL,
    reviewer_name VARCHAR(160) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (snapshot_id, company_id),
    INDEX idx_intel_reviews_snapshot (snapshot_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS intelligence_direction_actions (
    user_id INT NOT NULL,
    direction_id VARCHAR(120) NOT NULL,
    direction_name VARCHAR(200) NOT NULL,
    focused TINYINT(1) NOT NULL DEFAULT 0,
    note VARCHAR(500) NOT NULL DEFAULT '',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, direction_id),
    INDEX idx_intel_direction_focus (user_id, focused)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

// These ALTERs are safe migrations for installations created by the first
// version of the feature. Duplicate-column errors are intentionally ignored.
const MIGRATIONS = [
  `ALTER TABLE intelligence_jobs ADD COLUMN run_id VARCHAR(100) NULL`,
  `ALTER TABLE intelligence_jobs ADD COLUMN reason VARCHAR(50) NULL`,
  `ALTER TABLE intelligence_jobs ADD COLUMN schedule_key VARCHAR(100) NULL`,
  `ALTER TABLE intelligence_jobs ADD COLUMN retry_after DATETIME NULL`,
  `ALTER TABLE intelligence_jobs ADD COLUMN attempts INT NOT NULL DEFAULT 0`,
  `ALTER TABLE intelligence_job_history ADD COLUMN reason VARCHAR(50) NULL`,
  `ALTER TABLE intelligence_job_history ADD COLUMN schedule_key VARCHAR(100) NULL`,
  `ALTER TABLE intelligence_reviews ADD COLUMN reviewer_name VARCHAR(160) NULL`,
  `ALTER TABLE intelligence_reviews ADD COLUMN synergy_level ENUM('高','中','待核实') NOT NULL DEFAULT '待核实'`
];

function isDuplicateColumn(error) {
  return Boolean(error && (error.code === 'ER_DUP_FIELDNAME' || error.errno === 1060 || /duplicate column/i.test(error.message || '')));
}

function parsePayload(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  // Queries below format SQL DATE values as strings before mysql2 parses them.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function dateTime(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return /(?:Z|[+-]\d{2}:\d{2})$/.test(s) ? s : `${s}Z`;
    if (/^\d{4}-\d{2}-\d{2} /.test(s)) return `${s.replace(' ', 'T')}Z`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value);
}

function toMysqlDateTime(value) {
  const d = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(d.getTime())) throw new Error('无效日期');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeSnapshot(row) {
  const payload = parsePayload(row.payload) || {};
  return {
    ...payload,
    id: payload.id || row.id,
    periodStart: payload.periodStart || dateOnly(row.period_start),
    periodEnd: payload.periodEnd || dateOnly(row.period_end),
    // JSON is the canonical value. This avoids converting a DATETIME through
    // the host timezone when older rows do not contain generatedAt.
    generatedAt: payload.generatedAt || dateTime(row.generated_at),
    mode: payload.mode || row.mode
  };
}

function createStore(dbPool = defaultPool, options = {}) {
  const lockName = String(options.lockName || 'radar-x-intelligence-refresh');
  let schemaPromise = null;

  async function ensureSchema() {
    if (schemaPromise) return schemaPromise;
    const promise = (async () => {
      for (const ddl of SCHEMA) await dbPool.query(ddl);
      for (const ddl of MIGRATIONS) {
        try { await dbPool.query(ddl); } catch (error) {
          if (!isDuplicateColumn(error)) throw error;
        }
      }
      await dbPool.query(
        `INSERT INTO intelligence_jobs (singleton, status)
         VALUES (1, 'idle')
         ON DUPLICATE KEY UPDATE singleton=singleton`
      );
      await dbPool.query(
        `INSERT INTO intelligence_settings (singleton, payload) VALUES (1, ?)
         ON DUPLICATE KEY UPDATE singleton=singleton`,
        [JSON.stringify(DEFAULT_SETTINGS)]
      );
    })();
    // A transient connection/schema error must not poison all future calls.
    schemaPromise = promise.catch(error => {
      schemaPromise = null;
      throw error;
    });
    return schemaPromise;
  }

  async function latestSnapshot(executor = dbPool) {
    await ensureSchema();
    const [rows] = await executor.query(
      `SELECT id, DATE_FORMAT(period_start, '%Y-%m-%d') AS period_start,
              DATE_FORMAT(period_end, '%Y-%m-%d') AS period_end,
              DATE_FORMAT(generated_at, '%Y-%m-%dT%H:%i:%sZ') AS generated_at,
              mode, payload
         FROM intelligence_snapshots
        ORDER BY generated_at DESC, id DESC LIMIT 1`
    );
    return rows.length ? normalizeSnapshot(rows[0]) : null;
  }

  async function getSettings(executor = dbPool) {
    await ensureSchema();
    const [rows] = await executor.query('SELECT payload FROM intelligence_settings WHERE singleton=1');
    return normalizeSettings(rows.length ? parsePayload(rows[0].payload) : null);
  }

  async function saveSettings(settings, executor = dbPool) {
    await ensureSchema();
    const normalized = normalizeSettings(settings);
    await executor.query(
      `INSERT INTO intelligence_settings (singleton, payload) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE payload=VALUES(payload), updated_at=UTC_TIMESTAMP()`,
      [JSON.stringify(normalized)]
    );
    return normalized;
  }

  async function getSnapshot(id, executor = dbPool) {
    await ensureSchema();
    const [rows] = await executor.query(
      `SELECT id, DATE_FORMAT(period_start, '%Y-%m-%d') AS period_start,
              DATE_FORMAT(period_end, '%Y-%m-%d') AS period_end,
              DATE_FORMAT(generated_at, '%Y-%m-%dT%H:%i:%sZ') AS generated_at,
              mode, payload
         FROM intelligence_snapshots WHERE id=?`, [String(id)]
    );
    return rows.length ? normalizeSnapshot(rows[0]) : null;
  }

  async function history(limit = 12) {
    await ensureSchema();
    const n = Math.min(50, Math.max(1, Math.floor(Number(limit) || 12)));
    const [rows] = await dbPool.query(
      `SELECT id,
              DATE_FORMAT(period_start, '%Y-%m-%d') AS period_start,
              DATE_FORMAT(period_end, '%Y-%m-%d') AS period_end,
              DATE_FORMAT(generated_at, '%Y-%m-%dT%H:%i:%sZ') AS generated_at,
              mode, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.generatedAt')) AS payload_generated_at
         FROM intelligence_snapshots
        ORDER BY generated_at DESC, id DESC LIMIT ?`, [n]
    );
    return rows.map(row => ({
      id: row.id,
      periodStart: dateOnly(row.period_start),
      periodEnd: dateOnly(row.period_end),
      generatedAt: row.payload_generated_at && row.payload_generated_at !== 'null' ? row.payload_generated_at : dateTime(row.generated_at),
      mode: row.mode
    }));
  }

  async function saveSnapshot(snapshot, executor = dbPool) {
    await ensureSchema();
    if (!snapshot || !snapshot.id) throw new Error('快照缺少 id');
    const base = { ...snapshot };
    let id = String(base.id);
    if (id.length > 80) throw new Error('快照 id 过长');
    let payload = JSON.stringify({ ...base, id });
    const args = () => [
      id, base.periodStart, base.periodEnd, toMysqlDateTime(base.generatedAt),
      base.mode === 'ai' ? 'ai' : 'rules', payload
    ];
    try {
      await executor.query(
        `INSERT INTO intelligence_snapshots
          (id, period_start, period_end, generated_at, mode, payload)
         VALUES (?, ?, ?, ?, ?, ?)`, args()
      );
    } catch (error) {
      if (error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)) {
        // A retry at the same instant may produce the deterministic pipeline
        // id again. Preserve the original row and create a new history item.
        id = `${id.slice(0, 43)}_${randomUUID()}`;
        payload = JSON.stringify({ ...base, id });
        await executor.query(
          `INSERT INTO intelligence_snapshots
            (id, period_start, period_end, generated_at, mode, payload)
           VALUES (?, ?, ?, ?, ?, ?)`, args()
        );
      } else throw error;
    }
    return getSnapshot(id, executor);
  }

  async function getJob(executor = dbPool) {
    await ensureSchema();
    const [rows] = await executor.query(
      `SELECT status, DATE_FORMAT(period_start, '%Y-%m-%d') AS period_start, run_id, reason, schedule_key,
              DATE_FORMAT(started_at, '%Y-%m-%dT%H:%i:%sZ') AS started_at,
              DATE_FORMAT(finished_at, '%Y-%m-%dT%H:%i:%sZ') AS finished_at,
              DATE_FORMAT(retry_after, '%Y-%m-%dT%H:%i:%sZ') AS retry_after,
              attempts, error
         FROM intelligence_jobs WHERE singleton=1`
    );
    if (!rows.length) return { status: 'idle', periodStart: null, runId: null, reason: null, startedAt: null, finishedAt: null, retryAfter: null, attempts: 0, error: null };
    const row = rows[0];
    return {
      status: row.status,
      periodStart: dateOnly(row.period_start),
      runId: row.run_id || null,
      reason: row.reason || null,
      scheduleKey: row.schedule_key || null,
      startedAt: dateTime(row.started_at),
      finishedAt: dateTime(row.finished_at),
      retryAfter: dateTime(row.retry_after),
      attempts: Number(row.attempts || 0),
      error: row.error || null
    };
  }

  async function setJob(job, executor = dbPool) {
    await ensureSchema();
    const status = job.status || 'idle';
    const runId = job.runId == null ? null : String(job.runId);
    const where = status === 'running'
      ? `WHERE singleton=1 AND (run_id <=> ? OR status <> 'running')`
      : `WHERE singleton=1 AND run_id <=> ?`;
    const values = [
      status, job.periodStart || null, runId, job.reason || null, job.scheduleKey || null,
      job.startedAt ? toMysqlDateTime(job.startedAt) : null,
      job.finishedAt ? toMysqlDateTime(job.finishedAt) : null,
      job.retryAfter ? toMysqlDateTime(job.retryAfter) : null,
      Number.isFinite(Number(job.attempts)) ? Number(job.attempts) : 0,
      job.error || null
    ];
    const [result] = await executor.query(
      `UPDATE intelligence_jobs
          SET status=?, period_start=?, run_id=?, reason=?, schedule_key=?, started_at=?,
              finished_at=?, retry_after=?, attempts=?, error=?
        ${where}`,
      values.concat([runId])
    );
    // A stale process must not overwrite the active process's terminal state.
    return { ...(await getJob(executor)), changed: Boolean(result && result.affectedRows !== 0) };
  }

  async function appendJobHistory(job, executor = dbPool) {
    await ensureSchema();
    if (!job.runId) return;
    await executor.query(
      `INSERT INTO intelligence_job_history
        (run_id, period_start, reason, status, started_at, finished_at, error, schedule_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status=VALUES(status), finished_at=VALUES(finished_at), error=VALUES(error)`,
      [String(job.runId), job.periodStart || null, job.reason || null, job.status,
        job.startedAt ? toMysqlDateTime(job.startedAt) : null,
        job.finishedAt ? toMysqlDateTime(job.finishedAt) : null, job.error || null, job.scheduleKey || null]
    );
  }

  async function jobHistory(limit = 20) {
    await ensureSchema();
    const n = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
    const [rows] = await dbPool.query(
      `SELECT run_id, DATE_FORMAT(period_start, '%Y-%m-%d') AS period_start, reason, schedule_key, status,
              DATE_FORMAT(started_at, '%Y-%m-%dT%H:%i:%sZ') AS started_at,
              DATE_FORMAT(finished_at, '%Y-%m-%dT%H:%i:%sZ') AS finished_at,
              error
         FROM intelligence_job_history
        ORDER BY created_at DESC, id DESC LIMIT ?`, [n]
    );
    return rows.map(row => ({ runId: row.run_id, periodStart: dateOnly(row.period_start), reason: row.reason || null, scheduleKey: row.schedule_key || null, status: row.status, startedAt: dateTime(row.started_at), finishedAt: dateTime(row.finished_at), error: row.error || null }));
  }

  async function reviews(snapshotId) {
    await ensureSchema();
    const [rows] = await dbPool.query(
      `SELECT company_id, status, synergy_level, note, user_id, reviewer_name,
              DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at
         FROM intelligence_reviews WHERE snapshot_id=?`, [String(snapshotId)]
    );
    return Object.fromEntries(rows.map(row => [String(row.company_id), {
      status: row.status,
      synergyLevel: row.synergy_level || '待核实',
      note: row.note || '',
      by: row.user_id == null ? null : row.user_id,
      reviewerName: row.reviewer_name || null,
      updatedAt: dateTime(row.updated_at)
    }]));
  }

  async function saveReview({ snapshotId, companyId, status, synergyLevel, note, userId, reviewerName }) {
    await ensureSchema();
    await dbPool.query(
      `INSERT INTO intelligence_reviews
        (snapshot_id, company_id, status, note, user_id, reviewer_name, synergy_level, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE status=VALUES(status), note=VALUES(note),
         user_id=VALUES(user_id), reviewer_name=VALUES(reviewer_name),
         synergy_level=IF(?, VALUES(synergy_level), synergy_level),
         updated_at=UTC_TIMESTAMP()`,
      [String(snapshotId), String(companyId), status, note || '', userId || null, reviewerName || null,
        synergyLevel === undefined ? '待核实' : synergyLevel, synergyLevel !== undefined]
    );
    const map = await reviews(snapshotId);
    return map[String(companyId)];
  }

  async function directionActions(userId) {
    await ensureSchema();
    const [rows] = await dbPool.query(
      `SELECT direction_id, direction_name, focused, note,
              DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%sZ') AS updated_at
         FROM intelligence_direction_actions WHERE user_id=?`, [Number(userId)]
    );
    return Object.fromEntries(rows.map(row => [String(row.direction_id), {
      directionId: String(row.direction_id), directionName: row.direction_name,
      focused: Boolean(row.focused), note: row.note || '', updatedAt: dateTime(row.updated_at)
    }]));
  }

  async function saveDirectionAction({ userId, directionId, directionName, focused, note }) {
    await ensureSchema();
    await dbPool.query(
      `INSERT INTO intelligence_direction_actions
        (user_id, direction_id, direction_name, focused, note, updated_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE direction_name=VALUES(direction_name), focused=VALUES(focused),
         note=VALUES(note), updated_at=UTC_TIMESTAMP()`,
      [Number(userId), String(directionId), String(directionName).slice(0, 200), focused ? 1 : 0, String(note || '').slice(0, 500)]
    );
    const actions = await directionActions(userId);
    return actions[String(directionId)];
  }

  async function withAdvisoryLock(fn) {
    await ensureSchema();
    const connection = await dbPool.getConnection();
    let acquired = false;
    let healthy = true;
    try {
      const [rows] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
      acquired = Number(rows && rows[0] && rows[0].acquired) === 1;
      if (!acquired) return { acquired: false, value: null };
      const assertOwned = async () => {
        const [ownerRows] = await connection.query(
          'SELECT (IS_USED_LOCK(?) = CONNECTION_ID()) AS owned', [lockName]
        );
        if (Number(ownerRows && ownerRows[0] && ownerRows[0].owned) !== 1) {
          healthy = false;
          const error = new Error('任务锁已失效');
          error.code = 'INTELLIGENCE_LOCK_LOST';
          throw error;
        }
      };
      await assertOwned();
      const result = await fn(connection, assertOwned);
      return { acquired: true, value: result };
    } catch (error) {
      if (!acquired || error.fatal || error.code === 'PROTOCOL_CONNECTION_LOST') healthy = false;
      throw error;
    } finally {
      if (acquired) {
        try {
          const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
          if (Number(rows && rows[0] && rows[0].released) !== 1) healthy = false;
        }
        catch (_) { healthy = false; }
      }
      if (healthy && typeof connection.release === 'function') connection.release();
      else if (typeof connection.destroy === 'function') connection.destroy();
    }
  }

  return { ensureSchema, getSettings, saveSettings, latestSnapshot, getSnapshot, history, saveSnapshot, getJob, setJob, appendJobHistory, jobHistory, reviews, saveReview, directionActions, saveDirectionAction, withAdvisoryLock };
}

const defaultStore = createStore();
module.exports = { ...defaultStore, createStore, SCHEMA };
