import { randomBytes, scryptSync } from 'node:crypto';
import readline from 'node:readline';
if (!process.stdin.isTTY) throw new Error('请在私人交互终端运行，不要把密码放到命令参数或聊天。');
process.stdout.write('设置网页版独立密码（至少 12 字符，输入不回显）：');
readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
let input = '';
process.stdin.on('keypress', (character, key) => {
  if (key?.ctrl && key.name === 'c') process.exit(1);
  if (key?.name === 'return') {
    process.stdin.setRawMode(false);
    if (input.length < 12 || input.length > 128) { console.error('\n密码须为 12–128 字符。'); process.exit(1); }
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(input, salt, 32).toString('hex');
    input = '';
    console.log('\n将下一行保存到服务器 .env，不要发到聊天：\nADMIN_PASSWORD_HASH=scrypt:' + salt + ':' + hash);
    process.exit(0);
  }
  if (key?.name === 'backspace') input = input.slice(0, -1);
  else if (character && !key?.ctrl && input.length < 128) input += character;
});
