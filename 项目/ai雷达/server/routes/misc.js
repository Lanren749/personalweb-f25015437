const express = require('express');
const { pool, num, jarr } = require('../db');
const { requireAuth } = require('../auth');

const r = express.Router();
r.use(requireAuth);

/* ---------- 总览看板 ---------- */
r.get('/dashboard', async (req, res) => {
  const [[dirT]] = await pool.query("SELECT COUNT(*) c FROM directions WHERE status='跟踪中'");
  const [[sigW]] = await pool.query("SELECT COUNT(*) c FROM signals WHERE status='正常' AND occurred_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)");
  const [[sigN]] = await pool.query("SELECT COUNT(*) c FROM signals WHERE status='正常'");
  const [[sigBad]] = await pool.query("SELECT COUNT(*) c FROM signals WHERE status IN ('降级','排除')");
  const [[comCand]] = await pool.query("SELECT COUNT(*) c FROM companies WHERE status='候选'");
  const [[comGo]] = await pool.query("SELECT COUNT(*) c FROM companies WHERE status='继续研究'");
  const [[comAll]] = await pool.query('SELECT COUNT(*) c FROM companies');
  const [[wl]] = await pool.query("SELECT COUNT(*) c FROM watchlist WHERE status='监测中'");
  const [[kn]] = await pool.query('SELECT COUNT(*) c FROM knowledge_entries');
  const [[fqOk]] = await pool.query("SELECT COUNT(*) c FROM four_questions WHERE status='AI生成+人工确认'");
  const [[fqAll]] = await pool.query('SELECT COUNT(*) c FROM four_questions');
  const [[gapOpen]] = await pool.query("SELECT COUNT(*) c FROM chain_gaps WHERE status='开放'");
  const [latestRep] = await pool.query('SELECT * FROM reports ORDER BY period_start DESC LIMIT 1');
  const [topDirs] = await pool.query("SELECT id, name, sub, heat, status FROM directions WHERE status='跟踪中' ORDER BY heat DESC LIMIT 5");
  const [highSyn] = await pool.query(
    `SELECT c.id, c.name, c.track, c.round FROM companies c WHERE c.synergy_level='高' AND c.status<>'排除' ORDER BY c.id DESC LIMIT 5`);
  const [acts] = await pool.query(
    `SELECT a.*, u.display_name FROM activity_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 8`);
  const [[repAll]] = await pool.query('SELECT COUNT(*) c, COALESCE(SUM(scanned),0) s FROM reports');
  const [[doneScore]] = await pool.query('SELECT COUNT(DISTINCT company_id) c FROM company_scores');

  res.json({
    kpi: {
      directions: dirT.c,
      signals_week: sigW.c,
      signals_total: sigN.c,
      snr: (sigN.c + sigBad.c) ? Math.round(sigN.c / (sigN.c + sigBad.c) * 100) : 100,
      companies_candidate: comCand.c,
      companies_continue: comGo.c,
      companies_total: comAll.c,
      watchlist: wl.c,
      knowledge: kn.c,
      fourq_confirmed: fqOk.c,
      fourq_total: fqAll.c,
      gaps_open: gapOpen.c,
      reports: repAll.c,
      scanned_total: num(repAll.s),
      scored_companies: doneScore.c
    },
    latest_report: latestRep[0] || null,
    top_directions: topDirs,
    high_synergy: highSyn,
    activities: acts
  });
});

/* ---------- 知识资产 ---------- */
r.get('/knowledge', async (req, res) => {
  const { type } = req.query;
  const [rows] = await pool.query(type ? 'SELECT * FROM knowledge_entries WHERE type=? ORDER BY created_at DESC' : 'SELECT * FROM knowledge_entries ORDER BY created_at DESC', type ? [type] : []);
  res.json(rows.map(k => ({ ...k, tags: jarr(k.tags) })));
});
r.post('/knowledge', async (req, res) => {
  const { type, title, content, tags } = req.body || {};
  if (!type || !title) return res.status(400).json({ error: '类型与标题为必填' });
  const [ret] = await pool.query('INSERT INTO knowledge_entries (type, title, content, tags, created_by) VALUES (?,?,?,?,?)',
    [type, title, content || '', JSON.stringify(tags || []), req.user.username]);
  res.json({ id: ret.insertId });
});
r.put('/knowledge/:id', async (req, res) => {
  const { type, title, content, tags } = req.body || {};
  await pool.query('UPDATE knowledge_entries SET type=COALESCE(?,type), title=COALESCE(?,title), content=COALESCE(?,content), tags=COALESCE(?,tags) WHERE id=?',
    [type || null, title || null, content || null, tags ? JSON.stringify(tags) : null, +req.params.id]);
  res.json({ ok: true });
});
r.delete('/knowledge/:id', async (req, res) => {
  await pool.query('DELETE FROM knowledge_entries WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});

/* ---------- 异常样本与红线 ---------- */
r.get('/exceptions', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM exceptions ORDER BY id');
  const redline = { decisions: 0, contacts: 0, conclusions: 0 };
  res.json({ items: rows, redline });
});
r.put('/exceptions/:id', async (req, res) => {
  const { result } = req.body || {};
  await pool.query('UPDATE exceptions SET result=? WHERE id=?', [result === '通过' ? '通过' : '待验证', +req.params.id]);
  res.json({ ok: true });
});

/* ---------- 验收看板 ---------- */
r.get('/acceptance', async (req, res) => {
  const [reports] = await pool.query('SELECT * FROM reports ORDER BY period_start');
  const [[scanned]] = await pool.query('SELECT COALESCE(SUM(scanned),0) s FROM reports');
  const [[comAll]] = await pool.query('SELECT COUNT(*) c FROM companies');
  const [[comGo]] = await pool.query("SELECT COUNT(*) c FROM companies WHERE status='继续研究'");
  const [[sigN]] = await pool.query("SELECT COUNT(*) c FROM signals WHERE status='正常'");
  const [[sigAll]] = await pool.query('SELECT COUNT(*) c FROM signals');
  const [[fqOk]] = await pool.query("SELECT COUNT(*) c FROM four_questions WHERE status='AI生成+人工确认'");
  const [[fqAll]] = await pool.query('SELECT COUNT(*) c FROM four_questions');
  const [[scored]] = await pool.query('SELECT COUNT(DISTINCT company_id) c FROM company_scores');
  const owners = [
    { name: '符逸凡', duty: '负责周度样本整理、AI 方案测试、候选企业复核记录、指标统计和证据留痕' },
    { name: '项目负责人 / 投资团队相关负责人', duty: '负责对产业方向、候选企业是否值得继续研究、战略协同性及投资价值进行最终人工复核' }
  ];
  res.json({
    reports: reports.map(r => ({ ...r, published_at: r.published_at })),
    metrics: [
      { name: '累计扫描公开信息', value: num(scanned.s), unit: '条' },
      { name: '累计候选企业', value: comAll.c, unit: '家' },
      { name: '标记继续研究', value: comGo.c, unit: '家' },
      { name: '信号信噪比', value: sigAll.c ? Math.round(sigN.c / sigAll.c * 100) : 100, unit: '%' },
      { name: '完成评分企业', value: scored.c, unit: '家' },
      { name: '四问逻辑人工确认', value: `${fqOk.c}/${fqAll.c}`, unit: '' }
    ],
    owners,
    redline: '自动作出正式投资决策 0 次 · 自动联系企业 0 次 · 自动生成确定性投资结论 0 次'
  });
});

/* ---------- 活动日志 ---------- */
r.get('/activities', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT a.*, u.display_name FROM activity_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 100');
  res.json(rows);
});

module.exports = r;
