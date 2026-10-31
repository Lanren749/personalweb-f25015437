import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const filename = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
let configuration = await fs.readFile(filename, 'utf8');
if (/^DATA_ENCRYPTION_KEY=[a-f0-9]{64}$/mi.test(configuration)) {
  console.log('DATA_ENCRYPTION_KEY 已存在，未替换。');
  process.exit(0);
}
const line = 'DATA_ENCRYPTION_KEY=' + randomBytes(32).toString('hex');
const next = /^DATA_ENCRYPTION_KEY=.*$/mi.test(configuration) ? configuration.replace(/^DATA_ENCRYPTION_KEY=.*$/mi, line) : configuration + '\n' + line + '\n';
const temporary = filename + '.' + randomBytes(6).toString('hex') + '.tmp';
await fs.writeFile(temporary, next, { mode: 0o600, flag: 'wx' });
await fs.rename(temporary, filename);
console.log('数据加密密钥已生成并保存到私有 .env，未输出密钥。请重启 web 服务。');
