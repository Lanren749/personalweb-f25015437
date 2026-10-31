import { randomBytes } from 'node:crypto';
export class Auth {
  constructor(accounts, now = Date.now) {
    this.accounts = accounts; this.now = now; this.sessions = new Map(); this.attempts = new Map();
  }
  allow(key, limit, milliseconds) {
    const now = this.now();
    if (this.attempts.size > 2000) for (const [id, record] of this.attempts) if (record.until <= now) this.attempts.delete(id);
    if (this.attempts.size > 3000 && !this.attempts.has(key)) return false;
    let entry = this.attempts.get(key);
    if (!entry || entry.until <= now) { entry = { count: 0, until: now + milliseconds }; this.attempts.set(key, entry); }
    return ++entry.count <= limit;
  }
  async register(email, password, ip) {
    if (!this.allow('register:' + ip, 4, 15 * 60000) || !this.allow('register:global', 20, 15 * 60000)) return null;
    const user = await this.accounts.register(email, password); return this.createSession(user.id);
  }
  async login(email, password, ip) {
    if (!this.allow('login:' + ip, 8, 15 * 60000) || !this.allow('login:global', 30, 15 * 60000)) return null;
    const user = await this.accounts.verify(email, password); if (!user) return null;
    return this.createSession(user.id);
  }
  createSession(userId) {
    for (const [id, session] of this.sessions) if (session.until <= this.now()) this.sessions.delete(id);
    // Keep the in-memory session store bounded while allowing normal multi-user use.
    if (this.sessions.size >= 2000) this.sessions.delete(this.sessions.keys().next().value);
    const id = randomBytes(32).toString('hex');
    const session = { id, userId, csrf: randomBytes(24).toString('hex'), until: this.now() + 12 * 3600000 };
    this.sessions.set(id, session); return session;
  }
  session(req) {
    const id = /(?:^|;\s*)radar_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const session = this.sessions.get(id);
    if (session && session.until > this.now()) return session;
    if (id) this.sessions.delete(id); return null;
  }
  logout(req) { const session = this.session(req); if (session) this.sessions.delete(session.id); }
}
