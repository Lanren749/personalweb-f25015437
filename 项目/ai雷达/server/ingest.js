/* =========================================================
 * ingest.js —— 真实数据定时采集脚本（方案一：RSS + AI 清洗）
 *
 * 流程：信息源抓取（RSS / 巨潮公告 API）→ 日期窗口过滤 → URL/标题去重
 *      → AI 批量清洗打分（快模型）→ signals 入库（待核实）
 *      → AI 方向整理（刷新 directions 主表 + 沉淀「观察」新方向）
 *      → （周五或 --weekly）生成本周周报草稿
 *
 * 用法：
 *   node server/ingest.js              # 日常采集（入库后自动做方向整理 + AI 寻源；周五自动加做周报草稿）
 *   node server/ingest.js --digest     # 跳过采集，仅对现有数据重跑一次方向整理
 *   node server/ingest.js --source     # 跳过采集，仅重跑一次 AI 寻源 Agent（从产业方向找候选企业）
 *   node server/ingest.js --dry        # 演练模式：抓取 + AI 清洗但不入库
 *   node server/ingest.js --weekly     # 采集并强制生成本周周报草稿
 *   node server/ingest.js --limit=6    # 每个信息源最多取 6 条（默认 30）
 *
 * crontab 建议（防重入 + 日志）：
 *   20 7 * * * flock -xn /tmp/radar-ingest.lock -c 'cd /path/to/radar-x && node server/ingest.js >> logs/ingest.log 2>&1'
 * ========================================================= */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('./db');
const ai = require('./ai');
const { runSourcing } = require('./agent');

/* ---------- 运行参数 ---------- */
const ARGS = { dry: process.argv.includes('--dry'), weekly: process.argv.includes('--weekly'), digestOnly: process.argv.includes('--digest'), sourceOnly: process.argv.includes('--source'), limit: 30 };
for (const a of process.argv) { const m = a.match(/^--limit=(\d+)$/); if (m) ARGS.limit = Math.max(1, +m[1]); }

/* ---------- 常量 ---------- */
const ENRICH_MODEL = process.env.AI_ENRICH_MODEL || 'deepseek-v4.1-flash'; // 清洗用快模型（便宜、JSON 稳定）
const DAYS_WINDOW = 10;   // 只保留近 N 天的资讯
const DIGEST_DAYS = 7;    // 方向整理回看的信号窗口（天）
const BATCH_SIZE = 8;    // AI 清洗批量（flash 也有推理消耗，批量过大易导致 JSON 截断）
const SIGNAL_TYPES = ['政策', '融资', '技术', '资本', '招聘', '专利'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* ---------- 信息源（可插拔：新增源在 SOURCES 里加一项即可） ---------- */
const SOURCES = [
  { id: 'tmtpost', name: '钛媒体', type: 'rss', url: 'https://www.tmtpost.com/rss' },
  { id: 'leiphone', name: '雷锋网', type: 'rss', url: 'https://www.leiphone.com/feed' },
  { id: '36kr', name: '36氪', type: 'rss', url: 'https://36kr.com/feed' },
  {
    id: 'cninfo', name: '巨潮资讯（上市公司公告）', type: 'cninfo',
    keywords: ['人力资源', '灵活用工', '养老', '机器人', '人工智能', '职业教育', '碳中和', '教育', '招聘']
  }
];

/* ---------- 工具函数 ---------- */
const p2 = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const nowStr = () => { const d = new Date(); return `${fmtDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const log = msg => console.log(`[${nowStr()}] ${msg}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cut = (s, n) => String(s || '').slice(0, n);
const clampInt = (v, lo, hi, dft) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dft; };

function decodeEnt(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
const stripHtml = s => decodeEnt(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* URL/标题归一化（用于跨源去重） */
function normUrl(u) {
  if (!u) return '';
  return String(u).trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '')
    .replace(/[?#].*$/, '').replace(/\/+$/, '');
}
const normTitle = t => String(t || '').replace(/\s+/g, '').toLowerCase();

/* 本周一 ~ 周日 */
function weekRange(d = new Date()) {
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (day - 1));
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return [fmtDate(mon), fmtDate(sun)];
}
/* ISO 周号 */
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - ys) / 86400000 + 1) / 7);
}

