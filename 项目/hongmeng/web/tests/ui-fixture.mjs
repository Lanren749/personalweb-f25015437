// Isolated development-only fixture. Never imported by the production server.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { createApp } from '../server/main.mjs';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'radar-ui-test-'));
const salt = 'b'.repeat(32);
const password = 'test-only-password-123456';
const hash = 'scrypt:' + salt + ':' + scryptSync(password, salt, 32).toString('hex');
const app = await createApp({ env: { APP_ORIGIN: 'http://localhost:18082', DATA_DIR: directory, ADMIN_PASSWORD_HASH: hash, OWNER_EMAIL: 'ui@example.com', DATA_ENCRYPTION_KEY: 'c'.repeat(64) } });
app.catalog.cache.items = [{ id: 'nc-123', title: '牛客周赛 UI TEST（仅测试）', organizer: '牛客竞赛', category: '算法竞赛',
  deadline: '', tags: ['国内赛事', '测试夹具'], format: '测试', description: '本条为隔离测试数据，不是线上比赛。', deliverables: ['测试保存与恢复'],
  accent: '#167b69', sourceId: 'nowcoder', sourceUrl: 'https://ac.nowcoder.com/acm/contest/123',
  fetchedAt: Date.now(), startsAt: Date.now() + 86400000, endsAt: Date.now() + 90000000, kind: 'contest' }];
app.server.listen(18082, '127.0.0.1', () => console.log('Isolated UI fixture on localhost:18082, no AI key or remote personal data.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  await app.close(); await fs.rm(directory, { recursive: true, force: true }); process.exit(0);
});
