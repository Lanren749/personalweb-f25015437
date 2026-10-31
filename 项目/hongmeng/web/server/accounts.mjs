import { randomBytes, scrypt, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { emptyPersonal, validPersonal } from './personal.mjs';
import { readAiReport, validApiKey } from '../dist/shared/model/Ai.js';

const derive = promisify(scrypt);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD = /^.{12,128}$/s;
const HASH = /^scrypt:([a-f0-9]{32}):([a-f0-9]{64})$/;
const ENCRYPTED = /^v1:([^:]+):([^:]+):([^:]+)$/;

export function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function validEmail(value) { return EMAIL.test(value) && value.length <= 254; }
function validPassword(value) { return typeof value === 'string' && PASSWORD.test(value); }
function passwordHash(password) { const salt = randomBytes(16).toString('hex'); return 'scrypt:' + salt + ':' + scryptSync(password, salt, 32).toString('hex'); }
async function verifyPassword(password, stored) {
  const match = HASH.exec(stored || ''); if (!match || !validPassword(password)) return false;
  const actual = await derive(password, match[1], 32); return timingSafeEqual(Buffer.from(match[2], 'hex'), actual);
}
function masterKey(value) {
  if (!value) return null;
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('DATA_ENCRYPTION_KEY 必须是 64 位十六进制密钥');
  return Buffer.from(value, 'hex');
}
function encrypt(value, key) {
  if (!key) throw new Error('服务器尚未配置数据加密密钥，请先运行 setup-data-key.mjs');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return 'v1:' + iv.toString('base64url') + ':' + cipher.getAuthTag().toString('base64url') + ':' + ciphertext.toString('base64url');
}
function decrypt(value, key) {
  const match = ENCRYPTED.exec(value || ''); if (!match || !key) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(match[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(match[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(match[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch (_) { throw new Error('用户密钥无法解密，未覆盖原数据'); }
}
function validUser(user) {
  let reportOK = true;
  if (user?.aiReport) { try { readAiReport(JSON.stringify(user.aiReport)); } catch (_) { reportOK = false; } }
  const chatOK = user?.aiChat === undefined || (Array.isArray(user.aiChat) && user.aiChat.length <= 12 && user.aiChat.every(message =>
    message !== null && typeof message === 'object' && ['user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string' && message.content.length <= 2000));
  return user && typeof user.id === 'string' && /^[a-f0-9]{32}$/.test(user.id) && validEmail(user.email) && HASH.test(user.passwordHash) &&
    Number.isFinite(user.createdAt) && validPersonal(user.personal) && reportOK && chatOK && user.aiUsage &&
    /^$|^\d{4}-\d{2}-\d{2}$/.test(user.aiUsage.day) && Number.isInteger(user.aiUsage.count) && user.aiUsage.count >= 0 &&
    (user.apiKey === '' || typeof user.apiKey === 'string');
}
function emptyUser(email, hash) {
  return { id: randomBytes(16).toString('hex'), email, passwordHash: hash, createdAt: Date.now(), personal: emptyPersonal(), apiKey: '', aiUsage: { day: '', count: 0 }, aiReport: null, aiChat: [] };
}

export class Accounts {
  constructor(store, { dataKey = '', legacyPasswordHash = '', legacyEmail = 'owner@local.invalid', legacyKey = '' } = {}) {
    this.store = store; this.dataKey = masterKey(dataKey); this.legacyPasswordHash = legacyPasswordHash;
    this.legacyEmail = normalizeEmail(legacyEmail) || 'owner@local.invalid'; this.legacyKey = legacyKey;
    this.value = { version: 1, users: [] }; this.queue = Promise.resolve();
  }
  async init() {
    let value = await this.store.read('accounts', null);
    if (!value) {
      const legacyPersonal = await this.store.read('personal', emptyPersonal());
      const legacyUsage = await this.store.read('ai-usage', { day: '', count: 0 });
      const legacyReport = await this.store.read('ai-report', null); const users = [];
      if (this.legacyPasswordHash) {
        if (!validPersonal(legacyPersonal)) throw new Error('旧个人数据格式异常，未迁移');
        const user = emptyUser(this.legacyEmail, this.legacyPasswordHash); user.personal = legacyPersonal; user.aiUsage = legacyUsage;
        if (legacyReport) { readAiReport(JSON.stringify(legacyReport)); user.aiReport = legacyReport; }
        if (this.legacyKey) user.apiKey = encrypt(this.legacyKey, this.dataKey);
        users.push(user);
      }
      value = { version: 1, users }; if (users.length) await this.store.write('accounts', value);
    }
    if (value?.version !== 1 || !Array.isArray(value.users) || value.users.length > 1000 || !value.users.every(validUser)) throw new Error('账号数据异常，未覆盖原文件');
    let migrated = false;
    for (const user of value.users) if (user.aiChat === undefined) { user.aiChat = []; migrated = true; }
    if (migrated) await this.store.write('accounts', value);
    this.value = value;
  }
  get userCount() { return this.value.users.length; }
  findById(id) { return this.value.users.find(user => user.id === id) || null; }
  findByEmail(email) { const normalized = normalizeEmail(email); return this.value.users.find(user => user.email === normalized) || null; }
  publicUser(user) { return user ? { id: user.id, email: user.email, createdAt: user.createdAt } : null; }
  async register(email, password) {
    const normalized = normalizeEmail(email);
    if (!validEmail(normalized)) throw Object.assign(new Error('请输入有效邮箱地址'), { status: 400 });
    if (!validPassword(password)) throw Object.assign(new Error('密码长度需要为 12 至 128 个字符'), { status: 400 });
    return this.mutate(async value => {
      if (value.users.some(user => user.email === normalized)) throw Object.assign(new Error('该邮箱已注册，请直接登录'), { status: 409 });
      const user = emptyUser(normalized, passwordHash(password)); value.users.push(user); return user;
    });
  }
  async verify(email, password) { const user = this.findByEmail(email); return user && await verifyPassword(password, user.passwordHash) ? user : null; }
  async mutate(operation) {
    const task = this.queue.then(async () => { const next = structuredClone(this.value); const result = await operation(next); await this.store.write('accounts', next); this.value = next; return result; });
    this.queue = task.catch(() => {}); return task;
  }
  async readUserData(id, name, fallback) {
    const user = this.findById(id); if (!user) throw Object.assign(new Error('账号不存在'), { status: 401 });
    const field = name === 'personal' ? 'personal' : name === 'ai-usage' ? 'aiUsage' : name === 'ai-report' ? 'aiReport' : name === 'ai-chat' ? 'aiChat' : null;
    if (!field) throw new Error('用户数据类型不支持'); return structuredClone(user[field] ?? fallback);
  }
  async writeUserData(id, name, value) {
    return this.mutate(async next => { const user = next.users.find(item => item.id === id); if (!user) throw Object.assign(new Error('账号不存在'), { status: 401 });
      const field = name === 'personal' ? 'personal' : name === 'ai-usage' ? 'aiUsage' : name === 'ai-report' ? 'aiReport' : name === 'ai-chat' ? 'aiChat' : null;
      if (!field) throw new Error('用户数据类型不支持'); user[field] = structuredClone(value); return value; });
  }
  userStore(id) { return { read: (name, fallback) => this.readUserData(id, name, fallback), write: (name, value) => this.writeUserData(id, name, value) }; }
  apiKey(id) { const user = this.findById(id); if (!user) throw Object.assign(new Error('账号不存在'), { status: 401 }); return decrypt(user.apiKey, this.dataKey); }
  async saveApiKey(id, key) {
    if (key !== '' && !validApiKey(key)) throw Object.assign(new Error('DeepSeek API Key 格式无效'), { status: 400 });
    return this.mutate(async next => { const user = next.users.find(item => item.id === id); if (!user) throw Object.assign(new Error('账号不存在'), { status: 401 }); user.apiKey = key ? encrypt(key, this.dataKey) : ''; return { configured: !!key }; });
  }
}
