import { Competition, deadlineTimestamp } from '../model/Competition';

interface CodeforcesContest {
  id: number;
  name: string;
  phase: string;
  startTimeSeconds: number;
  durationSeconds: number;
}

interface CodeforcesResponse {
  status: string;
  result: CodeforcesContest[];
}

export function cleanText(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

interface NowcoderSettings {
  organizerName: string;
}

interface NowcoderContest {
  contestId: number;
  contestName: string;
  contestStartTime: number;
  contestEndTime: number;
  topCategoryId: number;
  settingInfo: NowcoderSettings;
}

export function parseNowcoder(body: string, now: number): Competition[] {
  const expression: RegExp = /<div\b[^>]*\bdata-json="([^"]+)"[^>]*>/g;
  const items: Competition[] = [];
  let recognized: number = 0;
  let match: RegExpExecArray | null = expression.exec(body);
  while (match !== null) {
    // The official page embeds HTML-escaped JSON; decode entities without stripping markup inside titles.
    const decoded: string = match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const row: NowcoderContest = JSON.parse(decoded) as NowcoderContest;
    if (row !== null && Number.isInteger(row.contestId) && row.contestId > 0 &&
      typeof row.contestName === 'string' && row.contestName.trim().length > 0 &&
      Number.isFinite(row.contestStartTime) && Number.isFinite(row.contestEndTime) &&
      row.contestEndTime > row.contestStartTime && row.settingInfo !== null &&
      typeof row.settingInfo === 'object' && typeof row.settingInfo.organizerName === 'string') {
      recognized++;
      if (row.topCategoryId === 13 && ['nowcoder.com', '牛客竞赛'].includes(row.settingInfo.organizerName) &&
        /^牛客(?:周赛|小白月赛|练习赛|挑战赛)/.test(row.contestName) &&
        row.contestEndTime >= now - 7 * 86400000 && row.contestStartTime <= now + 120 * 86400000 &&
        !items.some((item: Competition): boolean => item.id === 'nc-' + row.contestId)) {
        items.push({ id: 'nc-' + row.contestId, title: cleanText(row.contestName).slice(0, 200),
          organizer: '牛客竞赛', category: '算法竞赛', deadline: '',
          tags: ['国内赛事', '算法', '编程实践'], format: '线上算法赛',
          description: '来自牛客官网的自办赛程。开赛时间不等于报名截止时间，资格和报名安排请以比赛原文为准。周赛、月赛与练习赛可用于算法训练和复盘，不等同于国家级奖项。',
          deliverables: ['保留本人代码提交与题解', '记录算法选择、复杂度和调试过程', '用官方记录核实成绩与个人贡献'],
          accent: '#0E9384', sourceId: 'nowcoder', sourceUrl: 'https://ac.nowcoder.com/acm/contest/' + row.contestId,
          fetchedAt: now, startsAt: row.contestStartTime, endsAt: row.contestEndTime, kind: 'contest' });
      }
    }
    match = expression.exec(body);
  }
  if (recognized === 0) {
    throw new Error('未识别到牛客官方赛程，保留旧缓存');
  }
  return items.slice(0, 50);
}

function algorithmItem(id: string, title: string, source: string, url: string, start: number, end: number, now: number): Competition {
  return { id: id, title: title, organizer: source === 'atcoder' ? 'AtCoder' : 'Codeforces',
    category: '算法竞赛', deadline: '', tags: ['算法', '数据结构', '解题复盘'], format: '线上算法赛',
    description: '来自平台官方赛程。这里展示的是开赛时间，不是报名截止时间。请在官网核实参赛资格、报名状态和赛制；常规练习赛不等同于国家级奖项。',
    deliverables: ['保留本人提交记录与可公开的题解', '复盘算法选择、复杂度与错误原因', '只记录可核实的排名及个人贡献'],
    accent: source === 'atcoder' ? '#0E9384' : '#3366FF', sourceId: source, sourceUrl: url,
    fetchedAt: now, startsAt: start, endsAt: end, kind: 'contest' };
}

