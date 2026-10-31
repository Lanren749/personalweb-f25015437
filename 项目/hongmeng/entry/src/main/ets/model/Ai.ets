export interface CareerProfile {
  version: number;
  major: string;
  goals: string;
  interests: string;
}

export interface SearchHit {
  id: string;
  title: string;
  url: string;
  snippet: string;
  summary: string;
  date: string;
}

interface SearchWireHit {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  date: string | null;
}

interface SearchResponse { results: SearchWireHit[]; }
interface AiSelection {
  id: string;
  domestic: boolean;
  evidence: string;
  reason: string;
  action: string;
}
interface AiAnswer { recommendations: AiSelection[]; }

export interface AiRecommendation {
  source: SearchHit;
  evidence: string;
  reason: string;
  action: string;
}

export interface AiToolCall {
  name: string;
  count?: number;
  query?: string;
}

export interface AiReport {
  version: number;
  checkedAt: number;
  mode: string;
  profile: CareerProfile;
  queries: string[];
  searchedCount: number;
  items: AiRecommendation[];
  toolCalls?: AiToolCall[];
}

export function defaultProfile(): CareerProfile {
  return { version: 1, major: '计算机科学与技术', goals: '', interests: '' };
}

export function validProfile(profile: CareerProfile): boolean {
  return profile !== null && typeof profile === 'object' && profile.version === 1 &&
    typeof profile.major === 'string' && profile.major.length <= 80 &&
    typeof profile.goals === 'string' && profile.goals.length <= 600 &&
    typeof profile.interests === 'string' && profile.interests.length <= 200;
}

export function readProfile(raw: string): CareerProfile {
  if (raw.length === 0) { return defaultProfile(); }
  const profile: CareerProfile = JSON.parse(raw) as CareerProfile;
  if (!validProfile(profile)) { throw new Error('偏好格式异常，原记录未覆盖'); }
  return profile;
}

export function validApiKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{16,256}$/.test(key);
}

