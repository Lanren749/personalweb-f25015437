import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../entry/src/main/ets');
const modules = ['model/Competition', 'model/Radar', 'model/Ai', 'services/FeedParsers', 'data/OfficialSources'];
for (const module of modules) {
  const input = await fs.readFile(path.join(source, module + '.ets'), 'utf8');
  const result = ts.transpileModule(input, { reportDiagnostics: true, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022
  } });
  if (result.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('共享模块编译失败：' + module);
  const linked = result.outputText.replace(/from (['"])([^'"]+)['"]/g,
    (match, quote, specifier) => specifier.startsWith('.') ? 'from ' + quote + specifier + '.js' + quote : match);
  const destination = path.join(root, 'dist/shared', module + '.js');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, linked);
}
await fs.mkdir(path.join(root, 'dist/public'), { recursive: true });
await fs.cp(path.join(root, 'public'), path.join(root, 'dist/public'), { recursive: true });
console.log('网页与共享赛事逻辑构建完成；原生 App 未修改。');
