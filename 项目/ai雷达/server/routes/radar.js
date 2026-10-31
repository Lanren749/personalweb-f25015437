const express = require('express');
const { pool, jarr } = require('../db');
const { requireAuth } = require('../auth');
const ai = require('../ai');
const AI_MODEL_TAG = ai.AI_MODEL;

const r = express.Router();
r.use(requireAuth);

async function logAct(userId, module, action, detail) {
  await pool.query('INSERT INTO activity_logs (user_id, module, action, detail) VALUES (?,?,?,?)', [userId, module, action, detail]);
}

/* ---------- 产业方向 ---------- */
r.get('/directions', async (req, res) => {
  const [dirs] = await pool.query('SELECT * FROM directions ORDER BY heat DESC');
  const [cnt] = await pool.query("SELECT direction_id, COUNT(*) c FROM signals WHERE status='正常' GROUP BY direction_id");
  const map = Object.fromEntries(cnt.map(x => [x.direction_id, x.c]));
  res.json(dirs.map(d => ({ ...d, risks: jarr(d.risks), tags: jarr(d.tags), signal_count: map[d.id] || 0 })));
});
r.post('/directions', async (req, res) => {
  const { name, sub, category, status, heat, why_now, relation, risks, tags } = req.body || {};
  if (!name) return res.status(400).json({ error: '请填写方向名称' });
  const [ret] = await pool.query('INSERT INTO directions (name, sub, category, status, heat, why_now, relation, risks, tags) VALUES (?,?,?,?,?,?,?,?,?)',
    [name, sub || '', category || '', status || '跟踪中', +heat || 50, why_now || '', relation || '', JSON.stringify(risks || []), JSON.stringify(tags || [])]);
  await logAct(req.user.id, '产业雷达', '新增方向', `新增产业方向「${name}」`);
  res.json({ id: ret.insertId });
});
r.put('/directions/:id', async (req, res) => {
  const b = req.body || {};
  const sets = [], vals = [];
  for (const k of ['name', 'sub', 'category', 'status', 'why_now', 'relation']) {
    if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k]); }
  }
  if (b.heat !== undefined) { sets.push('heat=?'); vals.push(+b.heat); }
  if (b.risks !== undefined) { sets.push('risks=?'); vals.push(JSON.stringify(b.risks)); }
  if (b.tags !== undefined) { sets.push('tags=?'); vals.push(JSON.stringify(b.tags)); }
  if (!sets.length) return res.json({ ok: true });
  vals.push(+req.params.id);
  await pool.query(`UPDATE directions SET ${sets.join(',')} WHERE id=?`, vals);
  res.json({ ok: true });
});
r.delete('/directions/:id', async (req, res) => {
  await pool.query('DELETE FROM directions WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});

/* ---------- 产业方向看板（每次自动采集后由 AI 整理汇总） ---------- */
r.get('/digest/board', async (req, res) => {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const [dirs] = await pool.query(
    "SELECT * FROM directions ORDER BY FIELD(status,'跟踪中','观察','暂停'), heat DESC");
  const [sigs] = await pool.query(
    `SELECT id, direction_id, type, title, strength, confidence, occurred_at, status, source_name, source_url
     FROM signals WHERE direction_id IS NOT NULL AND occurred_at >= ? AND status IN ('正常','待核实')
     ORDER BY strength DESC`, [since]);
  const byDir = {};
  for (const s of sigs) (byDir[s.direction_id] = byDir[s.direction_id] || []).push(s);
  const [lg] = await pool.query(
    "SELECT created_at, detail FROM activity_logs WHERE module='方向整理' ORDER BY id DESC LIMIT 1");
  res.json({
    last_digest_at: lg.length ? lg[0].created_at : null,
    last_digest_detail: lg.length ? lg[0].detail : '',
    directions: dirs.map(d => ({
      ...d, risks: jarr(d.risks), tags: jarr(d.tags),
      recent: (byDir[d.id] || []).slice(0, 8),
      recent_count: (byDir[d.id] || []).length
    }))
  });
});

/* ---------- 弱信号 ---------- */
r.get('/signals', async (req, res) => {
  const { direction_id, type, status, start, end, kw } = req.query;
  const where = [], vals = [];
  if (direction_id) { where.push('direction_id=?'); vals.push(+direction_id); }
  if (type) { where.push('type=?'); vals.push(type); }
  if (status) { where.push('status=?'); vals.push(status); }
  if (start) { where.push('occurred_at>=?'); vals.push(start); }
  if (end) { where.push('occurred_at<=?'); vals.push(end); }
  if (kw) { where.push('(title LIKE ? OR content LIKE ?)'); vals.push(`%${kw}%`, `%${kw}%`); }
  const [rows] = await pool.query(
    `SELECT s.*, d.name AS direction_name FROM signals s LEFT JOIN directions d ON d.id=s.direction_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.occurred_at DESC, s.id DESC LIMIT 500`, vals);
  res.json(rows);
});
r.post('/signals', async (req, res) => {
  const { direction_id, type, title, content, source_name, source_url, confidence, strength, occurred_at } = req.body || {};
  if (!type || !title || !occurred_at) return res.status(400).json({ error: '类型、标题与日期为必填' });
  const conf = +confidence || 0;
  let st = '正常';
  if (conf <= 40) st = '转参考';
  const [ret] = await pool.query(
    'INSERT INTO signals (direction_id, type, title, content, source_name, source_url, confidence, strength, occurred_at, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [direction_id || null, type, title, content || '', source_name || '', source_url || '', conf, +strength || 50, occurred_at, st]);
  await logAct(req.user.id, '产业雷达', '录入信号', `录入${type}信号「${title}」`);
  res.json({ id: ret.insertId, status: st });
});
r.put('/signals/:id', async (req, res) => {
  const b = req.body || {};
  if (b.status !== undefined || b.verify_note !== undefined) {
    await pool.query('UPDATE signals SET status=COALESCE(?,status), verify_note=COALESCE(?,verify_note) WHERE id=?',
      [b.status || null, b.verify_note || null, +req.params.id]);
    await logAct(req.user.id, '产业雷达', '信号处置', `将信号 #${req.params.id} 处置为「${b.status || '更新备注'}」`);
  }
  const sets = [], vals = [];
  for (const k of ['title', 'content', 'source_name', 'source_url', 'type']) {
    if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k]); }
  }
  for (const k of ['direction_id', 'confidence', 'strength']) {
    if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k] === null ? null : +b[k]); }
  }
  if (b.occurred_at) { sets.push('occurred_at=?'); vals.push(b.occurred_at); }
  if (sets.length) {
    vals.push(+req.params.id);
    await pool.query(`UPDATE signals SET ${sets.join(',')} WHERE id=?`, vals);
  }
  res.json({ ok: true });
});

