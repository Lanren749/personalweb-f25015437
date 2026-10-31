const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { pool, num, jarr } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const ai = require('../ai');

const r = express.Router();
r.use(requireAuth);

async function logAct(userId, module, action, detail) {
  await pool.query('INSERT INTO activity_logs (user_id, module, action, detail) VALUES (?,?,?,?)', [userId, module, action, detail]);
}

/* 加权总分 */
async function attachScores(rows) {
  if (!rows.length) return rows;
  const [dims] = await pool.query('SELECT * FROM score_dimensions WHERE enabled=1 ORDER BY sort');
  const [sc] = await pool.query('SELECT * FROM company_scores');
  const dimW = new Map(dims.map(d => [d.id, num(d.weight)]));
  const totalW = dims.reduce((s, d) => s + (num(d.weight) || 0), 0);
  const byCom = {};
  for (const s of sc) { (byCom[s.company_id] = byCom[s.company_id] || []).push(s); }
  for (const c of rows) {
    const mine = byCom[c.id] || [];
    let weighted = 0;
    const detail = {};
    for (const s of mine) {
      const w = dimW.get(s.dimension_id);
      if (w) weighted += num(s.score) * w;
      detail[s.dimension_id] = { score: num(s.score), rationale: s.rationale };
    }
    c.total_score = totalW ? Math.round(weighted / totalW * 10) / 10 : null;
    c.score_detail = detail;
  }
  return rows;
}

