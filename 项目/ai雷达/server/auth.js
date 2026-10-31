const crypto = require('crypto');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) throw new Error('请在本地 .env 或环境变量中设置至少 32 位 JWT_SECRET');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload, expSec = 7 * 24 * 3600) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + expSec }));
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verify(token) {
  try {
    const [h, b, s] = String(token).split('.');
    const expect = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
    if (s !== expect) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) { return null; }
}

function hashPassword(pwd, salt) {
  salt = salt || crypto.randomBytes(8).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + pwd).digest('hex');
  return { salt, hash };
}

/* 中间件：requireAuth / requireAdmin */
function requireAuth(req, res, next) {
  const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
  const payload = m && verify(m[1]);
  if (!payload) return res.status(401).json({ error: '未登录或登录已过期' });
  req.user = { id: payload.uid, username: payload.username, role: payload.role, displayName: payload.displayName };
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

module.exports = { sign, verify, hashPassword, requireAuth, requireAdmin };
