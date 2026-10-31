import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';
import readline from 'node:readline';
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.stdin.isTTY) throw new Error('请在你自己的交互终端运行本脚本。');
const filename = path.join(directory, '.env');
let configuration;
try { configuration = await fs.readFile(filename, 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; configuration = await fs.readFile(path.join(directory, '.env.example'), 'utf8'); }
if (/^ADMIN_PASSWORD_HASH=scrypt:/m.test(configuration)) console.log('将替换网页版登录密码；不会修改服务器 SSH 密码或已有个人数据。');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
let input = '', first = '', step = 0, finished = false;
process.stdout.write('设置网页版独立密码（12–128 字符，不回显）：');
process.stdin.on('keypress', async (character, key) => {
  if (finished) return;
  if (key?.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
  if (key?.name === 'return') {
    if (input.length < 12 || input.length > 128) { input = ''; process.stdout.write('\n至少需要 12 字符，请重新输入：'); return; }
    if (step === 0) { first = input; input = ''; step = 1; process.stdout.write('\n请再次输入确认：'); return; }
    if (first !== input) { input = ''; first = ''; step = 0; process.stdout.write('\n两次不一致，请重新设置：'); return; }
    finished = true; process.stdin.setRawMode(false);
    const salt = randomBytes(16).toString('hex');
    const hash = 'scrypt:' + salt + ':' + scryptSync(input, salt, 32).toString('hex');
    input = ''; first = '';
    const line = 'ADMIN_PASSWORD_HASH=' + hash;
    const next = /^ADMIN_PASSWORD_HASH=.*$/m.test(configuration) ? configuration.replace(/^ADMIN_PASSWORD_HASH=.*$/m, line) : configuration + '\n' + line + '\n';
    const temporary = filename + '.' + randomBytes(6).toString('hex') + '.tmp';
    await fs.writeFile(temporary, next, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, filename);
    console.log('\n密码哈希已保存，未输出密码。请运行：sudo docker compose up -d --no-deps web'); process.exit(0);
  }
  if (key?.name === 'backspace') input = input.slice(0, -1);
  else if (character && !key?.ctrl && input.length < 128) input += character;
});