/* ---------- 产业链缺口 ---------- */
r.get('/gaps', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT g.*, d.name AS direction_name,
      (SELECT COUNT(*) FROM companies c WHERE c.gap_id=g.id AND c.status<>'排除') AS company_count
     FROM chain_gaps g LEFT JOIN directions d ON d.id=g.direction_id ORDER BY FIELD(g.severity,'高','中','低'), g.id`);
  res.json(rows);
});
r.post('/gaps', async (req, res) => {
  const { direction_id, segment, description, severity } = req.body || {};
  if (!direction_id || !segment) return res.status(400).json({ error: '方向与环节为必填' });
  const [ret] = await pool.query('INSERT INTO chain_gaps (direction_id, segment, description, severity) VALUES (?,?,?,?)',
    [direction_id, segment, description || '', severity || '中']);
  await logAct(req.user.id, '寻源与决策', '登记缺口', `登记产业链缺口「${segment}」`);
  res.json({ id: ret.insertId });
});
r.put('/gaps/:id', async (req, res) => {
  const { segment, description, severity, status } = req.body || {};
  await pool.query('UPDATE chain_gaps SET segment=COALESCE(?,segment), description=COALESCE(?,description), severity=COALESCE(?,severity), status=COALESCE(?,status) WHERE id=?',
    [segment || null, description || null, severity || null, status || null, +req.params.id]);
  res.json({ ok: true });
});
r.delete('/gaps/:id', async (req, res) => {
  await pool.query('DELETE FROM chain_gaps WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});

/* ---------- 候选企业 ---------- */
r.get('/companies', async (req, res) => {
  const { status, synergy, kw, gap_id, direction_id, week, found_by } = req.query;
  const where = [], vals = [];
  if (status) { where.push('c.status=?'); vals.push(status); }
  if (synergy) { where.push('c.synergy_level=?'); vals.push(synergy); }
  if (gap_id) { where.push('c.gap_id=?'); vals.push(+gap_id); }
  if (direction_id) { where.push('c.direction_id=?'); vals.push(+direction_id); }
  if (found_by) { where.push('c.found_by=?'); vals.push(found_by); }
  if (week) { where.push('c.week_label=?'); vals.push(week); }
  if (kw) { where.push('(c.name LIKE ? OR c.track LIKE ? OR c.region LIKE ? OR c.full_name LIKE ?)'); vals.push(`%${kw}%`, `%${kw}%`, `%${kw}%`, `%${kw}%`); }
  const [rows] = await pool.query(
    `SELECT c.*, g.segment AS gap_segment, d.name AS direction_name
     FROM companies c
     LEFT JOIN chain_gaps g ON g.id=c.gap_id
     LEFT JOIN directions d ON d.id=c.direction_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY c.id DESC LIMIT 300`, vals);
  for (const row of rows) row.evidence = jarr(row.evidence);
  await attachScores(rows);
  res.json(rows);
});

r.get('/companies/:id', async (req, res) => {
  const id = +req.params.id;
  const [rows] = await pool.query(
    `SELECT c.*, g.segment AS gap_segment, g.description AS gap_desc, d.name AS direction_name
     FROM companies c LEFT JOIN chain_gaps g ON g.id=c.gap_id LEFT JOIN directions d ON d.id=c.direction_id WHERE c.id=?`, [id]);
  if (!rows.length) return res.status(404).json({ error: '企业不存在' });
  rows[0].evidence = jarr(rows[0].evidence);
  await attachScores(rows);
  const [logs] = await pool.query(
    `SELECT l.*, u.display_name FROM review_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.company_id=? ORDER BY l.created_at DESC`, [id]);
  const [fq] = await pool.query('SELECT * FROM four_questions WHERE company_id=?', [id]);
  const [dim] = await pool.query('SELECT * FROM score_dimensions WHERE enabled=1 ORDER BY sort');
  res.json({
    company: rows[0],
    logs,
    four_questions: fq[0] ? { ...fq[0], sources: jarr(fq[0].sources) } : null,
    dimensions: dim.map(d => ({ ...d, weight: num(d.weight) }))
  });
});

r.post('/companies', async (req, res) => {
  const { name, full_name, track, region, round, founded_year, description, website, source, gap_id, direction_id, synergy_level, week_label } = req.body || {};
  if (!name) return res.status(400).json({ error: '请填写企业名称' });
  const [ret] = await pool.query(
    'INSERT INTO companies (name, full_name, track, region, round, founded_year, description, website, source, gap_id, direction_id, synergy_level, week_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [name, full_name || '', track || '', region || '', round || 'A轮', founded_year || null, description || '', website || '', source || '人工录入', gap_id || null, direction_id || null, synergy_level || '弱/待验证', week_label || '']);
  await logAct(req.user.id, '寻源与决策', '新增候选', `新增候选企业「${name}」`);
  res.json({ id: ret.insertId });
});

r.put('/companies/:id', async (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [];
  for (const k of ['name', 'full_name', 'track', 'region', 'round', 'description', 'website', 'source', 'synergy_level', 'week_label', 'status']) {
    if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k]); }
  }
  for (const k of ['founded_year', 'gap_id', 'direction_id']) {
    if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k] || null); }
  }
  if (!sets.length) return res.json({ ok: true });
  vals.push(+req.params.id);
  await pool.query(`UPDATE companies SET ${sets.join(',')} WHERE id=?`, vals);
  res.json({ ok: true });
});

r.delete('/companies/:id', async (req, res) => {
  const id = +req.params.id;
  await pool.query('DELETE FROM review_logs WHERE company_id=?', [id]);
  await pool.query('DELETE FROM company_scores WHERE company_id=?', [id]);
  await pool.query('DELETE FROM four_questions WHERE company_id=?', [id]);
  await pool.query('DELETE FROM companies WHERE id=?', [id]);
  res.json({ ok: true });
});

/* 人工复核：标记 + 留痕 */
r.post('/companies/:id/review', async (req, res) => {
  const id = +req.params.id;
  const { action, note } = req.body || {};
  const allow = { '继续研究': 1, '暂缓': 1, '排除': 1, '重置为候选': 1, '备注': 1 };
  if (!allow[action]) return res.status(400).json({ error: '无效的复核动作' });
  if (action !== '备注') {
    await pool.query('UPDATE companies SET status=? WHERE id=?', [action === '重置为候选' ? '候选' : action, id]);
  }
  await pool.query('INSERT INTO review_logs (company_id, user_id, action, note) VALUES (?,?,?,?)',
    [id, req.user.id, action === '备注' ? '复核备注' : `标记：${action}`, note || '']);
  await logAct(req.user.id, '寻源与决策', '企业复核', `企业 #${id} ${action}${note ? '：' + note : ''}`);
  res.json({ ok: true });
});

/* 评分更新（批量 upsert） */
r.put('/companies/:id/scores', async (req, res) => {
  const id = +req.params.id;
  const { scores } = req.body || {};
  if (!Array.isArray(scores)) return res.status(400).json({ error: '参数错误' });
  for (const s of scores) {
    if (!s.dimension_id) continue;
    await pool.query(
      `INSERT INTO company_scores (company_id, dimension_id, score, rationale) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE score=VALUES(score), rationale=VALUES(rationale)`,
      [id, s.dimension_id, Math.min(100, Math.max(0, +s.score || 0)), s.rationale || '']);
  }
  await logAct(req.user.id, '寻源与决策', '更新评分', `更新企业 #${id} 的 ${scores.length} 项维度评分`);
  res.json({ ok: true });
});