async function fetchText(url, { timeout = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally { clearTimeout(timer); }
}

/* ---------- RSS 解析（零依赖正则版，兼容 RSS2.0 / Atom） ---------- */
function pickTag(seg, tag) {
  const m = seg.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  let v = m[1].trim();
  const c = v.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (c) v = c[1].trim();
  return decodeEnt(v);
}
function pickLink(seg) {
  const a = seg.match(/<link[^>]*href=["']([^"']+)["']/i); // Atom
  if (a) return a[1].trim();
  return pickTag(seg, 'link');
}
function parseRss(xml) {
  const out = [];
  let blocks = xml.split(/<item[\s>]/i).slice(1);
  if (!blocks.length) blocks = xml.split(/<entry[\s>]/i).slice(1);
  for (const b of blocks) {
    const seg = b.split(/<\/(item|entry)>/i)[0];
    const title = stripHtml(pickTag(seg, 'title'));
    if (!title) continue;
    const dateStr = pickTag(seg, 'pubDate') || pickTag(seg, 'published') || pickTag(seg, 'updated') || pickTag(seg, 'dc:date');
    const desc = pickTag(seg, 'description') || pickTag(seg, 'summary') || pickTag(seg, 'content:encoded');
    const ts = dateStr ? new Date(dateStr) : null;
    out.push({ title, link: pickLink(seg), desc: stripHtml(desc), date: ts && !isNaN(ts) ? ts : null });
  }
  return out;
}

/* ---------- 信息源抓取 ---------- */
async function fetchRss(s) {
  const xml = await fetchText(s.url);
  return parseRss(xml).map(it => ({
    src: s.id, source: s.name, title: it.title, content: it.desc || it.title,
    url: it.link || '', date: it.date
  }));
}

async function fetchCninfo(s) {
  const out = [];
  const edate = fmtDate(new Date());
  const sdate = fmtDate(new Date(Date.now() - 7 * 86400000));
  for (const k of s.keywords) {
    try {
      const u = 'https://www.cninfo.com.cn/new/fulltextSearch/full'
        + `?searchkey=${encodeURIComponent(k)}&sdate=${sdate}&edate=${edate}`
        + '&isfulltext=false&sortName=pubdate&sortType=desc&pageNum=1&pageSize=8';
      const txt = await fetchText(u, { headers: { Accept: 'application/json', Referer: 'https://www.cninfo.com.cn/' } });
      const j = JSON.parse(txt);
      for (const a of (j.announcements || [])) {
        const title = String(a.announcementTitle || '').replace(/<\/?em>/g, '').trim();
        if (!title) continue;
        const date = a.announcementTime ? new Date(+a.announcementTime) : null;
        out.push({
          src: s.id,
          source: (a.secName ? a.secName + ' · ' : '') + '巨潮资讯公告',
          title, content: title, // 公告只有标题可提取，AI 仅基于标题改写摘要
          url: a.adjunctUrl ? 'https://static.cninfo.com.cn/' + a.adjunctUrl : '',
          date: date && !isNaN(date) ? date : null
        });
      }
    } catch (e) { log(`巨潮关键词「${k}」抓取失败：${e.message}`); }
    await sleep(400); // 对源保持礼貌间隔
  }
  return out;
}

async function collectAll() {
  const jobs = [];
  for (const s of SOURCES) jobs.push({ s, p: s.type === 'rss' ? fetchRss(s) : fetchCninfo(s) });
  const items = [];
  for (const { s, p } of jobs) {
    try { const r = await p; log(`源 ${s.name}：抓到 ${r.length} 条`); items.push(...r); }
    catch (e) { log(`源 ${s.name} 抓取失败：${e.message}`); }
  }
  return items;
}

/* ---------- AI 批量清洗 ---------- */
function cleanSystem(dirText) {
  return [
    '你是产业投资研究团队的资讯清洗助手。输入是一批带编号的公开资讯（JSON 数组，字段：i 编号、title 标题、content 摘要、source 来源、date 日期）。',
    '请逐条判断是否值得作为「产业弱信号」入库，并完成分类与打分。',
    'keep 规则：仅保留与以下产业相关的实质信息——人工智能/HR科技、银发经济/康养、机器人/智能装备、绿色低碳/双碳、数字医疗/健康管理，以及人力资源服务业（招聘、灵活用工、职业教育）本身；保留的信号类型限于政策、融资、技术、资本、招聘、专利六类（融资=一级市场投融资事件；资本=上市公司资本运作/财报 AI 投入/产业基金设立；技术=技术进展/产品发布/开源）。广告软文、娱乐八卦、个股涨跌点评、与上述产业无关的杂闻 keep=false。',
    'type 必须是：政策/融资/技术/资本/招聘/专利 之一。',
    `direction 从方向表中选最匹配的编号（${dirText}），都不匹配填 0。`,
    'title：重写为客观简洁的标题（不超过 60 字，保留关键主体与数字，去掉标题党）。',
    'content：80~200 字客观摘要，只能基于给定信息改写，严禁编造给定信息之外的事实（如具体金额、公司名）。',
    'confidence：0-100。官方文件/监管公告/上市公司正式公告 85~95；主流科技或财经媒体原创报道 60~80；转载、单一来源、自媒体 30~55；传闻 20~40。',
    'strength：0-100，对产业趋势的影响力（金额越大、政策层级越高、覆盖面越广越强）。',
    'note：不超过 60 字的一句话判断理由。',
    '只输出一个合法 JSON 对象：{"items":[{"i":1,"keep":true,"type":"技术","direction":1,"title":"...","content":"...","confidence":70,"strength":65,"note":"..."}]}，编号 i 与输入一一对应，所有输入条目都必须出现在 items 中。'
  ].join('\n');
}

async function aiCleanBatch(batch, dirText) {
  const r = await ai.chatJSON(cleanSystem(dirText), JSON.stringify(batch),
    { model: ENRICH_MODEL, temperature: 0.2, maxTokens: 8000 });
  return Array.isArray(r.items) ? r.items : [];
}

/* AI 输出 → signals 行 */
function toRow(item, aiItem, validDirIds) {
  if (!aiItem || aiItem.keep !== true) return null;
  if (!SIGNAL_TYPES.includes(aiItem.type)) return null;
  const title = String(aiItem.title || '').trim();
  const content = String(aiItem.content || '').trim();
  if (!title || !content) return null;
  const conf = clampInt(aiItem.confidence, 0, 100, 60);
  const dirId = validDirIds.has(+aiItem.direction) ? +aiItem.direction : null;
  const occurred = item.date && !isNaN(item.date) ? fmtDate(item.date) : fmtDate(new Date());
  const note = cut(String(aiItem.note || '').trim(), 100);
  return {
    direction_id: dirId, type: aiItem.type,
    title: cut(title, 200), content: cut(content, 800),
    source_name: cut(item.source || '', 120), source_url: cut(item.url || '', 500),
    confidence: conf, strength: clampInt(aiItem.strength, 0, 100, 50),
    occurred_at: occurred,
    status: conf <= 40 ? '转参考' : '待核实',
    ai_note: `【AI 采集 · ${ENRICH_MODEL}】${note}`
  };
}

/* ---------- AI 方向整理（采集入库后刷新产业方向看板） ---------- */
function digestSystem() {
  return [
    '你是东浩兰生的 AI 战略投资雷达智能体，负责在每日自动采集入库后整理「产业方向」看板。',
    '输入 JSON 包含：现有方向（id、名称、副题、状态、当前热度、why_now、relation、risks、tags）与近 7 天有效信号（id、类型、标题、摘要、强度、置信度、归属方向 id）。',
    '任务一（updates）：结合近 7 天信号刷新每个现有方向：',
    '  heat（0-100 整数）：有强信号支撑的调高（最多 +20），近 7 天无信号的逐渐降温（-5~-15，不低于 20）；',
    '  why_now（1-2 句，须基于近 7 天信号的具体事实说明「为什么是现在」）；',
    '  relation（1-2 句，与东浩兰生人力资源服务主业的潜在关联与切入点）；',
    '  risks（2-4 条字符串）、tags（3-6 个字符串）。',
    '  近 7 天完全没有信号的现有方向：仅下调 heat，why_now/relation/risks/tags 原样返回。',
    '任务二（new_directions）：仅当近 7 天信号集中出现现有方向都无法覆盖、且具备产业趋势意义的新主题时，才提出 0-3 个新方向（heat 40-60），evidence 填支撑它的信号 id 数组；拿不准就不要新增，宁缺毋滥。',
    '约束：所有文案必须严格基于给定信号改写，禁止编造信号之外的金额、公司名、政策名；「暂停」状态的方向不要出现在输出中。',
    '只输出一个合法 JSON 对象：{"updates":[{"id":1,"heat":72,"why_now":"...","relation":"...","risks":["..."],"tags":["..."]}],"new_directions":[{"name":"...","sub":"...","category":"...","heat":50,"why_now":"...","relation":"...","risks":["..."],"tags":["..."],"evidence":[123,124]}]}'
  ].join('\n');
}

async function aiDigestDirections() {
  const since = fmtDate(new Date(Date.now() - DIGEST_DAYS * 86400000));
  const [dirs] = await db.pool.query(
    "SELECT id, name, sub, category, status, heat, why_now, relation, risks, tags FROM directions WHERE status<>'暂停' ORDER BY heat DESC");
  const [sigs] = await db.pool.query(
    `SELECT id, direction_id, type, title, content, strength, confidence, status, occurred_at
     FROM signals WHERE occurred_at >= ? AND status IN ('正常','待核实') ORDER BY strength DESC LIMIT 60`, [since]);
  if (!sigs.length) { log(`近 ${DIGEST_DAYS} 天无有效信号，跳过方向整理`); return; }

  const payload = JSON.stringify({
    今日: fmtDate(new Date()),
    现有方向: dirs.map(d => ({ id: d.id, 名称: d.name, 副题: d.sub, 分类: d.category, 状态: d.status, 当前热度: d.heat, why_now: d.why_now, relation: d.relation, risks: db.jarr(d.risks), tags: db.jarr(d.tags) })),
    近7天信号: sigs.map(s => ({ id: s.id, 类型: s.type, 标题: s.title, 摘要: cut(s.content, 160), 强度: s.strength, 置信度: s.confidence, 状态: s.status, 归属方向: s.direction_id || null }))
  });

  log(`AI 方向整理：基于近 ${DIGEST_DAYS} 天 ${sigs.length} 条信号与 ${dirs.length} 个方向…`);
  let out = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { out = await ai.chatJSON(digestSystem(), payload, { temperature: 0.4, maxTokens: 8000, timeout: 300000 }); break; }
    catch (e) { log(`方向整理 AI 调用失败（第 ${attempt} 次）：${e.message}`); }
  }
  if (!out) throw new Error('AI 两次调用失败，本轮方向整理中止');

  /* 应用 updates：直接更新 directions 主表 */
  const dirIds = new Set(dirs.map(d => d.id));
  let upCnt = 0;
  for (const u of (Array.isArray(out.updates) ? out.updates : [])) {
    const id = +u.id;
    if (!dirIds.has(id)) continue;
    const sets = [], vals = [];
    const heat = u.heat === undefined ? null : clampInt(u.heat, 1, 100, null);
    if (heat !== null) { sets.push('heat=?'); vals.push(heat); }
    if (u.why_now) { sets.push('why_now=?'); vals.push(cut(String(u.why_now), 500)); }
    if (u.relation) { sets.push('relation=?'); vals.push(cut(String(u.relation), 500)); }
    if (Array.isArray(u.risks) && u.risks.length) sets.push('risks=?'), vals.push(JSON.stringify(u.risks.slice(0, 6).map(x => cut(String(x), 120))));
    if (Array.isArray(u.tags) && u.tags.length) sets.push('tags=?'), vals.push(JSON.stringify(u.tags.slice(0, 8).map(x => cut(String(x), 30))));
    if (!sets.length) continue;
    vals.push(id);
    await db.pool.query(`UPDATE directions SET ${sets.join(',')} WHERE id=?`, vals);
    upCnt++;
  }

  /* 沉淀新方向：「观察」状态，等待人工复核 */
  let newCnt = 0, backfilled = 0;
  for (const n of (Array.isArray(out.new_directions) ? out.new_directions : []).slice(0, 3)) {
    const name = String(n.name || '').trim();
    if (!name) continue;
    const [ret] = await db.pool.query(
      'INSERT INTO directions (name, sub, category, status, heat, why_now, relation, risks, tags) VALUES (?,?,?,?,?,?,?,?,?)',
      [cut(name, 120), cut(String(n.sub || ''), 120), cut(String(n.category || ''), 50), '观察',
       clampInt(n.heat, 1, 100, 50), cut(String(n.why_now || ''), 500), cut(String(n.relation || ''), 500),
       JSON.stringify(Array.isArray(n.risks) ? n.risks.slice(0, 6).map(x => cut(String(x), 120)) : []),
       JSON.stringify(Array.isArray(n.tags) ? n.tags.slice(0, 8).map(x => cut(String(x), 30)) : [])]);
    newCnt++;
    const ev = (Array.isArray(n.evidence) ? n.evidence : []).map(x => +x).filter(Boolean);
    if (ev.length && ret.insertId) {
      const [r2] = await db.pool.query(
        `UPDATE signals SET direction_id=? WHERE id IN (${ev.map(() => '?').join(',')}) AND direction_id IS NULL`,
        [ret.insertId, ...ev]);
      backfilled += r2.affectedRows;
    }
  }

  await db.pool.query('INSERT INTO activity_logs (user_id, module, action, detail) VALUES (NULL,?,?,?)',
    ['方向整理', 'AI 整理产业方向',
     `基于近 ${DIGEST_DAYS} 天 ${sigs.length} 条信号：更新 ${upCnt} 个方向，新增观察方向 ${newCnt} 个，回填信号 ${backfilled} 条`]);
  log(`方向整理完成：更新 ${upCnt} 个方向 / 新增观察 ${newCnt} 个 / 回填信号 ${backfilled} 条`);
}

