import { emptyCache, shouldRefresh, mergeSourceItems } from '../dist/shared/model/Radar.js';
import { isDomesticCompetition, validTime } from '../dist/shared/model/Competition.js';
import { OFFICIAL_SOURCES } from '../dist/shared/data/OfficialSources.js';
import { parseNowcoder, parse4C } from '../dist/shared/services/FeedParsers.js';
import { requestText } from './network.mjs';
export class Catalog {
  constructor(store, { time = '09:00', fetchImpl, now = Date.now } = {}) {
    if (!validTime(time)) throw new Error('REFRESH_TIME 必须为 HH:mm（北京时间）');
    this.store = store; this.time = time; this.fetchImpl = fetchImpl; this.now = now;
    this.cache = emptyCache(); this.running = null; this.storageWarning = '';
  }
  async init() {
    const value = await this.store.read('catalog', emptyCache());
    if (value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.reports) ||
      !Number.isFinite(value.lastAttempt) || !Number.isFinite(value.lastSuccess) || !value.items.every(isDomesticCompetition)) {
      throw new Error('赛事缓存格式异常，未覆盖原文件');
    }
    this.cache = value;
  }
  snapshot() { return { ...this.cache, sources: OFFICIAL_SOURCES, refreshTime: this.time, refreshing: !!this.running, storageWarning: this.storageWarning }; }
  async refresh() {
    if (this.running) return this.running;
    if (this.now() - this.cache.lastAttempt < 60000) return this.snapshot();
    this.running = this.perform();
    try { return await this.running; } finally { this.running = null; }
  }
  async perform() {
    const now = this.now();
    this.cache.lastAttempt = now;
    const results = await Promise.all(OFFICIAL_SOURCES.filter(s => s.automatic).map(async source => {
      try {
        const raw = await requestText(source.url, { fetchImpl: this.fetchImpl });
        const items = (source.id === 'nowcoder' ? parseNowcoder : parse4C)(raw, now).filter(isDomesticCompetition);
        return { items, report: { id: source.id, success: true, count: items.length, checkedAt: now, message: '读取成功' } };
      } catch (_) { return { items: [], report: { id: source.id, success: false, count: 0, checkedAt: now, message: '来源暂不可用，保留上次缓存，请在官网核实' } }; }
    }));
    let items = this.cache.items;
    for (const result of results) if (result.report.success) items = mergeSourceItems(items, result.items, result.report.id, []);
    const next = { version: 1, sourceScope: 'domestic-v1', items, reports: results.map(r => r.report), lastAttempt: now,
      lastSuccess: results.every(r => r.report.success) ? now : this.cache.lastSuccess };
    try { await this.store.write('catalog', next); this.cache = next; this.storageWarning = ''; }
    catch (_) { this.storageWarning = '磁盘保存失败，仍显示上次完整缓存；请检查服务器存储'; }
    return this.snapshot();
  }
  start() {
    const tick = () => { if (shouldRefresh(this.now(), this.cache.lastAttempt, this.cache.lastSuccess, this.time)) this.refresh().catch(() => {}); };
    tick(); this.timer = setInterval(tick, 60000); this.timer.unref();
  }
  stop() { clearInterval(this.timer); }
}
