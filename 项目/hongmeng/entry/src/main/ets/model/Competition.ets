export interface Competition {
  id: string;
  title: string;
  organizer: string;
  category: string;
  deadline: string;
  tags: string[];
  format: string;
  description: string;
  deliverables: string[];
  accent: string;
  sourceId?: string;
  sourceUrl?: string;
  fetchedAt?: number;
  publishedAt?: string;
  startsAt?: number;
  endsAt?: number;
  kind?: string;
}

export interface CompetitionQuery {
  keyword: string;
  category: string;
  filter: string;
  view: string;
  favoriteIds: string[];
  plannedIds: string[];
  now: number;
}

// Restrict discovery by verified source and organizer, not by title language.
export function isDomesticCompetition(item: Competition): boolean {
  return (item.sourceId === '4c' && /^https:[/][/]jsjds\.blcu\.edu\.cn[/]info[/]1042[/]\d+\.htm$/.test(item.sourceUrl ?? '')) ||
    (item.sourceId === 'nowcoder' && item.organizer === '牛客竞赛' &&
      /^牛客(?:周赛|小白月赛|练习赛|挑战赛)/.test(item.title) &&
      /^https:[/][/]ac\.nowcoder\.com[/]acm[/]contest[/]\d+$/.test(item.sourceUrl ?? ''));
}

const DAY_MS: number = 86400000;
const CHINA_OFFSET_MS: number = 8 * 60 * 60 * 1000;
const calendarCheck: Date = new Date(0);

// A date-only deadline means the end of that day in Asia/Shanghai.
export function deadlineTimestamp(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Number.NaN;
  }
  const timestamp: number = Date.parse(date + 'T23:59:59.999+08:00');
  if (!Number.isFinite(timestamp)) {
    return Number.NaN;
  }
  calendarCheck.setTime(timestamp);
  if (calendarCheck.toISOString().slice(0, 10) !== date) {
    return Number.NaN;
  }
  return timestamp;
}

export function remainingDays(item: Competition, now: number): number | null {
  const deadline: number = deadlineTimestamp(item.deadline);
  if (!Number.isFinite(deadline)) {
    return null;
  }
  return Math.floor((deadline + CHINA_OFFSET_MS) / DAY_MS) -
    Math.floor((now + CHINA_OFFSET_MS) / DAY_MS);
}

export function deadlineLabel(item: Competition, now: number): string {
  if (item.startsAt !== undefined) {
    if (item.endsAt !== undefined && now >= item.endsAt) {
      return '比赛已结束';
    }
    return now >= item.startsAt ? '比赛进行中' : '尚未开赛 · 报名规则见官网';
  }
  if (item.kind === 'announcement') {
    return '官方公告 · 非报名状态';
  }
  const days: number | null = remainingDays(item, now);
  if (days === null) {
    return '截止日期待确认';
  }
  if (days < 0) {
    return '已截止';
  }
  return days === 0 ? '今天截止' : '距截止 ' + days + ' 天';
}

export function isDueSoon(item: Competition, now: number): boolean {
  const days: number | null = remainingDays(item, now);
  return days !== null && days >= 0 && days <= 7;
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value: string): boolean => value !== id) : ids.concat([id]);
}

export function validIds(ids: string[], items: Competition[]): string[] {
  const result: string[] = [];
  ids.forEach((id: string): void => {
    if (typeof id === 'string' && items.some((item: Competition): boolean => item.id === id) && !result.includes(id)) {
      result.push(id);
    }
  });
  return result;
}

export function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function filterCompetitions(items: Competition[], query: CompetitionQuery): Competition[] {
  const term: string = query.keyword.trim().toLowerCase();
  return items.filter((item: Competition): boolean => {
    const searchable: string = [item.title, item.organizer, item.category, item.description].concat(item.tags).join(' ').toLowerCase();
    const days: number | null = remainingDays(item, query.now);
    return (term.length === 0 || searchable.includes(term)) &&
      (query.category === '全部方向' || item.category === query.category) &&
      (query.view !== '我的收藏' || query.favoriteIds.includes(item.id)) &&
      (query.view !== '报名计划' || query.plannedIds.includes(item.id)) &&
      (query.filter !== '7 天内截止' || isDueSoon(item, query.now)) &&
      (query.filter !== '近期赛程' || (item.startsAt !== undefined && item.startsAt >= query.now)) &&
      (query.filter !== '官方公告' || item.kind === 'announcement') &&
      (query.filter !== '进行中' || (item.startsAt !== undefined && item.endsAt !== undefined &&
        item.startsAt <= query.now && item.endsAt > query.now)) &&
      (query.filter !== '已结束' || (item.endsAt !== undefined && item.endsAt <= query.now)) &&
      (query.filter !== '未截止' || (days !== null && days >= 0)) &&
      (query.filter !== '已截止' || (days !== null && days < 0));
  }).sort((left: Competition, right: Competition): number => {
    if (left.sourceId !== undefined || right.sourceId !== undefined) {
      const leftRank: number = left.startsAt !== undefined && (left.endsAt ?? left.startsAt) > query.now ? 0 :
        left.kind === 'announcement' ? 1 : 2;
      const rightRank: number = right.startsAt !== undefined && (right.endsAt ?? right.startsAt) > query.now ? 0 :
        right.kind === 'announcement' ? 1 : 2;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      if (left.startsAt !== undefined && right.startsAt !== undefined) {
        return leftRank === 0 ? left.startsAt - right.startsAt : right.startsAt - left.startsAt;
      }
      if (left.publishedAt !== undefined && right.publishedAt !== undefined) {
        return right.publishedAt.localeCompare(left.publishedAt) || left.id.localeCompare(right.id);
      }
    }
    const leftDays: number | null = remainingDays(left, query.now);
    const rightDays: number | null = remainingDays(right, query.now);
    const leftRank: number = leftDays === null ? 2 : leftDays < 0 ? 1 : 0;
    const rightRank: number = rightDays === null ? 2 : rightDays < 0 ? 1 : 0;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    const difference: number = deadlineTimestamp(left.deadline) - deadlineTimestamp(right.deadline);
    return Number.isFinite(difference) && difference !== 0 ? difference : left.id.localeCompare(right.id);
  });
}
