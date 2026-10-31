import { Competition, validTime } from './Competition';

export interface SourceInfo {
  id: string;
  name: string;
  url: string;
  automatic: boolean;
  description: string;
}

export interface SourceReport {
  id: string;
  success: boolean;
  count: number;
  checkedAt: number;
  message: string;
}

export interface RadarCache {
  version: number;
  sourceScope?: string;
  items: Competition[];
  reports: SourceReport[];
  lastAttempt: number;
  lastSuccess: number;
}

export interface ProjectNote {
  id: string;
  stage: string;
  text: string;
  updatedAt: number;
}

export function emptyCache(): RadarCache {
  return { version: 1, sourceScope: 'domestic-v1', items: [], reports: [], lastAttempt: 0, lastSuccess: 0 };
}

export function beijingDate(timestamp: number): string {
  return new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
}

export function formatBeijing(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '尚未更新';
}

export function shouldRefresh(now: number, lastAttempt: number, lastSuccess: number, time: string): boolean {
  if (!validTime(time) || now - lastAttempt < 15 * 60000) {
    return false;
  }
  if (lastSuccess === 0) {
    return true;
  }
  const target: number = Date.parse(beijingDate(now) + 'T' + time + ':00+08:00');
  return now >= target && lastSuccess < target;
}

export function isSafeOfficialUrl(value: string): boolean {
  const hosts: string[] = ['codeforces.com', 'atcoder.jp', 'jsjds.blcu.edu.cn', 'cloud.tencent.com',
    'algo.qq.com', 'competition.huaweicloud.com', 'developer.huaweicloud.com', 'dasai.lanqiao.cn', 'ac.nowcoder.com'];
  if (!value.startsWith('https://') || /[\s\\]/.test(value)) {
    return false;
  }
  const host: string = value.slice(8).split('/')[0];
  return hosts.includes(host);
}

export function mergeSourceItems(previous: Competition[], incoming: Competition[], sourceId: string, keepIds: string[]): Competition[] {
  const currentIds: string[] = incoming.map((item: Competition): string => item.id);
  const retained: Competition[] = previous.filter((item: Competition): boolean =>
    item.sourceId !== sourceId || (keepIds.includes(item.id) && !currentIds.includes(item.id)));
  incoming.forEach((item: Competition): void => {
    if (!retained.some((existing: Competition): boolean => existing.id === item.id)) {
      retained.push(item);
    }
  });
  return retained;
}
