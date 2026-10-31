import { common } from '@kit.AbilityKit';
import { http } from '@kit.NetworkKit';
import { fileIo } from '@kit.CoreFileKit';
import { Competition } from '../model/Competition';
import { RadarCache, SourceInfo, SourceReport, emptyCache, isSafeOfficialUrl, mergeSourceItems } from '../model/Radar';
import { OFFICIAL_SOURCES } from '../data/OfficialSources';
import { parse4C, parseNowcoder } from './FeedParsers';

interface SourceResult {
  report: SourceReport;
  items: Competition[];
}

export function validCachedItem(item: Competition): boolean {
  return item !== null && typeof item === 'object' && typeof item.id === 'string' &&
    typeof item.title === 'string' && typeof item.organizer === 'string' && typeof item.category === 'string' &&
    typeof item.deadline === 'string' && typeof item.format === 'string' && typeof item.description === 'string' &&
    typeof item.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.accent) &&
    Array.isArray(item.tags) && item.tags.every((tag: string): boolean => typeof tag === 'string') &&
    Array.isArray(item.deliverables) && item.deliverables.every((tag: string): boolean => typeof tag === 'string') &&
    typeof item.sourceUrl === 'string' && isSafeOfficialUrl(item.sourceUrl) &&
    typeof item.sourceId === 'string' && ['4c', 'nowcoder', 'atcoder', 'codeforces'].includes(item.sourceId) &&
    (item.fetchedAt === undefined || Number.isFinite(item.fetchedAt)) &&
    (item.publishedAt === undefined || typeof item.publishedAt === 'string') &&
    (item.startsAt === undefined || Number.isFinite(item.startsAt)) &&
    (item.endsAt === undefined || Number.isFinite(item.endsAt));
}

export class RadarService {
  private context: common.Context;
  private requests: http.HttpRequest[] = [];
  private cancelled: boolean = false;

  constructor(context: common.Context) {
    this.context = context;
  }

  readCache(): RadarCache {
    try {
      const path: string = this.context.filesDir + '/radar-cache-v1.json';
      if (!fileIo.accessSync(path)) {
        return emptyCache();
      }
      const cache: RadarCache = JSON.parse(fileIo.readTextSync(path)) as RadarCache;
      if (cache === null || cache.version !== 1 || !Array.isArray(cache.items) || !Array.isArray(cache.reports) ||
        !Number.isFinite(cache.lastAttempt) || !Number.isFinite(cache.lastSuccess) ||
        !cache.items.every((item: Competition): boolean => validCachedItem(item)) ||
        !cache.reports.every((report: SourceReport): boolean => report !== null && typeof report.id === 'string' &&
          typeof report.success === 'boolean' && typeof report.message === 'string' &&
          Number.isFinite(report.count) && Number.isFinite(report.checkedAt))) {
        throw new Error('缓存格式无效，需要重新联网更新');
      }
      if (cache.sourceScope !== 'domestic-v1') {
        // Preserve saved foreign records on disk, but allow the new domestic sources to refresh immediately.
        cache.sourceScope = 'domestic-v1';
        cache.reports = [];
        cache.lastAttempt = 0;
        cache.lastSuccess = 0;
      }
      return cache;
    } catch (_) {
      throw new Error('缓存读取失败，请重新联网更新');
    }
  }

  saveCache(cache: RadarCache): void {
    try {
      const destination: string = this.context.filesDir + '/radar-cache-v1.json';
      const temporary: string = destination + '.tmp';
      const file: fileIo.File = fileIo.openSync(temporary, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.TRUNC);
      try {
        fileIo.writeSync(file.fd, JSON.stringify(cache));
        fileIo.fsyncSync(file.fd);
      } finally {
        try {
          fileIo.closeSync(file);
        } catch (_) {
          throw new Error('关闭缓存文件失败');
        }
      }
      // Rename commits the complete snapshot; failures never truncate the previous cache.
      fileIo.renameSync(temporary, destination);
    } catch (_) {
      throw new Error('缓存保存失败，旧文件保留');
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.requests.forEach((request: http.HttpRequest): void => request.destroy());
    this.requests = [];
  }

  private async fetchSource(source: SourceInfo, now: number): Promise<SourceResult> {
    const request: http.HttpRequest = http.createHttp();
    this.requests.push(request);
    try {
      const response: http.HttpResponse = await request.request(source.url, {
        method: http.RequestMethod.GET, expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000, readTimeout: 15000, usingCache: false, maxLimit: 2 * 1024 * 1024
      });
      if (response.responseCode !== 200 || typeof response.result !== 'string') {
        throw new Error('HTTP ' + response.responseCode + '，请稍后重试');
      }
      const body: string = response.result as string;
      let items: Competition[];
      if (source.id === 'nowcoder') {
        items = parseNowcoder(body, now);
      } else if (source.id === '4c') {
        items = parse4C(body, now);
      } else {
        throw new Error('尚未配置该国内来源的读取方式');
      }
      return { items: items, report: { id: source.id, success: true, count: items.length, checkedAt: now,
        message: '读取成功 · ' + items.length + ' 条' } };
    } catch (error) {
      const message: string = error instanceof Error ? error.message : '网络连接失败';
      return { items: [], report: { id: source.id, success: false, count: 0, checkedAt: now,
        message: '更新失败，保留缓存 · ' + message.slice(0, 100) } };
    } finally {
      if (!this.cancelled) {
        request.destroy();
      }
      this.requests = this.requests.filter((active: http.HttpRequest): boolean => active !== request);
    }
  }

  async refresh(previous: RadarCache, keepIds: string[]): Promise<RadarCache> {
    const now: number = Date.now();
    const sources: SourceInfo[] = OFFICIAL_SOURCES.filter((source: SourceInfo): boolean => source.automatic);
    const results: SourceResult[] = await Promise.all(sources.map((source: SourceInfo): Promise<SourceResult> => this.fetchSource(source, now)));
    let items: Competition[] = previous.items.slice();
    results.forEach((result: SourceResult): void => {
      if (result.report.success) {
        items = mergeSourceItems(items, result.items, result.report.id, keepIds);
      }
    });
    return { version: 1, sourceScope: 'domestic-v1', items: items, reports: results.map((result: SourceResult): SourceReport => result.report),
      lastAttempt: now, lastSuccess: results.every((result: SourceResult): boolean => result.report.success) ? now : previous.lastSuccess };
  }
}
