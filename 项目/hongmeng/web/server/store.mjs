import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
export class JsonStore {
  constructor(directory) { this.directory = directory; this.queue = Promise.resolve(); }
  async read(name, fallback) {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, name + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw new Error('存储读取失败，未覆盖原数据'); }
  }
  write(name, value) {
    const work = this.queue.then(async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const destination = path.join(this.directory, name + '.json');
      const temporary = destination + '.' + randomBytes(6).toString('hex') + '.tmp';
      let file;
      try {
        file = await fs.open(temporary, 'wx', 0o600);
        await file.writeFile(JSON.stringify(value));
        await file.sync();
        await file.close(); file = undefined;
        await fs.rename(temporary, destination);
        const directory = await fs.open(this.directory, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { await file?.close(); await fs.unlink(temporary).catch(() => {}); }
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
