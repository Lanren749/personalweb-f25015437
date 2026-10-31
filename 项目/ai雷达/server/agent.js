/* =========================================================
 * agent.js —— AI 寻源 Agent（工具调用循环，非单次 prompt）
 *
 * 定位：每次自动采集并完成「方向整理」后，Agent 逐个产业方向执行寻源：
 *   ① 从采集信号中提取企业线索（search_signals）
 *   ② 结合模型知识提出早期企业假设（web_search）
 *   ③ 逐家联网验证真实性（web_search / fetch_page），两轮验证 + 反思
 *   ④ 查有实证才入库（save_company），每家至少 1 条可点击证据来源
 *
 * 工具集（function-calling 式，模型输出 {"tool":name,"args":{}} 或 {"final":{}}）：
 *   search_signals —— 在近 N 天采集信号库中按关键词检索
 *   web_search     —— 免密钥公开检索（DuckDuckGo Lite → Bing 兜底）
 *   fetch_page     —— 抓取网页正文（证据核实）
 *   check_exists   —— 查询候选企业池是否已有该企业
 *   save_company   —— 通过验证的企业入库（附四问初稿 + 证据来源）
 *
 * 用法：
 *   node server/agent.js            # 立即执行一轮寻源（默认取热度最高的 3 个方向）
 *   node server/agent.js --days=7   # 信号检索窗口改为 7 天（默认 10）
 * 也可被 ingest.js 在采集完成后自动调用（runSourcing）。
 * ========================================================= */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('./db');
const { num, jarr } = db;
const ai = require('./ai');

/* ---------- 常量 ---------- */
const ENRICH_MODEL = process.env.AI_ENRICH_MODEL || 'deepseek-v4.1-flash';
const MAX_STEPS = 24;          // 每个方向的 Agent 最大步数（工具调用轮次）
const MAX_COMPANIES = 60;      // 仅保留技术安全上限，不按 3/5 家截断展示
const TARGET_MIN = 3;          // 每方向目标下限（不足不凑数）
const DIRS_PER_RUN = 12;       // 每轮覆盖更多方向（仍由证据决定是否入库）
const STEP_TIMEOUT = 120000;   // 单步 AI 调用超时（flash 也有推理消耗）
const DIR_DEADLINE = 12 * 60000; // 单方向总时限
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* ---------- 运行参数 ---------- */
const ARGS = { days: 10 };
for (const a of process.argv) { const m = a.match(/^--days=(\d+)$/); if (m) ARGS.days = Math.max(1, +m[1]); }

/* ---------- 小工具 ---------- */
const p2 = n => String(n).padStart(2, '0');
const nowStr = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const log = msg => console.log(`[${nowStr()}] [寻源Agent] ${msg}`);
const cut = (s, n) => String(s || '').slice(0, n);
const isoWeek = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - ys) / 86400000 + 1) / 7);
};

async function fetchText(url, { timeout = 15000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.text();
  } finally { clearTimeout(timer); }
}

