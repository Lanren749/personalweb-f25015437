import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { AiReport, readAiReport } from '../model/Ai';

// Reports can exceed Preferences' 8192-character string limit.
// Commit a complete file before replacing the last known-good snapshot.
export class AiReportStore {
  private path: string;

  constructor(context: common.Context) {
    this.path = context.filesDir + '/ai-report-v1.json';
  }

  read(): AiReport | undefined {
    try {
      if (!fileIo.accessSync(this.path)) { return undefined; }
      if (fileIo.statSync(this.path).size > 800000) { throw new Error('Report too large'); }
      const report: AiReport | undefined = readAiReport(fileIo.readTextSync(this.path));
      if (report === undefined) { throw new Error('Empty report file'); }
      return report;
    } catch (_) {
      throw new Error('AI 历史报告读取失败，原文件未覆盖');
    }
  }

  save(report: AiReport): void {
    try {
      const raw: string = JSON.stringify(report);
      if (readAiReport(raw) === undefined) { throw new Error('Invalid report'); }
      const temporary: string = this.path + '.tmp';
      const file: fileIo.File = fileIo.openSync(temporary,
        fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      try {
        fileIo.writeSync(file.fd, raw);
        fileIo.fsyncSync(file.fd);
      } finally {
        fileIo.closeSync(file);
      }
      if (fileIo.readTextSync(temporary) !== raw) { throw new Error('Incomplete report write'); }
      fileIo.renameSync(temporary, this.path);
    } catch (_) {
      throw new Error('AI 报告保存失败，旧报告文件保留');
    }
  }
}