/* ---------- AI 寻源 Agent ---------- */
/* 手动触发一轮寻源（后台异步跑 node server/ingest.js --source，日志落 logs/sourcing.log） */
r.post('/agent/run', requireAdmin, async (req, res) => {
  const [recent] = await pool.query(
    "SELECT created_at FROM activity_logs WHERE module='AI 寻源' AND action='手动触发寻源' AND created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)");
  if (recent.length) return res.status(429).json({ error: '10 分钟内已触发过寻源，请稍后再试' });
  const child = spawn('node', [path.join(__dirname, '..', 'ingest.js'), '--source'], {
    cwd: path.join(__dirname, '..'),
    detached: true,
    stdio: ['ignore', require('fs').openSync(path.join(__dirname, '..', 'logs', 'sourcing.log'), 'a'), require('fs').openSync(path.join(__dirname, '..', 'logs', 'sourcing.log'), 'a')]
  });
  child.unref();
  await logAct(req.user.id, 'AI 寻源', '手动触发寻源', `管理员 ${req.user.displayName || req.user.username} 手动触发 AI 寻源 Agent（PID ${child.pid}）`);
  res.json({ ok: true, pid: child.pid });
});

/* 最近寻源记录（供前端展示 Agent 动态） */
r.get('/agent/last', async (req, res) => {
  const [rows] = await pool.query(
    "SELECT action, detail, created_at FROM activity_logs WHERE module='AI 寻源' ORDER BY id DESC LIMIT 10");
  const [cnt] = await pool.query("SELECT COUNT(*) c FROM companies WHERE found_by='AI' AND status<>'排除'");
  res.json({ logs: rows, ai_companies: cnt[0].c });
});

/* ---------- 四问投资逻辑 ---------- */
r.get('/four-questions/:companyId', async (req, res) => {
  const [fq] = await pool.query('SELECT * FROM four_questions WHERE company_id=?', [+req.params.companyId]);
  res.json(fq[0] || null);
});

r.put('/four-questions/:companyId', async (req, res) => {
  const cid = +req.params.companyId;
  const { why_now, why_sector, why_company, why_dlg, sources } = req.body || {};
  await pool.query(
    `INSERT INTO four_questions (company_id, why_now, why_sector, why_company, why_dlg, sources, status, updated_by) VALUES (?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE why_now=VALUES(why_now), why_sector=VALUES(why_sector), why_company=VALUES(why_company), why_dlg=VALUES(why_dlg), sources=VALUES(sources), status='AI生成+人工确认', updated_by=VALUES(updated_by)`,
    [cid, why_now || '', why_sector || '', why_company || '', why_dlg || '', JSON.stringify(sources || []), 'AI生成+人工确认', req.user.username]);
  await logAct(req.user.id, '寻源与决策', '四问确认', `人工确认企业 #${cid} 的四问投资逻辑`);
  res.json({ ok: true });
});

/* 规则化模板合成（LLM 失败时的兜底） */
function ruleFQ(c, sigs, top) {
  const sigLine = sigs.length
    ? `近 30 天该方向强信号：${sigs.map(s => `「${s.title}」(${s.source_name || '公开来源'})`).join('；')}。`
    : '近 30 天该方向暂无高置信信号，建议先补充信号采集。';
  const why_now = `${sigLine}结合方向判断：${c.why_now || '该方向处于技术成熟与需求放量的交汇期，当前为布局窗口。'}`;
  const why_sector = `${c.direction_name || '相关'}赛道的结构性机会：${c.why_now || ''} ${c.relation ? '与集团业务的结合点：' + c.relation : ''}`;
  const why_company = `${c.description || ''} ${c.gap_segment ? `该企业对应产业链缺口「${c.gap_segment}」：${c.gap_desc || ''}` : ''} ${top.length ? '评分要点：' + top.map(s => `${s.dim_name} ${s.score} 分（${s.rationale}）`).join('；') : ''}`;
  const why_dlg = c.relation
    ? `集团赋能路径：${c.relation} 反向补强：${c.gap_desc || '该企业补齐集团在' + (c.gap_segment || '相关环节') + '的能力缺口'}。企业当前战略协同评级：${c.synergy_level}。`
    : `该企业当前与集团主业协同评级为「${c.synergy_level}」，建议先验证渠道与场景价值，再评估是否推进。`;
  const sources = [...new Set(sigs.map(s => s.source_name).filter(Boolean))];
  if (c.source) sources.push(c.source);
  return { why_now, why_sector, why_company, why_dlg, sources };
}

