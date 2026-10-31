const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const fs = require('fs');
const { pool } = require('./db');

const app = express();
app.use(express.json({ limit: '2mb' }));

/* 简单请求日志（排障用） */
app.use('/api', (req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} → ${res.statusCode} ${Date.now() - t0}ms`));
  next();
});

app.use('/api/auth', require('./routes/auth')); // 登录 / me / 用户管理
app.use('/api/brain', require('./routes/brain'));
app.use('/api/radar', require('./routes/radar'));
app.use('/api/sourcing', require('./routes/sourcing'));
app.use('/api/misc', require('./routes/misc'));
const intelligence = require('./routes/intelligence');
app.use('/api/intelligence', intelligence.router);

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 前端静态托管：HTML 禁缓存（保证发版即生效），静态资源缓存 1h */
const webDir = path.join(__dirname, '..', 'web');
const sendIndex = (req, res) => { res.set('Cache-Control', 'no-store'); res.sendFile(path.join(webDir, 'index.html')); };
app.get('/', sendIndex);
app.use(express.static(webDir, {
  index: false,
  maxAge: '1h',
  setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); }
}));
app.get(/^\/(?!api\/).*/, sendIndex);

/* 统一错误处理 */
app.use((err, req, res, next) => {
  console.error('[API Error]', err.message);
  res.status(500).json({ error: '服务器内部错误：' + err.message });
});

const PORT = +(process.env.PORT || 3211);
if (!fs.existsSync(path.join(webDir, 'index.html'))) console.warn('⚠ web/index.html 尚未生成，前端页面将 404（可先启动后端开发 API）');
process.on('uncaughtException', (e) => console.error('[uncaught]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandled]', (e && e.message) || e));
const server = app.listen(PORT, '127.0.0.1', () => console.log(`✓ radar-x 已启动: http://127.0.0.1:${PORT}`));
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
intelligence.startScheduler();

/* 让发布或重启时停止定时器，避免旧进程继续发起采集。 */
async function shutdown(signal) {
  console.log(`[shutdown] ${signal}`);
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  await Promise.all([intelligence.stopScheduler(), new Promise(resolve => server.close(resolve))]);
  try { await pool.end(); } catch (_) {}
  clearTimeout(deadline);
}
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => { shutdown(signal).finally(() => process.exit(0)); });
}
