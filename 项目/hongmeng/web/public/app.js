const $ = selector => document.querySelector(selector);
const view = $('#view'), modal = $('#modal'), content = $('#modal-content');
const state = { page: 'discover', query: '', filter: '全部', catalog: { items: [], reports: [], sources: [] },
  session: {}, personal: null, report: null, busy: false, saving: false,
  chat: { messages: [], busy: false, error: '', controller: null } };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icons = {
  discover: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  favorites: '<path d="M6 4h12v17l-6-4-6 4Z"/>',
  plans: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 3h6v4H9zM9 12h6M9 16h4"/>',
  ai: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
  preferences: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>'
};
const icon = name => '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.discover) + '</svg>';
const date = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '尚未更新';
const status = item => item.kind === 'announcement' ? '官方公告 · 非报名状态' : Date.now() >= item.endsAt ? '已结束 · 可作练习参考' : Date.now() >= item.startsAt ? '正在进行' : '尚未开赛 · 报名规则见官网';
const safeLink = url => /^https:\/\/[a-z0-9.-]+(?:\/[^\s<>"'\\]*)?$/i.test(url || '');
const external = (url, label, className = 'button secondary small') => safeLink(url) ? '<a class="' + className + '" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>' : '<span class="muted">链接待核实</span>';
const header = (eyebrow, title, description) => '<div class="intro"><div><p class="eyebrow">' + eyebrow + '</p><h1>' + title + '</h1><p>' + description + '</p></div></div>';
const empty = (title, description) => '<div class="empty"><h3>' + esc(title) + '</h3><p>' + esc(description) + '</p></div>';
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 5000); }
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(state.session.csrf ? { 'X-CSRF-Token': state.session.csrf } : {}) };
  const response = await fetch('/api/' + path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || '请求失败'); error.status = response.status; throw error; }
  return data;
}
function allItems() {
  const result = [...state.catalog.items];
  for (const item of state.personal?.savedItems || []) if (!result.some(x => x.id === item.id)) result.push(item);
  return result;
}
function navigation() {
  const tabs = [['discover', '发现比赛'], ['favorites', '我的收藏'], ['plans', '参赛计划'], ['ai', 'AI 找比赛'], ['preferences', '我的偏好']];
  $('#navigation').innerHTML = tabs.map(([key, label]) => '<a href="#' + key + '" class="nav-item' + (key === state.page ? ' active' : '') + '"' + (key === state.page ? ' aria-current="page"' : '') + '>' + icon(key) + '<span>' + label + '</span></a>').join('');
  $('#account-button').textContent = state.session.authenticated ? '退出个人空间' : '登录个人空间';
  $('#transport-notice').innerHTML = state.session.secureTransport === false ? '<div class="notice warn">当前为公开只读浏览。个人收藏、笔记与 AI 需要安全连接，暂不可在公网 HTTP 下登录。</div>' : '';
}
function card(item) {
  const favorite = state.personal?.favorites.includes(item.id), planned = state.personal?.planned.includes(item.id);
  return '<article class="card"><div class="card-top"><span class="badge' + (item.kind === 'announcement' ? ' purple' : '') + '">' + (item.kind === 'announcement' ? '全国赛事 · 官方公告' : '国内赛事 · 算法练习') + '</span><button class="bookmark' + (favorite ? ' active' : '') + '" data-action="favorite" data-id="' + esc(item.id) + '" aria-label="' + (favorite ? '取消收藏 ' : '收藏 ') + esc(item.title) + '" aria-pressed="' + !!favorite + '">' + icon('favorites') + '</button></div><h3><button class="card-title" data-action="detail" data-id="' + esc(item.id) + '">' + esc(item.title) + '</button></h3><p class="organizer">' + esc(item.organizer) + '</p><div class="tags">' + item.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div><div class="schedule"><strong>' + (item.startsAt ? '开赛 ' + date(item.startsAt) : '发布 ' + esc(item.publishedAt || '待确认')) + '</strong><br>' + esc(status(item)) + '</div><div class="card-bottom"><button class="text-button" data-action="detail" data-id="' + esc(item.id) + '">查看比赛详情 →</button><button class="button ' + (planned ? 'subtle' : 'secondary') + ' small" data-action="plan" data-id="' + esc(item.id) + '">' + (planned ? '已加入计划' : '加入计划') + '</button></div>' + (state.page === 'plans' ? '<p class="detail-meta">进度：' + esc(state.personal.notes[item.id]?.stage || '想参加') + '</p><button class="text-button" data-action="note" data-id="' + esc(item.id) + '">记录我的参赛过程 →</button>' : '') + '</article>';
}
function renderCards() {
  const now = Date.now();
  const list = allItems().filter(item => {
    if (state.page === 'favorites' && !state.personal?.favorites.includes(item.id)) return false;
    if (state.page === 'plans' && !state.personal?.planned.includes(item.id)) return false;
    if (state.page === 'discover' && !state.catalog.items.some(x => x.id === item.id)) return false;
    if (state.filter === '近期赛程' && !(item.startsAt >= now)) return false;
    if (state.filter === '进行中' && !(item.startsAt <= now && item.endsAt > now)) return false;
    if (state.filter === '官方公告' && item.kind !== 'announcement') return false;
    if (state.filter === '已结束' && !(item.endsAt <= now)) return false;
    return [item.title, item.organizer, item.category, ...item.tags].join(' ').toLowerCase().includes(state.query.trim().toLowerCase());
  }).sort((a, b) => {
    const rank = x => x.endsAt > now ? 0 : x.kind === 'announcement' ? 1 : 2;
    return rank(a) - rank(b) || (a.startsAt && b.startsAt ? (rank(a) === 0 ? a.startsAt - b.startsAt : b.startsAt - a.startsAt) : (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  });
  $('#results-count').textContent = list.length + ' 条来源记录';
  $('#cards').innerHTML = list.length ? list.map(card).join('') : empty('这里暂时没有比赛', state.query || state.filter !== '全部' ? '换个关键词或筛选条件试试。' : '采集完成后会显示真实来源；不会用演示数据填充。');
}
function catalogView() {
  const saved = state.page !== 'discover';
  const titles = { discover: ['FIND YOUR NEXT CHALLENGE', '让每一次参赛，都成为成长。', '发现中国国内赛事，从技能练习到值得展示的项目作品。'], favorites: ['YOUR SHORTLIST', '值得关注的比赛。', '收藏只是开始，核实规则后把它变成下一步计划。'], plans: ['BUILD YOUR EXPERIENCE', '把参赛过程，变成项目经历。', '记录个人分工、代码、测试与真实成果，不只是一个比赛名称。'] };
  view.innerHTML = header(...titles[state.page]);
  if (saved && !state.session.authenticated) { view.innerHTML += loginPrompt(); return; }
  view.innerHTML += '<div class="search"><label class="sr-only" for="search">搜索比赛</label>' + icon('search') + '<input id="search" type="search" placeholder="搜索比赛、主办方或技术方向" value="' + esc(state.query) + '"></div><div class="filters">' + ['全部', '近期赛程', '进行中', '官方公告', '已结束'].map(filter => '<button class="chip' + (filter === state.filter ? ' active' : '') + '" data-filter="' + filter + '" aria-pressed="' + (filter === state.filter) + '">' + filter + '</button>').join('') + '</div>';
  if (!saved) view.innerHTML += '<div class="status-row"><p><span class="online-dot"></span>服务器每日 ' + esc(state.catalog.refreshTime || '09:00') + ' 更新 · 北京时间<br>最近尝试 ' + date(state.catalog.lastAttempt) + '</p><button class="button secondary small" data-action="refresh">立即更新</button></div>' + (state.catalog.reports.some(r => !r.success) || state.catalog.storageWarning ? '<div class="notice warn">' + esc(state.catalog.storageWarning || '部分来源更新失败，仍显示上次缓存；请核实资料读取时间。') + '</div>' : '');
  view.innerHTML += '<div class="section-head"><h2>' + (state.page === 'discover' ? '为下一次挑战做准备' : state.page === 'favorites' ? '我的关注清单' : '我的参赛清单') + '</h2><small id="results-count"></small></div><div class="cards" id="cards"></div>';
  if (!saved) view.innerHTML += '<div class="ai-banner"><div><h3>不确定哪场比赛适合你？</h3><p>告诉 AI 你的专业、方向和想积累的经历。</p></div><a href="#ai" class="button">AI 帮我找</a></div><p class="footer-note">目前自动采集牛客自办算法赛与计算机设计大赛官方公告；不代表全国所有比赛。<br>开赛时间不等于报名截止，参赛资格与报名状态以主办方原文为准。<a href="#preferences">查看全部来源 →</a></p>';
  renderCards();
  $('#search').addEventListener('input', event => { state.query = event.target.value; renderCards(); });
}
function loginPrompt() { return '<div class="panel"><h2>进入你的个人空间</h2><p>每个账号拥有独立的偏好、收藏、计划、笔记和 DeepSeek 配置。</p><div class="actions"><button class="button" data-action="login">登录个人空间</button>' + (state.session.registrationEnabled ? '<button class="button secondary" data-action="register">注册新账号</button>' : '') + '</div></div>'; }
function preferencesView() {
  view.innerHTML = header('MAKE IT YOURS', '围绕你的目标，发现机会。', '不用局限于固定选项，你的专业、方向和当前基础都可以自由填写。');
  if (state.session.authenticated) {
    const profile = state.personal.profile;
    view.innerHTML += '<section class="panel"><h2>我的学习与参赛偏好</h2><form id="profile-form" class="form-grid"><label>专业<span>可以是计算机科学与技术，也可以是你的其他专业。</span><input name="major" maxlength="80" required value="' + esc(profile.major) + '" placeholder="例如：计算机科学与技术"></label><label>想发展的方向<span>技术栈、兴趣领域和想尝试的方向。</span><input name="interests" maxlength="200" value="' + esc(profile.interests) + '" placeholder="例如：Java 后端、人工智能、HarmonyOS 开发"></label><label>我的目标和目前基础<span>想获得什么经验？会哪些技能？有多少准备时间？</span><textarea name="goals" maxlength="600" rows="5" placeholder="例如：希望找到能产出完整项目的国内比赛；掌握 Java 和 MySQL，能每周投入 8 小时。">' + esc(profile.goals) + '</textarea></label><div><button class="button" type="submit">保存我的偏好</button></div></form></section><section class="panel"><h2>我的 DeepSeek 连接</h2><p>' + (state.session.ai?.configured ? '当前账号已保存 DeepSeek Key，网页不会回显密钥。模型：' + esc(state.session.ai.model) : '当前账号尚未配置 DeepSeek Key。输入后会加密保存到服务器。') + '</p><form id="key-form" class="form-grid"><label>DeepSeek API Key<span>只在安全 HTTPS 或 SSH 通道中输入；保存后无法在页面查看。</span><input name="key" type="password" autocomplete="off" minlength="16" maxlength="256" placeholder="粘贴你的 API Key"></label><div class="actions"><button class="button" type="submit">安全保存 Key</button>' + (state.session.ai?.configured ? '<button class="button danger" type="button" data-action="delete-key">删除我的 Key</button>' : '') + '</div></form><p>每日最多 ' + (state.session.ai?.limit || 5) + ' 次手动 AI 任务；不会定时调用付费 AI。失败的任务也占用次数。</p><button class="button secondary" data-action="test-ai"' + (!state.session.ai?.configured ? ' disabled' : '') + '>测试连接（不生成内容）</button></section><section class="panel"><h2>我的数据</h2><p>可导出个人偏好、收藏、计划与参赛笔记备份。导出不包含登录密码或 DeepSeek Key。</p><button class="button secondary" data-action="export">导出个人数据</button></section>';
  } else view.innerHTML += loginPrompt();
  view.innerHTML += '<section class="panel"><h2>比赛从哪里来？</h2><p>只收录中国国内赛事。自动采集和手动官网入口明确分开，不把未读取的门户当作已接入来源。</p>' + state.catalog.sources.map(source => {
    const report = state.catalog.reports.find(r => r.id === source.id);
    return '<div class="row"><div><h3>' + esc(source.name) + '</h3><p>' + esc(source.description) + '</p><span class="source-state' + (report && !report.success ? ' failed' : '') + '">' + (source.automatic ? '自动采集 · ' + (report ? (report.success ? report.count + ' 条 · ' : '更新失败 · ') + date(report.checkedAt) : '等待首次更新') : '手动官网入口 · 未自动采集') + '</span></div>' + external(source.url, '官网') + '</div>';
  }).join('') + '<p class="footer-note">服务器每日 ' + esc(state.catalog.refreshTime || '09:00') + '（北京时间）采集固定公开来源，服务重启会补查；来源失败保留缓存。更改时刻需修改服务器 REFRESH_TIME 配置并重启服务。</p></section>';
  // Attach after all markup is present; innerHTML += recreates existing nodes.
  $('#profile-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.target);
    const fields = [...event.target.elements]; fields.forEach(field => { field.disabled = true; });
    try { await savePersonal(next => { next.profile = { version: 1, major: form.get('major').trim(), interests: form.get('interests').trim(), goals: form.get('goals').trim() }; }, '偏好已保存', false); }
    finally { fields.forEach(field => { field.disabled = false; }); }
  });
  $('#key-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.target); const key = String(form.get('key') || '').trim();
    if (!key) return toast('请输入 DeepSeek API Key');
    const controls = [...event.target.elements]; controls.forEach(field => { field.disabled = true; });
    try { const info = await api('ai/key', { method: 'PUT', body: JSON.stringify({ key }) }); state.session.ai = info; event.target.reset(); render(); toast('你的 DeepSeek Key 已加密保存'); }
    catch (error) { toast(error.message); } finally { controls.forEach(field => { field.disabled = false; }); }
  });
}
function chatMessage(message) {
  const sources = Array.isArray(message.sources) ? message.sources.slice(0, 6).map(source =>
    '<li>' + external(source.url, source.title || '查看来源', 'text-button') + '</li>').join('') : '';
  return '<div class="chat-message ' + (message.role === 'user' ? 'user' : 'assistant') + '"><div class="chat-bubble">' + esc(message.content) + '</div>' + (sources ? '<ul class="chat-sources">' + sources + '</ul>' : '') + '</div>';
}
function chatPanel(info) {
  const messages = state.chat.messages.length ? state.chat.messages.map(chatMessage).join('') : '<div class="chat-empty"><strong>从一句话开始</strong><p>例如：“我是计算机科学与技术专业，想找能做出项目并写进简历的国内比赛，我每周能投入 8 小时。”</p></div>';
  const statusText = state.chat.busy ? 'AI 正在理解你的问题并核对来源，请保持页面打开。' : !info.configured ? '还没有配置 Key；现在点击发送会引导你到“我的偏好”完成配置。' : '每次对话都会消耗 1 次今日 AI 额度；回答中的来源仍需你打开官网核实。';
  return '<section class="panel chat-panel"><div class="chat-heading"><div><p class="eyebrow">NATURAL LANGUAGE CHAT</p><h2>直接和 AI 对话找比赛</h2><p>不用先学会筛选条件，直接说你的专业、方向、时间和想积累的经历。</p></div><span class="chat-status">' + (info.configured ? 'DeepSeek 已连接' : '等待配置') + '</span></div><div class="chat-messages" id="chat-messages" aria-live="polite">' + messages + '</div>' + (state.chat.error ? '<p class="error-text" role="alert">' + esc(state.chat.error) + '</p>' : '') + '<div class="chat-suggestions"><button class="chip" type="button" data-action="chat-suggest" data-message="我读计算机科学与技术专业，想找近期中国国内、能形成项目作品并写进简历的比赛，应该优先看什么？">找适合我的比赛</button><button class="chip" type="button" data-action="chat-suggest" data-message="我每周只能投入 8 小时，会 Java 和 MySQL，帮我规划一个可执行的参赛方向。">按时间规划</button><button class="chip" type="button" data-action="chat-suggest" data-message="腾讯、华为或其他中国企业近期有哪些适合大学生的技术挑战赛？请给出核实来源。">查企业挑战赛</button></div><form id="chat-form" class="chat-form"><label class="sr-only" for="chat-input">输入你想咨询的问题</label><textarea id="chat-input" rows="3" maxlength="2000" placeholder="例如：我想参加人工智能方向的国内比赛，最好能产出一个可展示的项目…"' + (state.chat.busy ? ' disabled' : '') + '></textarea><div class="chat-form-bottom"><small role="status">' + statusText + '</small><button class="button" type="submit"' + (state.chat.busy ? ' disabled' : '') + '>发送给 AI</button></div></form></section>';
}
function attachChat() {
  const form = $('#chat-form');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('#chat-input'), message = input.value.trim();
    if (!message || state.chat.busy) return;
    if (!state.session.ai?.configured) { toast('请先到“我的偏好”保存 DeepSeek Key'); location.hash = 'preferences'; return; }
    const history = state.chat.messages.slice(-12);
    state.chat.messages.push({ role: 'user', content: message }); state.chat.busy = true; state.chat.error = '';
    state.chat.controller = new AbortController(); aiView();
    try {
      const result = await api('ai/chat', { method: 'POST', body: JSON.stringify({ message, history }), signal: state.chat.controller.signal });
      state.chat.messages.push({ role: 'assistant', content: result.reply, sources: result.sources || [] }); state.session.ai = result;
    } catch (error) { state.chat.error = error.message; }
    finally { state.chat.busy = false; state.chat.controller = null; if (state.page === 'ai') aiView(); }
  });
}
function aiView() {
  view.innerHTML = header('A LITTLE HELP, A CLEARER DIRECTION', '为你的下一步，多找一些可能。', '让 AI 根据真实检索来源，结合你的专业、方向与目标筛选国内候选比赛。');
  if (!state.session.authenticated) { view.innerHTML += loginPrompt(); return; }
  const info = state.session.ai || {};
  view.innerHTML += '<section class="panel"><h2>按我的偏好寻找比赛</h2><p>专业：' + esc(state.personal.profile.major) + '<br>方向：' + esc(state.personal.profile.interests || '尚未填写') + ' · <a href="#preferences">调整偏好</a></p><div class="notice">每次调用前单独确认费用。仅发送已保存的专业、方向、需求与公开赛事资料，不发送笔记、收藏或计划。搜索结果仍需核实国内归属、报名资格和截止时间。</div><div class="actions"><button class="button" data-action="ai-web"' + (state.busy ? ' disabled' : '') + '>联网搜索 + AI 推荐</button><button class="button secondary" data-action="ai-catalog"' + (state.busy ? ' disabled' : '') + '>只分析已有比赛</button>' + (state.busy ? '<button class="button danger" data-action="cancel-ai">取消等待</button>' : '') + '</div><p class="footer-note" role="status">' + (state.busy ? '正在搜索或分析，请保持页面打开。取消后已发送的请求可能仍计费。' : !info.configured ? '尚未配置 DeepSeek Key；按钮仍可点击，点击后会引导你到“我的偏好”保存 Key。' : '今日已用 ' + (info.used || 0) + ' / ' + info.limit + ' 次；不自动重试，不自动付费。') + '</p></section>';
  view.innerHTML += chatPanel(info);
  if (state.report) {
    view.innerHTML += '<div class="section-head"><h2>最近一次研究结果</h2><small>' + date(state.report.checkedAt) + '</small></div><div class="notice">国内候选 · 来源待核实。以下为 AI 建议，不是主办方确认，不自动进入已核实赛事列表。</div>';
    if (state.report.toolCalls?.length) {
      const searches = state.report.toolCalls.filter(call => call.name === 'search_competitions').length;
      view.innerHTML += '<div class="notice">本次 Agent 执行：' + state.report.toolCalls.map(call => esc(call.name) + (call.count ? '（' + call.count + ' 条）' : '')).join(' → ') + '<br>共搜索 ' + searches + ' 组关键词，保留 ' + (state.report.searchedCount || 0) + ' 个国内候选来源，证据校验后推荐 ' + state.report.items.length + ' 项。没有通过国内来源或逐字证据校验的内容不会展示。</div>';
    }
    view.innerHTML += state.report.items.length ? state.report.items.map(item => '<article class="panel ai-result"><span class="badge">候选来源 · 待核实</span><h3>' + esc(item.source.title) + '</h3><p class="detail-meta">' + esc(new URL(item.source.url).hostname) + ' · ' + esc(item.source.date || '发布时间未知') + '</p><blockquote>' + esc(item.evidence) + '</blockquote><p class="recommendation"><strong>为什么可以关注</strong><br>' + esc(item.reason) + '</p><p><strong>建议你产出的作品</strong><br>' + esc(item.action) + '</p>' + external(item.source.url, '核实原始来源') + '</article>').join('') : empty('本次没有可确认的推荐', '未找到满足国内来源及证据校验的候选，不会补造比赛。');
  } else view.innerHTML += empty('你的第一份比赛研究，还在等待出发', '先填写偏好，配置好连接，再手动启动一次研究。');
  attachChat();
}
function render() { navigation(); if (['discover', 'favorites', 'plans'].includes(state.page)) catalogView(); else if (state.page === 'ai') aiView(); else preferencesView(); }
function dialog(title, body) { content.innerHTML = '<div class="dialog-head"><h2>' + esc(title) + '</h2><button class="close" data-action="close" aria-label="关闭">×</button></div>' + body; if (!modal.open) modal.showModal(); }
function requireLogin() { if (state.session.authenticated) return true; login(); return false; }
function login() {
  if (!state.session.secureTransport) return toast('此入口仅公开浏览；个人空间请用电脑的 SSH 安全通道访问。');
  dialog('登录个人空间', '<p class="detail-meta">使用你注册时的邮箱和独立密码。</p><form id="login-form" class="form-grid"><label for="email">邮箱</label><input id="email" name="email" type="email" autocomplete="username" maxlength="254" required><label for="password">登录密码</label><input id="password" name="password" type="password" autocomplete="current-password" minlength="12" maxlength="128" required><p class="error-text" id="login-error" role="alert"></p><div class="actions"><button class="button" type="submit">登录</button>' + (state.session.registrationEnabled ? '<button class="button secondary" type="button" data-action="register">注册新账号</button>' : '') + '</div></form>');
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try { const email = $('#email').value.trim(), password = $('#password').value; await api('login', { method: 'POST', body: JSON.stringify({ email, password }) }); $('#password').value = ''; await loadPrivate(); modal.close(); render(); toast('已登录，个人数据已同步'); }
    catch (error) { $('#login-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
}
function register() {
  if (!state.session.secureTransport) return toast('注册需要 HTTPS 或本机 SSH 安全通道。');
  dialog('注册个人空间', '<p class="detail-meta">每个账号拥有独立的偏好、收藏、计划、笔记和 DeepSeek Key。密码至少 12 个字符。</p><form id="register-form" class="form-grid"><label for="register-email">邮箱</label><input id="register-email" name="email" type="email" autocomplete="username" maxlength="254" required><label for="register-password">密码</label><input id="register-password" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><label for="register-confirm">确认密码</label><input id="register-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required><p class="error-text" id="register-error" role="alert"></p><div class="actions"><button class="button" type="submit">注册并登录</button><button class="button secondary" type="button" data-action="login">已有账号，登录</button></div></form>');
  $('#register-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.target); const email = String(form.get('email') || '').trim(), password = String(form.get('password') || ''), confirmPassword = String(form.get('confirm') || '');
    if (password !== confirmPassword) return $('#register-error').textContent = '两次密码不一致';
    const button = event.target.querySelector('button[type="submit"]'); button.disabled = true;
    try { await api('register', { method: 'POST', body: JSON.stringify({ email, password }) }); await loadPrivate(); modal.close(); render(); toast('账号已创建，欢迎使用比赛雷达'); }
    catch (error) { $('#register-error').textContent = error.message; } finally { button.disabled = false; }
  });
}
async function loadPrivate() {
  state.session = await api('session');
  if (state.session.authenticated) {
    const [personal, ai, chat] = await Promise.all([api('personal'), api('ai/report'), api('ai/chat')]); state.personal = personal; state.report = ai.report; state.chat.messages = Array.isArray(chat.history) ? chat.history : []; state.chat.error = ''; state.session.ai = ai;
  } else { state.personal = null; state.report = null; state.chat = { messages: [], busy: false, error: '', controller: null }; }
}
async function savePersonal(change, message, repaint = true) {
  if (!requireLogin() || state.saving) return;
  state.saving = true;
  try { const next = structuredClone(state.personal); change(next); state.personal = await api('personal', { method: 'PUT', body: JSON.stringify(next) }); toast(message); if (repaint) render(); return true; }
  catch (error) { toast(error.message); if (error.status === 409) { state.personal = await api('personal'); if (repaint) render(); } return false; }
  finally { state.saving = false; }
}
function detail(id) {
  const item = allItems().find(x => x.id === id); if (!item) return;
  dialog(item.title, '<p class="detail-meta">' + esc(item.organizer) + '<br>' + esc(status(item)) + '<br>资料读取：' + date(item.fetchedAt) + '（北京时间）</p><p>' + esc(item.description) + '</p><h3>可以积累什么作品</h3><ul class="detail-list">' + item.deliverables.map(d => '<li>' + esc(d) + '</li>').join('') + '</ul><div class="notice warn">请自行核实官网原文中的参赛资格、报名时间和费用。加入计划并不代表已成功报名。</div><div class="actions">' + external(item.sourceUrl, '官方详情 / 报名', 'button') + '<button class="button secondary" data-action="note" data-id="' + esc(id) + '">记录参赛过程</button></div>');
}
function note(id) {
  if (!requireLogin()) return;
  const item = allItems().find(x => x.id === id); if (!item) return;
  const existing = state.personal.notes[id] || { stage: '想参加', text: '' };
  dialog('我的参赛记录', '<p class="detail-meta">' + esc(item.title) + '</p><form id="note-form" class="form-grid"><label>当前阶段<select name="stage">' + ['想参加', '准备中', '已提交', '已完成'].map(stage => '<option' + (stage === existing.stage ? ' selected' : '') + '>' + stage + '</option>').join('') + '</select></label><label>记录与经历草稿<textarea name="text" maxlength="10000" rows="8" placeholder="我的职责：&#10;技术方案与难点：&#10;代码 / 演示链接：&#10;测试与结果：&#10;可验证的个人贡献：">' + esc(existing.text) + '</textarea></label><p class="detail-meta">只记录真实完成的工作；这些笔记不会发送给 AI。</p><button class="button" type="submit">保存参赛记录</button></form>');
  let dirty = false; const form = $('#note-form'); form.addEventListener('input', () => { dirty = true; });
  const closeGuard = event => { if (dirty && !confirm('记录还没有保存，确定关闭吗？')) event.preventDefault(); };
  modal.oncancel = closeGuard;
  content.querySelector('[data-action="close"]').onclick = event => { event.stopPropagation(); if (!dirty || confirm('记录还没有保存，确定关闭吗？')) modal.close(); };
  form.addEventListener('submit', async event => { event.preventDefault(); const fields = new FormData(form);
    const controls = [...form.elements]; controls.forEach(field => { field.disabled = true; });
    let ok; try { ok = await savePersonal(next => { next.notes[id] = { stage: fields.get('stage'), text: fields.get('text'), updatedAt: Date.now() }; if (!next.planned.includes(id)) next.planned.push(id); }, '参赛记录已保存'); }
    finally { controls.forEach(field => { field.disabled = false; }); }
    if (ok) { dirty = false; modal.close(); }
  });
}
async function runAi(mode) {
  if (!requireLogin() || state.busy) return;
  if (!state.session.ai?.configured) { toast('请先到“我的偏好”保存 DeepSeek Key'); location.hash = 'preferences'; return; }
  const calls = mode === 'web' ? '最多 3 次联网搜索 + 1 次模型分析' : '最多 1 次模型分析';
  if (!confirm('本次将执行' + calls + '，可能产生费用。\n\n发送已保存的专业、方向、需求和公开资料给 DeepSeek；不会发送笔记、收藏或计划。\n失败不自动重试，但仍占用今日任务额度。是否继续？')) return;
  state.busy = true; state.controller = new AbortController(); aiView();
  try { const result = await api('ai/research', { method: 'POST', body: JSON.stringify({ mode, confirm: true }), signal: state.controller.signal }); state.report = result.report; state.session.ai = result; toast('研究完成，请核实每条来源'); }
  catch (error) { toast(error.name === 'AbortError' ? '已取消等待，已发送的请求可能仍计费' : error.message); }
  finally { state.busy = false; state.controller = null; try { const result = await api('ai/report'); state.session.ai = result; state.report = result.report; } catch (_) {} if (state.page === 'ai') aiView(); }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action], [data-filter]'); if (!button) return;
  if (button.dataset.filter) { state.filter = button.dataset.filter; catalogView(); return; }
  const action = button.dataset.action, id = button.dataset.id;
  try {
    if (action === 'close') modal.close();
    else if (action === 'login') login();
    else if (action === 'register') register();
    else if (action === 'detail') detail(id);
    else if (action === 'note') note(id);
    else if (action === 'favorite' || action === 'plan') { const field = action === 'favorite' ? 'favorites' : 'planned'; await savePersonal(next => { next[field] = next[field].includes(id) ? next[field].filter(x => x !== id) : [...next[field], id]; }, '清单已保存'); }
    else if (action === 'refresh') { if (!requireLogin()) return; button.disabled = true; button.textContent = '正在更新…'; state.catalog = await api('refresh', { method: 'POST', body: '{}' }); render(); toast(state.catalog.reports.every(r => r.success) ? '来源更新完成' : '部分来源暂不可用，已保留缓存'); }
    else if (action === 'test-ai') { button.disabled = true; toast((await api('ai/test', { method: 'POST', body: '{}' })).message); }
    else if (action === 'delete-key') { if (!confirm('删除当前账号保存的 DeepSeek Key？')) return; state.session.ai = await api('ai/key', { method: 'DELETE', body: '{}' }); render(); toast('DeepSeek Key 已删除'); }
    else if (action === 'ai-web' || action === 'ai-catalog') await runAi(action === 'ai-web' ? 'web' : 'catalog');
    else if (action === 'chat-suggest') { const input = $('#chat-input'); if (input) { input.value = button.dataset.message || ''; input.focus(); } }
    else if (action === 'cancel-ai') state.controller?.abort();
    else if (action === 'export') { const blob = new Blob([JSON.stringify({ ...state.personal, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'career-radar-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  } catch (error) { toast(error.message); } finally { if (button.isConnected) button.disabled = false; }
});
modal.addEventListener('close', () => { content.innerHTML = ''; modal.oncancel = null; });
$('#account-button').addEventListener('click', async () => {
  if (!state.session.authenticated) return login();
  if (!confirm('退出个人空间？已保存的数据会保留在服务器。')) return;
  try { state.controller?.abort(); state.chat.controller?.abort(); await api('logout', { method: 'POST', body: '{}' }); await loadPrivate(); state.chat = { messages: [], busy: false, error: '', controller: null }; render(); } catch (error) { toast(error.message); }
});
function route() { const page = location.hash.slice(1); state.page = ['discover', 'favorites', 'plans', 'ai', 'preferences'].includes(page) ? page : 'discover'; state.query = ''; state.filter = '全部'; render(); window.scrollTo(0, 0); }
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', event => { if (state.busy || state.chat.busy) { event.preventDefault(); event.returnValue = ''; } });
try { [state.catalog] = await Promise.all([api('catalog'), loadPrivate()]); route(); }
catch (error) { view.innerHTML = header('CAREER RADAR', '暂时无法连接服务器。', '请检查连接后重试，已保存的数据不会被清空。') + '<p class="error-text">' + esc(error.message) + '</p><button class="button" id="retry">重新加载</button>'; $('#retry').onclick = () => location.reload(); }