const decodeEnt = s => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const stripHtml = s => decodeEnt(s).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/* URL/文本清洗：去掉模型输出可能混入的反引号、引号与首尾空白 */
const cleanUrl = u => String(u || '').trim().replace(/^[`'"\s]+/, '').replace(/[`'"\s]+$/, '');
const cleanText = s => String(s || '').replace(/^[`'"\s]+/, '').replace(/[`'"\s]+$/, '');

/* 防御式 JSON 解析（模型可能输出围栏/推理文字） */
function parseJSONLoose(text) {
  let s = String(text || '').replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

/* =========================================================
 * 免密钥公开检索：DuckDuckGo Lite 优先，Bing 兜底
 * 返回 [{title, url, snippet}]
 * ========================================================= */
function parseDdgLite(html) {
  const out = [];
  const re = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>)?/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 10) {
    let url = decodeEnt(m[1]).trim();
    const um = url.match(/uddg=([^&]+)/); // ddg 重定向链接里取真实 url
    if (um) url = decodeURIComponent(um[1]);
    const title = stripHtml(m[2]);
    const snippet = stripHtml(m[3] || '');
    if (title && /^https?:\/\//.test(url)) out.push({ title: cut(title, 120), url: cut(url, 500), snippet: cut(snippet, 200) });
  }
  return out;
}

function parseBing(html) {
  const out = [];
  const blocks = html.split('<li class="b_algo"').slice(1);
  for (const b of blocks) {
    if (out.length >= 10) break;
    const seg = b.split('</li>')[0];
    const am = seg.match(/<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!am) continue;
    const pm = seg.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const title = stripHtml(am[2]);
    if (title && /^https?:\/\//.test(am[1])) out.push({ title: cut(title, 120), url: cut(am[1], 500), snippet: cut(stripHtml(pm ? pm[1] : ''), 200) });
  }
  return out;
}

async function webSearch(query) {
  // 1) DuckDuckGo Lite（对爬虫友好）
  try {
    const html = await fetchText('https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query) + '&kl=cn-zh', { timeout: 12000 });
    const items = parseDdgLite(html);
    if (items.length) return items;
  } catch (e) { /* 落到 Bing */ }
  // 2) Bing 兜底
  const html = await fetchText('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&setlang=zh-CN&count=10', { timeout: 12000 });
  return parseBing(html);
}

/* =========================================================
 * Agent 工具实现
 * ========================================================= */
const TOOLS_DESC = [
  '可用工具（每步只调用一个）：',
  '1. search_signals  {"kw":"关键词"} —— 在近 N 天采集信号库中检索相关资讯（融资/政策/技术等），返回标题、摘要与原文链接；',
  '2. web_search      {"query":"检索词"} —— 公开网络检索，返回标题、链接与摘要；',
  '3. fetch_page      {"url":"https://..."} —— 抓取网页正文，用于核实证据内容；',
  '4. check_exists    {"name":"企业名"} —— 查询候选企业池是否已有该企业（重名即跳过）；',
  '5. save_company    {完整企业信息} —— 将通过验证的企业写入候选企业池（字段见下）。',
  'save_company 字段：{"name":"企业名","full_name":"工商全称","track":"细分赛道","region":"主要城市/地区","round":"Pre-A轮|A轮|B轮|天使轮|C轮","founded_year":2023,"description":"一句话业务描述(60字内)","website":"官网(可空)","synergy_level":"高|中|弱/待验证","evidence":[{"title":"证据标题","url":"证据链接"}],"four_questions":{"why_now":"为什么是现在","why_sector":"为什么是这个赛道","why_company":"为什么是这家公司","why_dlg":"与东浩兰生的协同"}'
].join('\n');

function agentSystem(dir) {
  return [
    '你是东浩兰生的 AI 战略投资雷达「寻源 Agent」，负责为指定产业方向寻找候选投资标的企业。',
    '你在一个工具调用循环中工作：每一步输出一个 JSON 对象，要么调用工具 {"tool":"工具名","args":{...}}，要么完成任务 {"final":{"summary":"本轮寻源总结"}}。只输出 JSON，不要输出任何其他文字。',
    '',
    `目标产业方向：${dir.name}（${dir.sub || '无副题'}）`,
    `方向要点：Why Now —— ${dir.why_now || '无'}；与东浩兰生的关联 —— ${dir.relation || '无'}；标签 —— ${db.jarr(dir.tags).join('、') || '无'}`,
    '',
    '工作方法（标准深度：两轮验证 + 反思迭代）：',
    `第一轮·线索：先用 search_signals 从近 ${ARGS.days} 天采集信号中提取本方向的企业线索（融资事件、新品发布、扩张动作等）；再用 web_search 结合你的行业知识，搜索该方向符合投资偏好的早期企业假设（如「XX赛道 A轮 融资」）；`,
    '第二轮·验证：对每个候选企业逐一验证——用 web_search / fetch_page 确认企业真实存在、业务属实、融资轮次属实；证据不足以支撑就放弃或继续检索，绝不编造；',
    '反思：如果连续验证失败（查无实证、不符偏好），反思检索词是否过宽/过窄并调整策略，宁缺毋滥。',
    '',
    '硬性规则：',
    '- 仅限中国境内未上市企业，原则上 Pre-A / A / B 轮，特别优质可放宽至 C 轮；',
    '- 不得把上市公司、大型集团或其子公司作为候选；',
    '- 每家企业至少 1 条可点击的证据来源 URL（新闻报道/融资公告/官网），save_company 前必须已验证 URL 可访问；',
    `- 每家企业入库前必须先 check_exists，重名即跳过；本方向最多入库 ${MAX_COMPANIES} 家，目标 ${TARGET_MIN}-${MAX_COMPANIES} 家，高质量标的不足时宁可少存；`,
    '- 候选必须与目标产业方向强相关，不要为了凑数放宽相关性；',
    '- 达到数量目标或确认无更多合适标的时，输出 {"final":{"summary":"..."}} 结束。',
    '',
    TOOLS_DESC
  ].join('\n');
}

/* 每方向一个 agent run */
async function runDirectionAgent(dir, savedNames, weekLabel) {
  const messages = [
    { role: 'system', content: agentSystem(dir) },
    { role: 'user', content: `请开始为产业方向「${dir.name}」寻找候选企业。今天是 ${nowStr().slice(0, 10)}。` }
  ];
  let saved = 0, steps = 0;
  const deadline = Date.now() + DIR_DEADLINE;

  while (steps < MAX_STEPS && Date.now() < deadline) {
    steps++;
    let step = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const text = await ai.chat(messages, { model: ENRICH_MODEL, temperature: 0.4, maxTokens: 3000, timeout: STEP_TIMEOUT });
        step = parseJSONLoose(text);
        if (step) break;
        messages.push({ role: 'assistant', content: cut(text, 2000) });
        messages.push({ role: 'user', content: '你的输出不是合法 JSON。请重新输出：要么 {"tool":"工具名","args":{...}}，要么 {"final":{"summary":"..."}}，只输出 JSON。' });
      } catch (e) {
        log(`方向「${dir.name}」第 ${steps} 步 AI 调用失败（第 ${attempt} 次）：${e.message}`);
      }
    }
    if (!step) { log(`方向「${dir.name}」连续失败，提前结束`); break; }

    /* final —— 任务结束 */
    if (step.final) {
      log(`方向「${dir.name}」Agent 主动收尾：${cut(step.final.summary || '', 120)}`);
      break;
    }
    const tool = String(step.tool || ''), args = step.args || {};
    let result;
    try { result = await execTool(tool, args, { dir, savedNames, weekLabel, saved }); }
    catch (e) { result = { error: e.message }; }

    if (tool === 'save_company' && result.ok) saved++;
    messages.push({ role: 'assistant', content: JSON.stringify(step) });
    messages.push({ role: 'user', content: `工具 ${tool} 返回：\n${JSON.stringify(result).slice(0, 3000)}\n\n（已入库 ${saved}/${MAX_COMPANIES} 家，第 ${steps}/${MAX_STEPS} 步。继续或收尾。）` });
    if (result && result.error) log(`方向「${dir.name}」工具 ${tool} 出错：${result.error}`);
  }
  return { saved, steps };
}

async function execTool(tool, args, ctx) {
  switch (tool) {
    case 'search_signals': {
      const kw = cut(String(args.kw || ''), 40);
      if (!kw) return { error: '缺少 kw' };
      const since = new Date(Date.now() - ARGS.days * 86400000).toISOString().slice(0, 10);
      const [rows] = await db.pool.query(
        `SELECT id, type, title, content, source_name, source_url, occurred_at FROM signals
         WHERE occurred_at >= ? AND status IN ('正常','待核实') AND (title LIKE ? OR content LIKE ?)
         ORDER BY strength DESC, occurred_at DESC LIMIT 8`,
        [since, `%${kw}%`, `%${kw}%`]);
      return { count: rows.length, signals: rows.map(r => ({ id: r.id, 类型: r.type, 标题: r.title, 摘要: cut(r.content, 160), 来源: r.source_name, 链接: r.source_url, 日期: r.occurred_at })) };
    }
    case 'web_search': {
      const query = cut(String(args.query || ''), 100);
      if (!query) return { error: '缺少 query' };
      const items = await webSearch(query);
      return { count: items.length, results: items };
    }
    case 'fetch_page': {
      const url = String(args.url || '');
      if (!/^https?:\/\//.test(url)) return { error: 'url 必须以 http(s):// 开头' };
      const text = stripHtml(await fetchText(url, { timeout: 15000 }));
      return { url, length: text.length, content: cut(text, 3500) };
    }
    case 'check_exists': {
      const name = cut(String(args.name || ''), 100);
      if (!name) return { error: '缺少 name' };
      const core = name.replace(/(科技|技术|信息|网络|智能|集团|股份|有限|责任|公司|有限公司)/g, '') || name;
      const [rows] = await db.pool.query(
        'SELECT id, name, full_name, track, round, status FROM companies WHERE name LIKE ? OR full_name LIKE ? OR name LIKE ? LIMIT 5',
        [`%${name}%`, `%${name}%`, `%${core}%`]);
      for (const r of rows) ctx.savedNames.add(r.name);
      return { exists: rows.length > 0, matches: rows.map(r => ({ id: r.id, name: r.name, track: r.track, round: r.round, status: r.status })) };
    }
    case 'save_company': return saveCompany(args, ctx);
    default: return { error: `未知工具 ${tool}` };
  }
}

/* 入库：companies + AI 六维初评 + four_questions 初稿（status='AI生成'） */
async function saveCompany(a, ctx) {
  const name = cleanText(a.name).slice(0, 100);
  if (!name) return { error: '缺少 name' };
  if (ctx.savedNames.has(name)) return { error: `「${name}」本轮已存在，跳过` };
  const ev = (Array.isArray(a.evidence) ? a.evidence : [])
    .map(x => ({ title: cut(cleanText(x && x.title), 120), url: cut(cleanUrl(x && x.url), 500) }))
    .filter(x => x.url && /^https?:\/\//.test(x.url));
  if (!ev.length) return { error: '缺少可点击证据来源（evidence 至少 1 条带 url）' };

  /* 二次查重（防 Agent 不调 check_exists） */
  const [dupe] = await db.pool.query('SELECT id FROM companies WHERE name LIKE ? OR full_name LIKE ? LIMIT 1', [`%${name}%`, `%${name}%`]);
  if (dupe.length) { ctx.savedNames.add(name); return { error: `企业池已有「${name}」（id=${dupe[0].id}），跳过` }; }

  const fq = a.four_questions || {};
  const synergy = ['高', '中', '弱/待验证'].includes(a.synergy_level) ? a.synergy_level : '弱/待验证';
  const round = cleanText(a.round) || 'A轮';

  const [ret] = await db.pool.query(
    'INSERT INTO companies (name, full_name, track, region, round, founded_year, description, website, source, direction_id, evidence, found_by, synergy_level, status, week_label) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [name, cut(cleanText(a.full_name), 200), cut(cleanText(a.track), 100), cut(cleanText(a.region), 50),
     round, a.founded_year ? Math.round(Number(a.founded_year)) || null : null,
     cut(String(a.description || ''), 800), cut(cleanUrl(a.website), 300),
     'AI 寻源 Agent', ctx.dir.id, JSON.stringify(ev), 'AI', synergy, '候选', ctx.weekLabel]);
  const companyId = ret.insertId;
  await db.pool.query(
    'INSERT INTO four_questions (company_id, why_now, why_sector, why_company, why_dlg, sources, status, updated_by) VALUES (?,?,?,?,?,?,?,?)',
    [companyId, cut(String(fq.why_now || ''), 500), cut(String(fq.why_sector || ''), 500),
     cut(String(fq.why_company || ''), 500), cut(String(fq.why_dlg || ''), 500),
     JSON.stringify(ev), 'AI生成', 'agent']);

  /* AI 六维初评（失败不阻断入库，可人工补评） */
  let scored = false;
  try { await aiScore(companyId, { name, track: a.track, region: a.region, round, description: a.description }, ev); scored = true; }
  catch (e) { log(`「${name}」AI 初评失败（可人工补评）：${e.message}`); }

  ctx.savedNames.add(name);
  log(`方向「${ctx.dir.name}」入库：${name}（${round}，证据 ${ev.length} 条${scored ? '，已初评' : ''}）`);
  return { ok: true, id: companyId, name, evidence_count: ev.length, scored };
}

/* AI 六维初评：依据证据对各评分维度打分并写 company_scores */
async function aiScore(companyId, c, ev) {
  const [dims] = await db.pool.query('SELECT id, name, weight, description FROM score_dimensions WHERE enabled=1 ORDER BY sort');
  if (!dims.length) return;
  const payload = {
    企业: c.name, 赛道: c.track || '', 轮次: c.round || '', 地区: c.region || '', 业务描述: c.description || '',
    证据材料: ev.map(x => `${x.title} ${x.url}`).join('；'),
    评分维度: dims.map(d => ({ 名称: d.name, 权重: num(d.weight) + '%', 说明: d.description }))
  };
  const sys = '你是产业投资的评分助理。依据「证据材料」对企业逐维度评分（0-100）并给一句评分依据（40字内），证据不足时保守给分。严格只输出 JSON：{"scores":[{"name":"维度名称","score":75,"rationale":"..."}]}，必须覆盖全部给定维度，不得虚构证据。';
  const out = await ai.chatJSON(sys, JSON.stringify(payload), { model: ENRICH_MODEL, temperature: 0.3, maxTokens: 2000, timeout: 120000 });
  const byName = {};
  for (const s of (out && out.scores) || []) if (s && s.name) byName[String(s.name).trim()] = s;
  let n = 0;
  for (const d of dims) {
    const s = byName[d.name]; if (!s || s.score == null) continue;
    const score = Math.max(0, Math.min(100, Math.round(Number(s.score) || 0)));
    await db.pool.query(
      'INSERT INTO company_scores (company_id, dimension_id, score, rationale) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE score=VALUES(score), rationale=VALUES(rationale)',
      [companyId, d.id, score, cut(String(s.rationale || ''), 490)]);
    n++;
  }
  log(`「${c.name}」AI 初评完成（${n}/${dims.length} 维）`);
  return n;
}

/* 单企业补评入口（也可命令行一次性补评存量企业） */
async function scoreCompanyById(companyId) {
  const [rows] = await db.pool.query('SELECT id, name, track, region, round, description, evidence FROM companies WHERE id=?', [companyId]);
  if (!rows.length) throw new Error('企业不存在');
  const c = rows[0];
  return aiScore(c.id, c, jarr(c.evidence));
}

/* =========================================================
 * 主入口：一轮寻源 = 取热度最高的 N 个方向，逐个跑 Agent
 * ========================================================= */
async function runSourcing({ days } = {}) {
  if (days) ARGS.days = days;
  const weekLabel = `第 ${isoWeek()} 周`;
  log(`寻源开始（模型=${ENRICH_MODEL} 信号窗口=${ARGS.days}天 方向数=${DIRS_PER_RUN}）`);

  const [dirs] = await db.pool.query(
    "SELECT id, name, sub, category, heat, why_now, relation, tags FROM directions WHERE status IN ('跟踪中','观察') ORDER BY heat DESC LIMIT ?", [DIRS_PER_RUN]);
  if (!dirs.length) { log('无可用产业方向，结束'); return { saved: 0, dirs: 0 }; }

  const [exist] = await db.pool.query('SELECT name, full_name FROM companies');
  const savedNames = new Set(exist.flatMap(r => [r.name, r.full_name].filter(Boolean)));

  let total = 0, dirDone = 0;
  for (const dir of dirs) {
    try {
      log(`── 方向「${dir.name}」（heat=${dir.heat}）开始 ──`);
      const r = await runDirectionAgent(dir, savedNames, weekLabel);
      total += r.saved; dirDone++;
      await db.pool.query('INSERT INTO activity_logs (user_id, module, action, detail) VALUES (NULL,?,?,?)',
        ['AI 寻源', 'Agent 寻源·' + dir.name, `步数 ${r.steps}，入库候选企业 ${r.saved} 家（信号窗口 ${ARGS.days} 天）`]);
      log(`── 方向「${dir.name}」完成：入库 ${r.saved} 家 / ${r.steps} 步 ──`);
    } catch (e) {
      log(`方向「${dir.name}」寻源异常（不影响其他方向）：${e.message}`);
    }
  }

  await db.pool.query('INSERT INTO activity_logs (user_id, module, action, detail) VALUES (NULL,?,?,?)',
    ['AI 寻源', 'Agent 自动寻源完成', `处理 ${dirDone}/${dirs.length} 个方向，共入库候选企业 ${total} 家`]);
  log(`本轮寻源结束：${dirDone} 个方向 / 共入库 ${total} 家`);
  return { saved: total, dirs: dirDone };
}

if (require.main === module) {
  runSourcing()
    .catch(e => { console.error(`[${nowStr()}] [寻源异常]`, e && (e.stack || e.message)); process.exitCode = 1; })
    .finally(() => db.pool.end().catch(() => {}));
}

module.exports = { runSourcing, scoreCompanyById };
