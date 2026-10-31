const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'radar_app',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'radar_hub',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

/* mysql2 将 DECIMAL/SUM/AVG 返回为字符串，统一转数字 */
function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}
function numRows(rows) {
  return rows.map(r => {
    const o = {};
    for (const k of Object.keys(r)) o[k] = typeof r[k] === 'string' && /^-?\d+(\.\d+)?$/.test(r[k]) && !/^(id|phone|year|round|occurred|created|updated|published|period|week|source|url|name|title|content|sub|desc|status|type|category|segment|level|action|note|reason|period_start|period_end|label|owner|full_name|track|region|website|why_now|why_sector|why_company|why_dlg|password|salt|display|username|role|tags|risks|signals|sources|strength|weight|heat|confidence|total)/i.test(k) === false ? num(r[k]) : (['heat', 'strength', 'confidence', 'weight', 'total', 'score', 'founded_year', 'severity', 'sort', 'progress'].includes(k) ? num(r[k]) : r[k]);
    return o;
  });
}

/* mysql2 对 JSON 列可能直接返回数组/对象，统一防御式取数组 */
function jarr(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}

module.exports = { pool, num, numRows, jarr };