export function parseCodeforces(body: string, now: number): Competition[] {
  const response: CodeforcesResponse = JSON.parse(body) as CodeforcesResponse;
  if (response === null || response.status !== 'OK' || !Array.isArray(response.result)) {
    throw new Error('官方 API 格式变化或服务暂不可用');
  }
  const items: Competition[] = [];
  let recognized: number = 0;
  response.result.forEach((row: CodeforcesContest): void => {
    if (row === null || typeof row.name !== 'string' || !Number.isInteger(row.id) || row.id <= 0 ||
      !Number.isFinite(row.startTimeSeconds) || !Number.isFinite(row.durationSeconds) || row.durationSeconds <= 0) {
      return;
    }
    recognized++;
    const start: number = row.startTimeSeconds * 1000;
    const end: number = start + row.durationSeconds * 1000;
    if (end < now - 7 * 86400000 || start > now + 120 * 86400000) {
      return;
    }
    items.push(algorithmItem('cf-' + row.id, row.name.slice(0, 200), 'codeforces',
      'https://codeforces.com/contest/' + row.id, start, end, now));
  });
  if (response.result.length > 0 && recognized === 0) {
    throw new Error('官方 API 条目结构变化，保留旧缓存');
  }
  return items.slice(0, 50);
}

export function parseAtCoder(body: string, now: number): Competition[] {
  if (!body.includes('contest-table-') || !body.includes('AtCoder')) {
    throw new Error('官网赛程结构变化，请打开官网查看');
  }
  const rows: RegExpMatchArray | null = body.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi);
  const items: Competition[] = [];
  let recognized: number = 0;
  if (rows === null) {
    throw new Error('没有识别到赛程表，保留旧缓存');
  }
  rows.forEach((row: string): void => {
    const date: RegExpMatchArray | null = row.match(/<time[^>]*>(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\+0900<\/time>/);
    const link: RegExpMatchArray | null = row.match(/href="\/contests\/([a-zA-Z0-9_-]+)"[^>]*>([\s\S]*?)<\/a>/);
    const duration: RegExpMatchArray | null = row.match(/<td[^>]*>\s*(\d{1,4}):(\d{2})\s*<\/td>/);
    if (date === null || link === null || duration === null) {
      return;
    }
    if (!Number.isFinite(deadlineTimestamp(date[1])) || Number(duration[2]) > 59) {
      return;
    }
    const start: number = Date.parse(date[1] + 'T' + date[2] + '+09:00');
    const end: number = start + (Number(duration[1]) * 60 + Number(duration[2])) * 60000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }
    recognized++;
    if (end < now - 7 * 86400000 || start > now + 120 * 86400000) {
      return;
    }
    items.push(algorithmItem('at-' + link[1], cleanText(link[2]).slice(0, 200), 'atcoder',
      'https://atcoder.jp/contests/' + link[1], start, end, now));
  });
  if (recognized === 0) {
    throw new Error('没有识别到有效赛程，保留旧缓存并请在官网确认');
  }
  return items.slice(0, 50);
}

export function parse4C(body: string, now: number): Competition[] {
  const expression: RegExp = /<li>\s*<a\s+href="(info\/1042\/(\d+)\.htm)"[^>]*>([\s\S]*?)<\/a>\s*<i>(\d{4}-\d{2}-\d{2})<\/i>\s*<\/li>/g;
  const items: Competition[] = [];
  let match: RegExpExecArray | null = expression.exec(body);
  let recognized: number = 0;
  while (match !== null) {
    recognized++;
    const published: number = Date.parse(match[4] + 'T00:00:00+08:00');
    if (Number.isFinite(deadlineTimestamp(match[4])) && Number.isFinite(published) &&
      published >= now - 400 * 86400000 && published <= now + 86400000) {
      items.push({ id: '4c-' + match[2], title: cleanText(match[3]).slice(0, 200),
        organizer: '中国大学生计算机设计大赛组委会', category: '软件开发', deadline: '',
        tags: ['全国赛事', '官方公告', '作品实践'], format: '公告 / 参赛安排',
        description: '本条来自组委会大赛动态，仅提供公告标题与发布日期，不代表该赛事仍在报名。请阅读原文核实届次、参赛类别、校赛选拔要求和具体时间。',
        deliverables: ['按官方作品要求规划代码与演示材料', '记录个人分工、技术方案和测试依据', '保留获奖证书、提交版本与答辩材料'],
        accent: '#7A5AF8', sourceId: '4c', sourceUrl: 'https://jsjds.blcu.edu.cn/' + match[1],
        fetchedAt: now, publishedAt: match[4], kind: 'announcement' });
    }
    match = expression.exec(body);
  }
  if (recognized === 0) {
    throw new Error('未识别到官方公告列表，保留旧缓存');
  }
  return items.sort((a: Competition, b: Competition): number => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 30);
}
