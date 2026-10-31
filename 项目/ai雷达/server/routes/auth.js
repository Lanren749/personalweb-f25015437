const express = require('express');
const { pool } = require('../db');
const { sign, verify, hashPassword, requireAuth, requireAdmin } = require('../auth');

const r = express.Router();

r.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名与密码' });
  const [rows] = await pool.query('SELECT * FROM users WHERE username=?', [username]);
  if (!rows.length) return res.status(401).json({ error: '用户名或密码错误' });
  const u = rows[0];
  const { hash } = hashPassword(password, u.salt);
  if (hash !== u.password_hash) return res.status(401).json({ error: '用户名或密码错误' });
  const token = sign({ uid: u.id, username: u.username, role: u.role, displayName: u.display_name });
  await pool.query('INSERT INTO activity_logs (user_id, module, action, detail) VALUES (?,?,?,?)', [u.id, '系统', '登录', `${u.display_name} 登录系统`]);
  res.json({ token, user: { id: u.id, username: u.username, role: u.role, displayName: u.display_name } });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

/* ---------- 用户管理（管理员） ---------- */
r.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, display_name, role, created_at FROM users ORDER BY id');
  res.json(rows);
});
r.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, display_name, role } = req.body || {};
  if (!username || !password || !display_name) return res.status(400).json({ error: '参数不完整' });
  try {
    const { salt, hash } = hashPassword(password);
    const [ret] = await pool.query('INSERT INTO users (username, salt, password_hash, display_name, role) VALUES (?,?,?,?,?)',
      [username, salt, hash, display_name, role === 'admin' ? 'admin' : 'investor']);
    res.json({ id: ret.insertId });
  } catch (e) {
    res.status(e.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: e.code === 'ER_DUP_ENTRY' ? '用户名已存在' : '创建失败' });
  }
});
r.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { display_name, role, password } = req.body || {};
  const id = +req.params.id;
  if (password) {
    const { salt, hash } = hashPassword(password);
    await pool.query('UPDATE users SET salt=?, password_hash=? WHERE id=?', [salt, hash, id]);
  }
  if (display_name || role) {
    await pool.query('UPDATE users SET display_name=COALESCE(?,display_name), role=COALESCE(?,role) WHERE id=?', [display_name || null, role || null, id]);
  }
  res.json({ ok: true });
});
r.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  await pool.query('DELETE FROM users WHERE id=?', [+req.params.id]);
  res.json({ ok: true });
});

module.exports = r;
