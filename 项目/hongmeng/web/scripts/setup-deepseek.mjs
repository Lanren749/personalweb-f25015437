import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';
const filename = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
if (!process.stdin.isTTY) throw new Error('请在私人交互终端运行；不要把 Key 放入命令参数或聊天。');
const configuration = await fs.readFile(filename, 'utf8');
readline.emitKeypressEvents(process.stdin); process.stdin.setRawMode(true);
let input = '', finished = false;
process.stdout.write('粘贴 DeepSeek API Key（不回显；输入 DELETE 可删除现有 Key）：');
process.stdin.on('keypress', async (character, key) => {
  if (finished) return;
  if (key?.ctrl && key.name === 'c') { process.stdin.setRawMode(false); process.exit(1); }
  if (key?.name === 'return') {
    if (input !== 'DELETE' && !/^[A-Za-z0-9_-]{16,256}$/.test(input)) { input = ''; process.stdout.write('\n格式无效，请重试：'); return; }
    finished = true; process.stdin.setRawMode(false);
    const line = 'DEEPSEEK_API_KEY=' + (input === 'DELETE' ? '' : input); input = '';
    const next = /^DEEPSEEK_API_KEY=.*$/m.test(configuration) ? configuration.replace(/^DEEPSEEK_API_KEY=.*$/m, line) : configuration + '\n' + line + '\n';
    const temporary = filename + '.' + randomBytes(6).toString('hex') + '.tmp';
    await fs.writeFile(temporary, next, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, filename);
    console.log('\n私有配置已更新，未输出密钥，也没有发送任何付费请求。请运行：sudo docker compose up -d --no-deps web'); process.exit(0);
  }
  if (key?.name === 'backspace') input = input.slice(0, -1);
  else if (character && !key?.ctrl && input.length < 256) input += character;
});