// Only public HTTPS domains; no credentials, ports, IP literals or local network links.
export function publicSearchUrl(value: string): boolean {
  return typeof value === 'string' && value.length <= 2048 &&
    /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:[/?#][^\s\\<>]*)?$/i.test(value) &&
    !/^https:\/\/[^/]*(?:\.local|\.localhost|\.internal|\.test|\.invalid)(?:[/?#]|$)/i.test(value);
}

export function domesticCandidate(hit: SearchHit): boolean {
  if (!publicSearchUrl(hit.url)) { return false; }
  const evidence: string = hit.title + ' ' + hit.snippet + ' ' + hit.summary;
  if (/codeforces|atcoder|kaggle|海外|境外|国外|全球赛|国际赛事/i.test(evidence + ' ' + hit.url)) { return false; }
  const domesticHost: boolean = /^https:\/\/(?:(?:[a-z0-9-]+\.)+(?:cn|qq\.com|huawei\.com|huaweicloud\.com|aliyun\.com|baidu\.com|nowcoder\.com)|(?:qq\.com|huawei\.com|huaweicloud\.com|aliyun\.com|baidu\.com|nowcoder\.com))(?:[/?#]|$)/i.test(hit.url);
  return domesticHost && /比赛|竞赛|大赛|挑战赛/.test(evidence) &&
    /中国|全国|国内|大学生|高校|腾讯|华为|阿里|百度|牛客|蓝桥|省赛|省级|主办单位|报名|赛区/.test(evidence);
}

export function parseSearch(raw: string): SearchHit[] {
  let response: SearchResponse;
  try { response = JSON.parse(raw) as SearchResponse; }
  catch (_) { throw new Error('搜索响应不是有效 JSON'); }
  if (response === null || !Array.isArray(response.results)) { throw new Error('搜索响应格式无效'); }
  const hits: SearchHit[] = [];
  response.results.slice(0, 50).forEach((row: SearchWireHit): void => {
    if (row === null || typeof row.title !== 'string' || typeof row.url !== 'string' ||
      typeof row.snippet !== 'string' || typeof row.summary !== 'string') { return; }
    const hit: SearchHit = { id: '', title: row.title.slice(0, 180), url: row.url,
      snippet: row.snippet.slice(0, 600), summary: row.summary.slice(0, 2400),
      date: typeof row.date === 'string' && Number.isFinite(Date.parse(row.date)) ? row.date : '' };
    if (domesticCandidate(hit) && !hits.some((existing: SearchHit): boolean => existing.url === hit.url)) {
      hits.push(hit);
    }
  });
  return hits;
}

function queryTerms(value: string, limit: number): string {
  // User fields are data, never search operators or model instructions.
  return value.replace(/[^\u4e00-\u9fffA-Za-z0-9 +#]/g, ' ').trim().slice(0, limit);
}

export function searchQueries(profile: CareerProfile, now: number): string[] {
  const date: string = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  const after: string = new Date(now - 180 * 86400000).toISOString().slice(0, 10);
  const terms: string = queryTerms(profile.major, 20) + ' ' + queryTerms(profile.interests, 30);
  return [
    terms + ' 全国 大学生 竞赛 报名 ' + date.slice(0, 4) + ' lang:zh after:' + after,
    terms + ' 国内 企业 挑战赛 招募 lang:zh after:' + after,
    queryTerms(profile.interests || profile.major, 32) + ' 腾讯 华为 阿里 大赛 ' + date.slice(0, 4) + ' lang:zh after:' + after
  ].map((query: string): string => query.slice(0, 128));
}

export function parseRecommendations(raw: string, sources: SearchHit[]): AiRecommendation[] {
  let answer: AiAnswer;
  try { answer = JSON.parse(raw) as AiAnswer; }
  catch (_) { throw new Error('AI 响应不是有效 JSON'); }
  if (answer === null || !Array.isArray(answer.recommendations)) { throw new Error('AI 未返回有效推荐结构'); }
  const items: AiRecommendation[] = [];
  answer.recommendations.slice(0, 12).forEach((row: AiSelection): void => {
    if (row === null || row.domestic !== true || typeof row.id !== 'string' ||
      typeof row.evidence !== 'string' || typeof row.reason !== 'string' || typeof row.action !== 'string') { return; }
    const source: SearchHit | undefined = sources.find((hit: SearchHit): boolean => hit.id === row.id);
    if (source === undefined || !domesticCandidate(source) || row.evidence.trim().length < 6 ||
      row.evidence.length > 400 || items.some((item: AiRecommendation): boolean => item.source.id === source.id)) { return; }
    const evidenceText: string = source.title + '\n' + source.snippet + '\n' + source.summary;
    if (!evidenceText.includes(row.evidence.trim())) { return; }
    items.push({ source: source, evidence: row.evidence.trim(), reason: row.reason.slice(0, 700),
      action: row.action.slice(0, 700) });
  });
  return items;
}

export function readAiReport(raw: string): AiReport | undefined {
  if (raw.length === 0) { return undefined; }
  if (raw.length > 160000) { throw new Error('AI 历史报告过大，原记录未覆盖'); }
  const report: AiReport = JSON.parse(raw) as AiReport;
  if (report === null || report.version !== 1 || !Number.isFinite(report.checkedAt) ||
    report.checkedAt <= 0 || report.checkedAt > 8640000000000000 - 8 * 3600000 ||
    !validProfile(report.profile) || !['web', 'catalog'].includes(report.mode) ||
    !Number.isInteger(report.searchedCount) || report.searchedCount < 0 || report.searchedCount > 30 ||
    !Array.isArray(report.queries) || report.queries.length > 3 ||
    !report.queries.every((q: string): boolean => typeof q === 'string' && q.length <= 128) ||
    !Array.isArray(report.items) || report.items.length > 12 || report.items.length > report.searchedCount ||
    (report.toolCalls !== undefined && (!Array.isArray(report.toolCalls) || report.toolCalls.length > 10 || !report.toolCalls.every((call: AiToolCall): boolean =>
      call !== null && typeof call.name === 'string' && call.name.length <= 64 && (call.count === undefined || Number.isInteger(call.count)) && (call.query === undefined || typeof call.query === 'string'))) ) ||
    !report.items.every((item: AiRecommendation): boolean =>
      item !== null && item.source !== null && typeof item.source === 'object' &&
      typeof item.source.id === 'string' && /^S([1-9]|[12][0-9]|30)$/.test(item.source.id) &&
      typeof item.source.title === 'string' && item.source.title.length <= 180 &&
      typeof item.source.snippet === 'string' && item.source.snippet.length <= 600 &&
      typeof item.source.summary === 'string' && item.source.summary.length <= 2400 &&
      typeof item.source.date === 'string' && item.source.date.length <= 40 && domesticCandidate(item.source) &&
      typeof item.evidence === 'string' && item.evidence.length >= 6 && item.evidence.length <= 400 &&
      (item.source.title + '\n' + item.source.snippet + '\n' + item.source.summary).includes(item.evidence) &&
      typeof item.reason === 'string' && item.reason.length <= 700 &&
      typeof item.action === 'string' && item.action.length <= 700)) {
    throw new Error('AI 历史报告格式异常，原记录未覆盖');
  }
  return report;
}