/* AI 生成四问（LLM 合成，失败自动降级规则模板） */
r.post('/four-questions/:companyId/generate', async (req, res) => {
  const cid = +req.params.companyId;
  const [rows] = await pool.query(
    `SELECT c.*, g.segment AS gap_segment, g.description AS gap_desc, d.name AS direction_name, d.why_now, d.relation
     FROM companies c LEFT JOIN chain_gaps g ON g.id=c.gap_id LEFT JOIN directions d ON d.id=g.direction_id WHERE c.id=?`, [cid]);
  if (!rows.length) return res.status(404).json({ error: '企业不存在' });
  const c = rows[0];
  const [sigs] = await pool.query(
    `SELECT title, source_name, strength FROM signals WHERE direction_id=? AND status='正常' AND occurred_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) ORDER BY strength DESC LIMIT 3`, [c.gap_id ? (await pool.query('SELECT direction_id FROM chain_gaps WHERE id=?', [c.gap_id]))[0][0].direction_id : 0]);
  const [sc] = await pool.query(
    `SELECT s.score, s.rationale, dim.name AS dim_name FROM company_scores s JOIN score_dimensions dim ON dim.id=s.dimension_id WHERE s.company_id=? ORDER BY s.score DESC`, [cid]);
  const top = sc.filter(s => s.rationale).slice(0, 2);

  let fqData, aiOk = true;
  try {
    fqData = await ai.chatJSON(
      '你是东浩兰生投资管理有限公司的 AI 战略投资雷达智能体。基于给定的企业档案、产业链缺口、近期信号与六维评分，撰写「四问投资逻辑」初稿。要求：每问 2-3 句、具体可核查、不编造给定材料之外的事实、不自动估值、中文书面语、符合国资投资机构审慎口径。',
      `输入材料：\n${JSON.stringify({
        企业: { 名称: c.name, 全称: c.full_name, 赛道: c.track, 地区: c.region, 轮次: c.round, 简介: c.description, 协同评级: c.synergy_level, 来源: c.source },
        所属方向: { 名称: c.direction_name, WhyNow: c.why_now, 与集团关联: c.relation },
        产业链缺口: c.gap_segment ? { 环节: c.gap_segment, 描述: c.gap_desc } : null,
        近30天方向强信号: sigs.map(s => ({ 标题: s.title, 来源: s.source_name, 强度: s.strength })),
        六维评分要点: sc.map(s => ({ 维度: s.dim_name, 得分: s.score, 依据: s.rationale }))
      }, null, 1)}\n\n输出 JSON 的键固定为：why_now（为什么是现在）、why_sector（为什么是这个赛道）、why_company（为什么是这家公司）、why_dlg（为什么是东浩兰生来投）、sources（字符串数组，材料中出现的信息来源名称）。`,
      { temperature: 0.5 });
    for (const k of ['why_now', 'why_sector', 'why_company', 'why_dlg']) {
      if (typeof fqData[k] !== 'string' || !fqData[k].trim()) throw new Error('AI 返回缺少 ' + k);
    }
    if (!Array.isArray(fqData.sources)) fqData.sources = [];
  } catch (e) {
    console.error('[AI 四问生成失败，降级规则模板]', e.message);
    aiOk = false;
    fqData = ruleFQ(c, sigs, top);
  }

  try {
    await pool.query(
      `INSERT INTO four_questions (company_id, why_now, why_sector, why_company, why_dlg, sources, status, updated_by) VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE why_now=VALUES(why_now), why_sector=VALUES(why_sector), why_company=VALUES(why_company), why_dlg=VALUES(why_dlg), sources=VALUES(sources), status=VALUES(status), updated_by=VALUES(updated_by)`,
      [cid, fqData.why_now, fqData.why_sector, fqData.why_company, fqData.why_dlg, JSON.stringify(fqData.sources || []), 'AI生成', req.user.username]);
  } catch (e) {
    console.error('[四问写库失败]', e.message);
    return res.status(500).json({ error: '四问结果写库失败：' + e.message });
  }
  await logAct(req.user.id, '寻源与决策', 'AI 生成四问', `${aiOk ? 'LLM' : '规则兜底'}为「${c.name}」生成四问投资逻辑初稿`);
  const [fq] = await pool.query('SELECT * FROM four_questions WHERE company_id=?', [cid]);
  res.json(fq[0] ? { ...fq[0], sources: jarr(fq[0].sources) } : null);
});

module.exports = r;