/* ---------- 周报草稿（周五或 --weekly） ---------- */
async function maybeWeekly() {
  const isFriday = new Date().getDay() === 5;
  if (!isFriday && !ARGS.weekly) return;
  const [pStart, pEnd] = weekRange();
  const weekLabel = `第 ${isoWeek()} 周`;

  const [ex] = await db.pool.query('SELECT id FROM reports WHERE week_label=?', [weekLabel]);
  if (ex.length) { log(`周报「${weekLabel}」已存在，跳过生成`); return; }

  const [cnt] = await db.pool.query(
    "SELECT COUNT(*) c FROM signals WHERE occurred_at BETWEEN ? AND ? AND status<>'排除'", [pStart, pEnd]);
  const scanned = cnt[0].c;
  if (!scanned) { log(`当期（${pStart}~${pEnd}）无信号，跳过周报`); return; }

  const [sigs] = await db.pool.query(
    `SELECT s.title, s.type, s.strength, s.status, d.name AS direction_name
     FROM signals s LEFT JOIN directions d ON d.id=s.direction_id
     WHERE s.occurred_at BETWEEN ? AND ? ORDER BY s.strength DESC LIMIT 15`, [pStart, pEnd]);
  const [dirs] = await db.pool.query(
    "SELECT name, sub, heat FROM directions WHERE status='跟踪中' ORDER BY heat DESC LIMIT 8");

  log(`生成本周周报草稿「${weekLabel}」（${pStart}~${pEnd}，${scanned} 条信号）…`);
  const summary = await ai.chat(
    [{ role: 'system', content: '你是东浩兰生的 AI 战略投资雷达智能体。基于给定的周报数据写一段「本期摘要」，供投资负责人快速掌握本期要点。要求：120-200 字、2-4 句、先总后分、点出最值得关注的 1-2 个方向与关键信号、提到候选企业情况、末尾提示信息需人工核实。只输出摘要正文，不要标题和多余格式。' },
     { role: 'user', content: JSON.stringify({ 周次: weekLabel, 周期: pStart + ' ~ ' + pEnd, 扫描信息数: scanned, 当期方向: dirs, 当期信号: sigs, 本期候选企业: [] }) }],
    { temperature: 0.5, maxTokens: 8000 });

  await db.pool.query(
    'INSERT INTO reports (week_label, period_start, period_end, status, summary, note, scanned, created_by) VALUES (?,?,?,?,?,?,?,?)',
    [weekLabel, pStart, pEnd, '草稿', summary, '系统自动生成，待人工复核', scanned, 'system']);
  await db.pool.query('INSERT INTO activity_logs (user_id, module, action, detail) VALUES (NULL,?,?,?)',
    ['周报', '自动生成周报草稿', `${weekLabel}（${pStart}~${pEnd}）已生成，当期信号 ${scanned} 条`]);
  log(`周报草稿已写入（${weekLabel}）`);
}

