const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');

const r = express.Router();
r.use(requireAuth);

/* ---------- 能力图谱：业务板块 + 能力要素 ---------- */
r.get('/units', async (req, res) => {
  const [units] = await pool.query('SELECT * FROM business_units ORDER BY sort');
  const [caps] = await pool.query('SELECT * FROM capabilities ORDER BY unit_id, sort');
  res.json(units.map(u => ({ ...u, caps: caps.filter(c => c.unit_id === u.id) })));
});
r.post('/units', requireAdmin, async (req, res) => {
  const { name, type, description } = req.body || {};
  if (!name) return res.status(400).json({ error: '请填写板块名称' });
  const [ret] = await pool.query('INSERT INTO business_units (name, type, description, sort) VALUES (?,?,?,(SELECT * FROM (SELECT COALESCE(MAX(sort),0)+1 FROM business_units) t))', [name, type === '资源要素' ? '资源要素' : '主业板块', description || '']);
  res.json({ id: ret.insertId });
});
r.put('/units/:id', requireAdmin, async (req, res) => {
  const { name, type, description } = req.body || {};
  await pool.query('UPDATE business_units SET name=COALESCE(?,name), type=COALESCE(?,type), description=COALESCE(?,description) WHERE id=?', [name || null, type || null, description || null, +req.params.id]);
  res.json({ ok: true });
});
r.delete('/units/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM capabilities WHERE unit_id=?', [+req.params.id]);
  await pool.query('DELETE FROM business_units WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});
r.post('/caps', requireAdmin, async (req, res) => {
  const { unit_id, name, category, description, strength } = req.body || {};
  if (!unit_id || !name) return res.status(400).json({ error: '参数不完整' });
  const [ret] = await pool.query('INSERT INTO capabilities (unit_id, name, category, description, strength, sort) VALUES (?,?,?,?,?,(SELECT * FROM (SELECT COALESCE(MAX(sort),0)+1 FROM capabilities WHERE unit_id=?) t))',
    [unit_id, name, category || '', description || '', Math.min(5, Math.max(1, +strength || 3)), unit_id]);
  res.json({ id: ret.insertId });
});
r.put('/caps/:id', requireAdmin, async (req, res) => {
  const { name, category, description, strength } = req.body || {};
  await pool.query('UPDATE capabilities SET name=COALESCE(?,name), category=COALESCE(?,category), description=COALESCE(?,description), strength=COALESCE(?,strength) WHERE id=?',
    [name || null, category || null, description || null, strength ? +strength : null, +req.params.id]);
  res.json({ ok: true });
});
r.delete('/caps/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM capabilities WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});

/* ---------- 投资边界 ---------- */
r.get('/boundaries', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM invest_boundaries ORDER BY sort');
  res.json(rows);
});
r.post('/boundaries', requireAdmin, async (req, res) => {
  const { rule_type, content } = req.body || {};
  if (!rule_type || !content) return res.status(400).json({ error: '参数不完整' });
  const [ret] = await pool.query('INSERT INTO invest_boundaries (rule_type, content, sort) VALUES (?,?,(SELECT * FROM (SELECT COALESCE(MAX(sort),0)+1 FROM invest_boundaries) t))', [rule_type, content]);
  res.json({ id: ret.insertId });
});
r.put('/boundaries/:id', requireAdmin, async (req, res) => {
  const { rule_type, content } = req.body || {};
  await pool.query('UPDATE invest_boundaries SET rule_type=COALESCE(?,rule_type), content=COALESCE(?,content) WHERE id=?', [rule_type || null, content || null, +req.params.id]);
  res.json({ ok: true });
});
r.delete('/boundaries/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM invest_boundaries WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});

/* ---------- 评分维度 ---------- */
r.get('/dimensions', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM score_dimensions ORDER BY sort');
  res.json(rows);
});
r.put('/dimensions/:id', requireAdmin, async (req, res) => {
  const { name, description, weight, enabled } = req.body || {};
  await pool.query('UPDATE score_dimensions SET name=COALESCE(?,name), description=COALESCE(?,description), weight=COALESCE(?,weight), enabled=COALESCE(?,enabled) WHERE id=?',
    [name || null, description || null, weight != null ? +weight : null, enabled != null ? (enabled ? 1 : 0) : null, +req.params.id]);
  res.json({ ok: true });
});
r.post('/dimensions', requireAdmin, async (req, res) => {
  const { name, description, weight } = req.body || {};
  if (!name) return res.status(400).json({ error: '请填写维度名称' });
  const [ret] = await pool.query('INSERT INTO score_dimensions (name, description, weight, sort) VALUES (?,?,?,(SELECT * FROM (SELECT COALESCE(MAX(sort),0)+1 FROM score_dimensions) t))', [name, description || '', +weight || 0]);
  res.json({ id: ret.insertId });
});
r.delete('/dimensions/:id', requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM score_dimensions WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});

module.exports = r;