/* ---------- 情报周报 ---------- */
r.get('/reports', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM reports ORDER BY period_start DESC');
  res.json(rows);
});
r.get('/reports/:id/detail', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM reports WHERE id=?', [+req.params.id]);
  if (!rows.length) return res.status(404).json({ error: '周报不存在' });
  const rep = rows[0];
  const [sigs] = await pool.query(
    `SELECT s.*, d.name AS direction_name FROM signals s LEFT JOIN directions d ON d.id=s.direction_id
     WHERE s.occurred_at BETWEEN ? AND ? ORDER BY s.strength DESC`, [rep.period_start, rep.period_end]);
  const [dirs] = await pool.query("SELECT * FROM directions WHERE status='跟踪中' ORDER BY heat DESC");
  const [coms] = await pool.query('SELECT * FROM companies WHERE week_label=?', [rep.week_label]);
  res.json({
    report: rep,
    signals: sigs.map(s => ({ ...s, verify_note: s.verify_note })),
    directions: dirs.map(d => ({ ...d, risks: jarr(d.risks), tags: jarr(d.tags) })),
    companies: coms
  });
});
r.post('/reports', async (req, res) => {
  const { week_label, period_start, period_end, summary, note } = req.body || {};
  if (!week_label || !period_start || !period_end) return res.status(400).json({ error: '周次与起止日期为必填' });
  const [cnt] = await pool.query('SELECT COUNT(*) c FROM signals WHERE occurred_at BETWEEN ? AND ?', [period_start, period_end]);
  const [ret] = await pool.query(
    'INSERT INTO reports (week_label, period_start, period_end, status, summary, note, scanned, created_by, published_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [week_label, period_start, period_end, '草稿', summary || '', note || '', cnt[0].c, req.user.username, new Date()]);
  await logAct(req.user.id, '产业雷达', '创建周报', `创建${week_label}周报（${period_start} ~ ${period_end}），汇总信号 ${cnt[0].c} 条`);
  res.json({ id: ret.insertId });
});
r.put('/reports/:id', async (req, res) => {
  const { summary, note, status } = req.body || {};
  await pool.query('UPDATE reports SET summary=COALESCE(?,summary), note=COALESCE(?,note), status=COALESCE(?,status), published_at=IF(?="已生成" OR ?="已复核", NOW(), published_at) WHERE id=?',
    [summary || null, note || null, status || null, status || '', status || '', +req.params.id]);
  await logAct(req.user.id, '产业雷达', '更新周报', `更新周报 #${req.params.id}（状态：${status || '内容'}）`);
  res.json({ ok: true });
});
r.delete('/reports/:id', async (req, res) => {
  await pool.query('DELETE FROM reports WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});

/* AI 解读弱信号（方向归属建议 / 置信度参考 / 协同分析 / 处置建议），结果存 ai_note */
r.post('/signals/:id/interpret', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.*, d.name AS direction_name, d.why_now AS direction_why_now FROM signals s LEFT JOIN directions d ON d.id=s.direction_id WHERE s.id=?`, [+req.params.id]);
  if (!rows.length) return res.status(404).json({ error: '信号不存在' });
  const s = rows[0];
  let note;
  try {
    const out = await ai.chatJSON(
      '你是东浩兰生的 AI 战略投资雷达智能体，负责弱信号研判。基于给定信号与现有产业方向清单，输出四项研判。要求：审慎、不编造事实、每项一句话、中文。',
      JSON.stringify({
        信号: { 类型: s.type, 标题: s.title, 内容: s.content, 来源: s.source_name, 强度: s.strength, 置信度: s.confidence, 当前归属方向: s.direction_name || '未关联' },
        现有方向清单: (await pool.query('SELECT name, sub, why_now FROM directions ORDER BY heat DESC LIMIT 10'))[0].map(d => d.name + '（' + d.sub + '）'),
        输出格式: { direction: '方向归属建议（从清单中选择或建议新方向，一句话）', confidence: '置信度参考（结合来源可信度给 0-100 的建议值及理由）', synergy: '与东浩兰生主业的协同分析（一句话）', action: '处置建议（正常跟踪/待核实/降级/转参考，一句话）' }
      }),
      { temperature: 0.4 });
    note = `【AI 解读 · ${AI_MODEL_TAG}】\n方向归属：${out.direction || '—'}\n置信度参考：${out.confidence || '—'}\n协同分析：${out.synergy || '—'}\n处置建议：${out.action || '—'}`;
  } catch (e) {
    console.error('[AI 信号解读失败]', e.message);
    return res.status(502).json({ error: 'AI 解读失败：' + e.message });
  }
  await pool.query('UPDATE signals SET ai_note=? WHERE id=?', [note, s.id]);
  await logAct(req.user.id, '产业雷达', 'AI 信号解读', `AI 解读信号「${s.title}」`);
  res.json({ ai_note: note });
});

/* 周报 AI 综述（生成当期摘要写入 summary 字段） */
r.post('/reports/:id/ai-summary', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM reports WHERE id=?', [+req.params.id]);
  if (!rows.length) return res.status(404).json({ error: '周报不存在' });
  const rep = rows[0];
  const [sigs] = await pool.query(
    `SELECT s.title, s.type, s.strength, s.status, d.name AS direction_name FROM signals s LEFT JOIN directions d ON d.id=s.direction_id WHERE s.occurred_at BETWEEN ? AND ? ORDER BY s.strength DESC LIMIT 15`, [rep.period_start, rep.period_end]);
  const [dirs] = await pool.query("SELECT name, sub, heat, why_now FROM directions WHERE status='跟踪中' ORDER BY heat DESC LIMIT 8");
  const [coms] = await pool.query('SELECT name, track, round, synergy_level FROM companies WHERE week_label=?', [rep.week_label]);
  let summary;
  try {
    summary = await ai.chat(
      [{ role: 'system', content: '你是东浩兰生的 AI 战略投资雷达智能体。基于给定的周报数据写一段「本期摘要」，供投资负责人快速掌握本期要点。要求：120-200 字、2-4 句、先总后分、点出最值得关注的 1-2 个方向与关键信号、提到候选企业情况、末尾提示信息需人工核实。只输出摘要正文，不要标题和多余格式。' },
       { role: 'user', content: JSON.stringify({ 周次: rep.week_label, 周期: rep.period_start + ' ~ ' + rep.period_end, 扫描信息数: rep.scanned, 当期方向: dirs, 当期信号: sigs, 本期候选企业: coms }) }],
      { temperature: 0.5, maxTokens: 8000 });
  } catch (e) {
    console.error('[AI 周报综述失败]', e.message);
    return res.status(502).json({ error: 'AI 综述生成失败：' + e.message });
  }
  await pool.query('UPDATE reports SET summary=? WHERE id=?', [summary, rep.id]);
  await logAct(req.user.id, '产业雷达', 'AI 周报综述', `AI 为${rep.week_label}生成当期摘要`);
  res.json({ summary });
});

/* ---------- Watchlist ---------- */
r.get('/watchlist', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT w.*, d.name AS direction_name FROM watchlist w LEFT JOIN directions d ON d.id=w.direction_id ORDER BY w.created_at DESC`);
  res.json(rows);
});
r.post('/watchlist', async (req, res) => {
  const { target_type, name, direction_id, note } = req.body || {};
  if (!name) return res.status(400).json({ error: '请填写监测对象' });
  const [ret] = await pool.query('INSERT INTO watchlist (target_type, name, direction_id, note) VALUES (?,?,?,?)',
    [target_type || '企业', name, direction_id || null, note || '']);
  res.json({ id: ret.insertId });
});
r.put('/watchlist/:id', async (req, res) => {
  const { status, note } = req.body || {};
  await pool.query('UPDATE watchlist SET status=COALESCE(?,status), note=COALESCE(?,note) WHERE id=?', [status || null, note || null, +req.params.id]);
  res.json({ ok: true });
});
r.delete('/watchlist/:id', async (req, res) => {
  await pool.query('DELETE FROM watchlist WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});

module.exports = r;