/* ---------- 主流程 ---------- */
async function main() {
  fs.mkdirSync(path.join(__dirname, '..', 'logs'), { recursive: true });
  log(`采集开始（dry=${ARGS.dry} weekly=${ARGS.weekly} digest=${ARGS.digestOnly} limit=${ARGS.limit} 清洗模型=${ENRICH_MODEL}）`);

  /* 0. 仅重跑方向整理（跳过采集） */
  if (ARGS.digestOnly) { await aiDigestDirections(); return; }

  /* 0.1 仅重跑 AI 寻源（跳过采集） */
  if (ARGS.sourceOnly) { await runSourcing(); return; }

  /* 1. 方向表（供 AI 匹配编号） */
  const [dirs] = await db.pool.query('SELECT id, name FROM directions ORDER BY id');
  const validDirIds = new Set(dirs.map(d => d.id));
  const dirText = dirs.map(d => `${d.id}=${d.name}`).join('；');

  /* 2. 抓取 + 日期窗口 + 每源限额 */
  const raw = await collectAll();
  const minTs = Date.now() - DAYS_WINDOW * 86400000;
  const perSrc = {};
  const picked = [];
  for (const it of raw) {
    if (!it.title) continue;
    if (it.date && it.date.getTime() < minTs) continue;
    perSrc[it.src] = (perSrc[it.src] || 0) + 1;
    if (perSrc[it.src] > ARGS.limit) continue;
    picked.push(it);
  }
  log(`日期窗口过滤后：${picked.length} 条（原始 ${raw.length} 条）`);
  if (!picked.length) { log('无新资讯，结束'); await maybeWeekly(); return; }

  /* 3. 去重：查库近 90 天的 URL 与标题 + 本轮内存去重 */
  const [dupe] = await db.pool.query(
    'SELECT source_url, title FROM signals WHERE occurred_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)');
  const urlSet = new Set(dupe.map(r => normUrl(r.source_url)).filter(Boolean));
  const titleSet = new Set(dupe.map(r => normTitle(r.title)));
  const fresh = [];
  for (const it of picked) {
    const u = normUrl(it.url), t = normTitle(it.title);
    if (u && urlSet.has(u)) continue;
    if (t && titleSet.has(t)) continue;
    if (u) urlSet.add(u);
    if (t) titleSet.add(t);
    fresh.push(it);
  }
  log(`去重后待清洗：${fresh.length} 条`);

  /* 4. AI 批量清洗（失败重试 1 次） */
  const rows = [];
  for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
    const slice = fresh.slice(i, i + BATCH_SIZE);
    const batch = slice.map((it, k) => ({
      i: k + 1, title: cut(it.title, 120), content: cut(it.content, 500),
      source: it.source, date: it.date ? fmtDate(it.date) : ''
    }));
    let items = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { items = await aiCleanBatch(batch, dirText); break; }
      catch (e) { log(`AI 清洗批次失败（第 ${attempt} 次）：${e.message}`); }
    }
    if (!items) { log(`该批次 ${slice.length} 条放弃（AI 两次失败）`); continue; }
    for (const r of items) {
      const srcItem = slice[(+r.i || 0) - 1];
      if (!srcItem) continue;
      const row = toRow(srcItem, r, validDirIds);
      if (!row) continue;
      const t = normTitle(row.title);
      if (t && titleSet.has(t)) continue;
      if (t) titleSet.add(t);
      rows.push(row);
    }
    log(`批次 ${Math.floor(i / BATCH_SIZE) + 1}：AI 保留累计 ${rows.length} 条`);
  }

  /* 5. 入库 / 演练输出 */
  if (ARGS.dry) {
    console.log(`\n===== 演练模式：共 ${rows.length} 条待入库（未写入） =====`);
    for (const r of rows) {
      console.log(`  [${r.type}] 置信${r.confidence}/强度${r.strength}/${r.status} ${r.title}`);
      console.log(`          ← ${r.source_name} | ${r.occurred_at} | ${r.source_url}`);
    }
    log('演练结束（未写入数据库）');
    return;
  }

  let inserted = 0, refCount = 0;
  for (const r of rows) {
    try {
      await db.pool.query(
        'INSERT INTO signals (direction_id, type, title, content, source_name, source_url, confidence, strength, occurred_at, status, verify_note, ai_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [r.direction_id, r.type, r.title, r.content, r.source_name, r.source_url,
         r.confidence, r.strength, r.occurred_at, r.status, '', r.ai_note]);
      inserted++;
      if (r.status === '转参考') refCount++;
    } catch (e) { log(`入库失败：${e.message} —— ${r.title.slice(0, 30)}`); }
  }
  await db.pool.query('INSERT INTO activity_logs (user_id, module, action, detail) VALUES (NULL,?,?,?)',
    ['采集', '定时采集入库',
     `抓取 ${raw.length} 条 / 窗口内 ${picked.length} 条 / 去重后 ${fresh.length} 条 / 入库 ${inserted} 条（转参考 ${refCount} 条）`]);
  log(`采集完成：入库 ${inserted} 条（转参考 ${refCount} 条）`);

  /* 5.5 AI 方向整理（入库成功后刷新方向看板；失败不影响采集主流程） */
  if (inserted > 0) {
    try { await aiDigestDirections(); }
    catch (e) { log(`方向整理失败（不影响采集主流程）：${e.message}`); }
  } else {
    log('本轮无新增信号，跳过方向整理');
  }

  /* 5.6 AI 寻源 Agent（方向整理后从产业方向寻找候选企业；失败不影响采集主流程） */
  try { await runSourcing(); }
  catch (e) { log(`AI 寻源失败（不影响采集主流程）：${e.message}`); }

  /* 6. 周报（周五自动 / --weekly 强制） */
  await maybeWeekly();
}

main()
  .catch(e => { console.error(`[${nowStr()}] [采集异常]`, e && (e.stack || e.message)); process.exitCode = 1; })
  .finally(() => db.pool.end().catch(() => {}));
