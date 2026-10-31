'use strict';

/*
 * 免费公开信息源配置，供线索和趋势采集使用，不等同于付费投融资数据库。
 * 2026-10-21 补充免费人力科技融资、会展动态源，仅采集公开摘要和链接。
 * API 文档：
 * https://info.arxiv.org/help/api/user-manual.html
 * https://api.crossref.org/swagger-ui/index.html
 */
const SOURCES = [
  { id: 'leiphone-rss', name: '雷锋网（科技资讯）', url: 'https://www.leiphone.com/feed', type: 'rss', sectors: ['人工智能', '智能装备', '数字化'], maxItems: 30 },
  { id: 'tmtpost-rss', name: '钛媒体（科技与产业）', url: 'https://www.tmtpost.com/rss', type: 'rss', sectors: ['人工智能', '产业数字化', '资本'], maxItems: 30 },
  { id: 'hrtech-funding-rss', name: 'HR Tech Feed（融资线索）', url: 'https://hrtechfeed.com/?s=funding&feed=rss2', type: 'rss', sectors: ['人力资源', 'HR科技', '融资'], maxItems: 35 },
  { id: 'hrtech-raises-rss', name: 'HR Tech Feed（融资补充）', url: 'https://hrtechfeed.com/?s=raises&feed=rss2', type: 'rss', sectors: ['人力资源', 'HR科技', '融资'], maxItems: 35 },
  { id: 'eventindustry-rss', name: 'Event Industry News（会展动态）', url: 'https://www.eventindustrynews.com/feed', type: 'rss', sectors: ['会展', '活动科技'], maxItems: 35 },
  { id: 'workday-rss', name: 'Workday 官方新闻室', url: 'https://newsroom.workday.com/press-releases?pagetemplate=rss', type: 'rss', sectors: ['人力资源', 'HR科技'], maxItems: 25 },
  { id: 'manpower-rss', name: 'ManpowerGroup 官方投资者关系', url: 'https://investor.manpowergroup.com/rss/news-releases.xml', type: 'rss', sectors: ['人力资源', '灵活用工'], maxItems: 25 },
  { id: 'ufi-rss', name: 'UFI 国际展览业协会', url: 'https://www.ufi.org/feed/', type: 'rss', sectors: ['会展', '赛事'], maxItems: 25 },
  { id: 'arxiv-api', name: 'arXiv 公开论文 API', url: 'https://export.arxiv.org/api/query?search_query=all:recruitment%20OR%20all:%22human%20resources%22%20OR%20all:%22event%20management%22&sortBy=submittedDate&sortOrder=descending&max_results=40', type: 'atom', sectors: ['人力资源', '会展', '人工智能'], maxItems: 35 },
  { id: 'crossref-api', name: 'Crossref 公开研究 API', url: 'https://api.crossref.org/works?query=artificial%20intelligence%20recruitment%20conference%20events&sort=published&order=desc&rows=40', type: 'crossref', sectors: ['人力资源', '会展', '人工智能'], maxItems: 35 }
];
module.exports = { SOURCES };
