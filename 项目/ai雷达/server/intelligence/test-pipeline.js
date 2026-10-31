'use strict';
const assert = require('node:assert/strict');
const { collectAndBuild, parseEntries, parseCrossref, fetchSource, SOURCES, constants, _test } = require('./pipeline');
const savedFetch = global.fetch;
const savedSources = SOURCES.slice();
const savedEnv = Object.fromEntries(['AI_KEY','AI_URL','AI_BASE','AI_MODEL'].map(k => [k, process.env[k]]));
const NOW = new Date('2026-10-19T10:00:00Z');
function item(title, url, date, summary = '') { return '<item><title><![CDATA[' + title + ']]></title><link>' + url.replace(/&/g,'&amp;') + '</link>' + (date ? '<pubDate>' + date + '</pubDate>' : '') + '<description><![CDATA[' + summary + ']]></description></item>'; }
function feed(items = []) { return '<?xml version="1.0"?><rss><channel>' + items.join('') + '</channel></rss>'; }
function response(body, status = 200) { return new Response(body, { status }); }
function configure(entries) { SOURCES.splice(0, SOURCES.length, ...entries.map((x, i) => ({ id:'s'+i, name:'测试'+i, url:'https://test/source/'+i, type:'rss', maxItems:12, ...x }))); }
async function main() {
  delete process.env.AI_KEY; delete process.env.AI_URL; delete process.env.AI_BASE;
  assert.throws(() => parseEntries('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///x">]><rss/>','rss'));
  assert.throws(() => parseEntries('<html><body>not RSS</body></html>','rss'));
  assert.throws(() => parseEntries('<rss><channel><item></rss>','rss'));
  assert.deepEqual(parseEntries(feed(), 'rss'), []);
  const parsed = parseEntries(feed([item('HR &amp; AI', 'https://e/a', 'Mon, 19 Oct 2026 09:00:00 GMT', '<b>sample</b><script>bad()</script>')]), 'rss');
  assert.equal(parsed[0].title, 'HR & AI'); assert.equal(parsed[0].summary, 'sample');
  const atom = parseEntries('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Recruitment AI</title><link href="https://e/pdf" type="application/pdf"/><link rel="alternate" href="https://e/article" type="text/html"/><published>2026-10-18T00:00:00Z</published><updated>2026-10-19T00:00:00Z</updated></entry></feed>', 'atom');
  assert.equal(atom[0].url, 'https://e/article'); assert.equal(atom[0].publishedAt.toISOString(), '2026-10-18T00:00:00.000Z');
  const undated = parseEntries('<feed><entry><title>招聘</title><link href="https://e/a"/><updated>2026-10-19T00:00:00Z</updated></entry></feed>', 'atom');
  assert.equal(undated[0].publishedAt, null);
  const cross = parseCrossref(JSON.stringify({ message:{items:[{title:['Recruitment'],DOI:'10.1/a',published:{'date-parts':[[2026,10]]},created:{'date-time':'2026-10-19T00:00:00Z'}},{title:['HR AI'],DOI:'10.1/b',published:{'date-parts':[[2026,10,18]]}}]}}));
  assert.equal(cross[0].publishedAt, null); assert.equal(cross[1].publishedAt.toISOString(), '2026-10-18T00:00:00.000Z');

  configure([{}, {}, { timeout:15 }, {}]);
  global.fetch = async (url, opt) => {
    if (url.endsWith('/2')) return new Promise((_, reject) => opt.signal.addEventListener('abort', () => reject(new Error('abort')), { once:true }));
    if (url.endsWith('/3')) return response('<html><body>blocked</body></html>');
    if (url.endsWith('/0')) return response(feed([
      item('招聘 AI 产品进展', 'https://e/a', 'Mon, 19 Oct 2026 09:00:00 GMT'),
      item('招聘旧消息', 'https://e/old', 'Thu, 01 Oct 2026 09:00:00 GMT'),
      item('招聘未来消息', 'https://e/future', 'Tue, 20 Oct 2026 09:00:00 GMT'),
      item('招聘无日期', 'https://e/no-date', null),
      item(' unrelated cooking ', 'https://e/food', 'Mon, 19 Oct 2026 09:00:00 GMT')
    ]));
    return response(feed([
      item('招聘 AI 产品进展', 'https://e/a?utm_source=test', 'Mon, 19 Oct 2026 09:00:00 GMT'),
      item('会展 AI 票务产品', 'https://e/b', 'Mon, 19 Oct 2026 08:00:00 GMT')
    ]));
  };
  const snapshot = await collectAndBuild({ now:NOW });
  assert.equal(snapshot.mode,'rules'); assert.equal(snapshot.signals.length,2);
  assert.equal(snapshot.counts.collected,7); assert.equal(snapshot.counts.eligible,2);
  assert.equal(snapshot.sourceResults.filter(x => x.status === 'error').length,2);
  assert(snapshot.warnings.some(x => x.includes('发布日期缺失')));
  assert(snapshot.signals.every(s => Date.parse(s.publishedAt) <= NOW.getTime()));
  assert.equal(snapshot.companies.length,0);
  configure([{}]); global.fetch = async () => response(feed());
  const empty = await collectAndBuild({ now:NOW }); assert.equal(empty.signals.length,0); assert.equal(empty.directions.length,0);
  global.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(collectAndBuild({ now:NOW, previousSnapshot:snapshot }), e => e.code === 'ALL_SOURCES_FAILED' && e.previousSnapshot === snapshot);
  global.fetch = async () => response('x'.repeat(constants.MAX_BYTES+1));
  await assert.rejects(fetchSource(SOURCES[0]), /体积上限/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(collectAndBuild({signal:cancelled.signal}), e => e.name==='AbortError');

  const finance = (id,title,summary='招聘软件') => ({ id, title, summary, url:'https://e/'+id, publishedAt:'2026-10-18T00:00:00Z', source:'test' });
  assert.equal(_test.lateRoundMention('完成D1轮融资'), true);
  assert.equal(_test.lateRoundMention('Series D1 funding'), true);
  assert.equal(_test.lateRoundMention('完成B轮融资'), false);
  assert.equal(_test.companyName('独家丨灵钜创新完成数千万元天使轮，南山战新投、龙华资本联合投资'), '灵钜创新');
  assert.equal(_test.roundOf('独家丨灵钜创新完成数千万元天使轮，南山战新投'), '天使轮');
  assert.equal(_test.roundOf('「成熟科技」完成D1轮融资'), null);
  assert.equal(_test.mature('Accio', '阿里旗下全球电商AI工作台'), true);
  assert.equal(_test.mature('奇安信', 'AI 安全产品'), true);
  assert.equal(_test.mature('票牛网', '演出票务平台'), true);
  assert.equal(_test.mature('考试宝', '在线职业教育平台被五八驾考全资收购'), true);
  assert.equal(_test.mature('太仓人才网', '始于1998年的县级市人才招聘网站'), false);
  assert.equal(_test.makeCompanies([finance('hibob','HiBob launches HR platform')]).length, 0);
  assert.equal(_test.weakCompanyEvidence(finance('association-report', '《2026灵活用工平台就业发展报告》发布 — 中国人力资源协会', '报告依据灵活用工市场头部企业灵工打卡平台运营数据分析。')), true);
  const fundingRoundup = finance('funding-roundup', '启示2026：中国人力资源服务行业投融资及兼并重组分析（附投融资汇总）', '2025年融资事件数量为4件，金额约为1.66亿元。');
  assert.equal(_test.weakCompanyEvidence(fundingRoundup), true);
  assert.equal(_test.weakCompanyEvidence(finance('funding-monthly', '2025年11月全球人力资源科技投融资简报', '本月披露多起种子轮及A轮融资事件。')), true);
  assert.equal(_test.weakCompanyEvidence(finance('labor-report', '2026灵活用工平台就业发展报告发布', '协会报告依据平台运营数据分析行业。')), true);
  assert.equal(_test.weakCompanyEvidence({ ...finance('paper','When Care Expands and Control Declines'), url:'https://arxiv.org/abs/2610.25773v1', summary:'Thematic analysis examines digital privacy.' }), true);
  assert.equal(_test.makeCompanies([finance('labor-report', '2026灵活用工平台就业发展报告发布', '协会报告依据平台运营数据分析行业。')]).length, 0);
  const companies = _test.makeCompanies([
    finance('f1','「星河科技」完成A轮融资，招聘软件升级'),
    finance('f2','「海风智能」获天使轮融资，人才软件升级'),
    finance('f3','「星河科技」发布招聘产品；「另一科技」完成B轮融资'),
    finance('f4','「成熟科技」完成D1轮融资'),
    finance('f5','Workday Raises Series A Funding for HR'),
    finance('f6','「未来科技」发布招聘工具','另一科技完成 A轮融资')
  ]);
  assert.deepEqual(companies.map(c => c.name), ['星河科技','海风智能','另一科技']);
  assert.deepEqual(companies.slice(0,2).map(c => [c.candidateType,c.fundingStatus]), [['早期融资候选','已识别'],['早期融资候选','已识别']]);
  assert(companies.every(c => c.candidateType === '早期融资候选' && c.fundingStatus === '已识别'));
  assert(companies.every(c => c.synergyLevel==='待核实'));
  const innovationFunding = _test.makeCompanies([finance('lingju','灵钜创新完成天使轮融资，场馆数字化产品升级')]);
  assert.deepEqual(innovationFunding.map(c => [c.name,c.round]), [['灵钜创新','天使轮']]);
  const summaryCompanies = _test.makeCompanies([
    finance('s1', 'HiringCafe Secures $6.8 Million With AI Talent Agents', 'SAN FRANCISCO — HiringCafe, an AI-powered job discovery search engine, announced Monday that it has raised $6.8 million in pre-seed funding and launched a new talent agent.'),
    finance('s2', 'Workforce management platform RAISES $40M', 'SAN FRANCISCO — Miter, the leading AI-powered workforce management platform, announced it has raised a $40 million Series B round of financing.'),
    finance('s3', 'Background Screening Tool Raises $30M Series B', 'Hiring software for recruitment.'),
    finance('s4', 'FutureTech Raises Funding for Recruitment', 'FutureTech launched a new product. OtherTech raised Series A funding for recruitment.'),
    finance('s5', 'MatureTech Raises Series D Funding for HR')
  ]);
  assert.deepEqual(summaryCompanies.map(c => [c.name, c.round]), [['OtherTech','A轮']]);
  assert(!summaryCompanies.some(c => ['Background Screening Tool','FutureTech'].includes(c.name)));
  const leads = _test.makeCompanies([
    finance('l1', 'Fama Introduces Policy-Based Screening', 'Fama introduces a policy-based screening product for employers.'),
    finance('l2', 'CitoHR Bridges AI and Workplace Admin', 'CitoHR bridges AI and workplace administration for HR teams.'),
    finance('l3', 'Rollie Jobs Reduces Hiring Friction', 'Rollie Jobs reduces hiring friction with recruiting software.')
  ]);
  assert.deepEqual(leads, []); // Known overseas startup names are excluded from domestic candidates.
  const oldWebSignal = { ...finance('old-web','「旧项目科技」完成A轮融资，招聘产品升级','2023年8月25日 旧项目科技完成人力资源科技产品A轮融资。'), discoveryType:'ai-web-search' };
  assert.equal(_test.makeCompanies([oldWebSignal]).length,0);
  const oldMentionSignal = { ...finance('old-mention','人力资源科技公司“旧项目科技”完成A轮融资', '旧项目科技于2023年完成A轮融资并推出招聘产品。'), discoveryType:'ai-web-search' };
  assert.equal(_test.makeCompanies([oldMentionSignal]).length,0);
  configure([{maxItems:20}]);
  global.fetch = async () => response(feed(Array.from({length:20}, (_,i) => item('招聘工具 '+i,'https://e/window/'+i,'Wed, 30 Sep 2026 09:00:00 GMT'))));
  assert.equal((await collectAndBuild({now:NOW})).signals.length,0);
  const monthly = await collectAndBuild({now:NOW,lookbackDays:30});
  assert.equal(monthly.signals.length,20); assert.equal(monthly.lookbackDays,30);
  assert.equal(monthly.periodStart,'2026-09-19');
  assert(monthly.directions[0].whyNow.includes('近 30 天'));
  await assert.rejects(collectAndBuild({now:NOW,lookbackDays:91}), /回看天数/);
  const aiSignals = [finance('f1','「星河科技」完成A轮融资，招聘软件升级'), finance('f2','海风智能发布人才服务机器人')];
  const aiBase = { ...snapshot, companies:[], signals:aiSignals, counts:{collected:9,eligible:2,companies:0,fundedCompanies:0} };
  const roundupSignal = finance('roundup','云生未来 人力资源科技产品演示','云生未来等12家重点机构现场演示AI数字产品，另有20家企业依次亮相路演。');
  const roundupBase = { ...aiBase, signals:[roundupSignal], directions:[{id:'dir_hr',name:'人才招聘与人力资源科技',summary:'招聘和人力资源科技',evidenceIds:['roundup']}], companies:[] };
  const roundupResult = _test.sanitizeAI({directions:[],companies:[{name:'云生未来',directionId:'dir_hr',evidenceIds:['roundup']}],threats:[]},roundupBase);
  assert.equal(roundupResult.companies.length,0);
  const aiDirection = {name:'AI招聘自动化', evidenceIds:['f1'], summary:'招聘流程自动化方向', whyNow:'公开信号显示企业获得A轮融资并升级招聘软件', relation:'可结合集团招聘服务场景验证', risks:['商业化与合规待核实']};
  const result = {
    mode:'rules', signals:[{ id:'evil', url:'javascript:alert(1)' }], generatedAt:'2099-01-01', counts:{ collected:999 }, id:'changed',
    directions:[aiDirection],
    companies:[
      {name:'星河科技',directionName:'AI招聘自动化',evidenceIds:['f1'],synergyLevel:'高',summary:'AI识别的企业候选',synergyReason:'其招聘自动化产品可能与集团招聘服务场景结合，需试点验证',groupEmpowers:'集团可提供招聘服务场景供产品验证',companyEmpowers:'企业自动化能力可能补充集团招聘工具',research:{overview:'公开信号提到A轮融资和招聘软件升级',opportunity:'可研究招聘流程自动化',competition:'竞争格局待补充',questions:['先核对公司主体与融资公告']}},
      {name:'伪造企业',evidenceIds:['f2'],synergyLevel:'高',summary:'没有来源中对应的企业主体'}
    ],
    threats:[{title:'招聘自动化可能改变人岗匹配流程',sector:'人力资源科技',evidenceIds:['f1'],impact:'可能改变招聘环节，需要业务验证',response:'开展小范围场景测试'}]
  };
  const enhanced = _test.sanitizeAI(result,aiBase);
  assert.deepEqual(enhanced.signals,aiBase.signals); assert.equal(enhanced.generatedAt,aiBase.generatedAt); assert.equal(enhanced.id,aiBase.id);
  assert.equal(enhanced.mode,'ai'); assert.equal(enhanced.directions[0].name,'AI招聘自动化');
  assert.equal(enhanced.companies.length,1); assert.equal(enhanced.companies[0].name,'星河科技');
  assert.equal(enhanced.companies[0].round,'A轮'); assert.equal(enhanced.companies[0].fundingStatus,'已识别');
  assert.equal(enhanced.companies[0].aiSynergyLevel,'高'); assert.equal(enhanced.companies[0].synergyLevel,'待核实');
  assert.equal(enhanced.companies[0].directionId,enhanced.directions[0].id);
  assert.equal(enhanced.counts.companies,1); assert.equal(enhanced.counts.fundedCompanies,1);
  assert.equal(enhanced.companies[0].provenance.summary,'AI 生成'); assert.equal(enhanced.companies[0].provenance.identity,'AI 识别');
  assert.equal(enhanced.companies[0].provenance.researchOverview,'AI 生成');
  assert.equal(enhanced.companies[0].provenance.synergyLevel,'AI 初判');
  assert.equal(enhanced.companies[0].region,'待核实');
  assert.equal(enhanced.companies[0].screeningStatus,'符合早期轮次优先口径');
  assert(enhanced.companies[0].pending.some(x=>x.includes('是否为中国境内企业')));
  assert.equal(enhanced.threats[0].provenance.title,'AI 识别');
  const rejected = _test.sanitizeAI({directions:[],companies:[{name:'不存在的公司',evidenceIds:['f1']}],threats:[]},aiBase);
  assert.equal(rejected.companies.length,0); assert(rejected.warnings.some(w=>w.includes('拒绝')));

  configure([{}]); process.env.AI_KEY='test'; process.env.AI_URL='https://test/ai';
  global.fetch = async url => url.startsWith('https://test/source') ? response(feed([item('招聘 AI 技术','https://e/new','Mon, 19 Oct 2026 09:00:00 GMT')])) : response(JSON.stringify({choices:[{message:{content:'{"companies":[{"id":"fake","evidenceIds":["forged"]}]}'}}]}));
  const fallback = await collectAndBuild({now:NOW}); assert.equal(fallback.mode,'rules'); assert(fallback.warnings.some(w=>w.includes('AI 增强失败')));
  const html = `<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fe%2Fcompany" class='result-link'>星河科技 - 招聘软件</a><td class="result-snippet">星河科技提供招聘软件。</td><a class="result-link" href='javascript:alert(1)'>bad</a>`;
  const search = _test.parseSearchResults(html);
  assert.equal(search.length,1); assert.equal(search[0].url,'https://e/company'); assert.equal(search[0].publishedAt,null);
  const bingHtml = `<ol id="b_results"><li class="b_algo"><h2><a href="https://e/bing-company">星河科技完成A轮融资，招聘产品升级</a></h2><div class="b_caption"><p>星河科技宣布完成A轮融资并升级招聘产品。</p></div></li><li class="b_algo"><h2><a href="javascript:alert(1)">bad</a></h2></li></ol>`;
  const bingResults = _test.parseBingResults(bingHtml);
  assert.equal(bingResults.length,1); assert.equal(bingResults[0].url,'https://e/bing-company'); assert(bingResults[0].summary.includes('A轮融资'));
  const baiduHtml = `<div class="result"><h3><a href="http://www.baidu.com/link?url=token">人力资源科技公司“今日人才”完成A轮融资 - 36氪</a></h3><div class="c-abstract">深圳今日人才信息科技有限公司完成A轮融资。</div></div><div class="result"><h3><a href="https://baike.baidu.com/item/人力资源">人力资源 - 百度百科</a></h3><div class="c-abstract">招聘知识百科。</div></div><div class="result"><h3><a href="https://news.example/report.pdf">A轮融资事件汇总.pdf</a></h3><div class="c-abstract">融资数据统计与报告下载。</div></div>`;
  const baiduResults = _test.parseBaiduResults(baiduHtml);
  assert.equal(baiduResults.length,3); assert.equal(baiduResults[0].url,'http://www.baidu.com/link?url=token');
  const sogouHtml = `<div class="vrwrap"><h3 class="vr-title"><a href="/link?url=sogou-token">人力资源服务机构“企来科技”完成A轮融资</a></h3><div id="cacheresult_summary_1">内蒙古企来科技有限公司完成2000万人民币A轮融资。</div><div class="r-sech ext_query" data-url="https://e/qilai"></div></div><div class="vrwrap"><h3 class="vr-title"><a href="/link?url=other-token">今日人才完成A轮与A+轮融资</a></h3><div id="cacheresult_summary_2">深圳今日人才信息科技有限公司完成融资。</div></div>`;
  const sogouResults = _test.parseSogouResults(sogouHtml);
  assert.equal(sogouResults.length,2); assert.equal(sogouResults[0].url,'https://e/qilai');
  assert.equal(sogouResults[1].url,'https://www.sogou.com/link?url=other-token'); assert(sogouResults[0].summary.includes('企来科技'));
  const soHtml = `<ul><li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=token" data-mdurl="https://e/jinri">人力资源科技公司今日人才完成A轮融资</a></h3><span data-result-summary>深圳今日人才信息科技有限公司完成融资。</span></li><li class="res-list"><a>其他人还搜了</a></li><li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=foreign" data-mdurl="https://e/foreign">美国HR科技企业融资</a></h3><span class="res-list-summary">美国融资线索。</span></li></ul>`;
  const soResults = _test.parseSoResults(soHtml);
  assert.equal(soResults.length,2); assert.equal(soResults[0].url,'https://e/jinri'); assert.equal(soResults[1].url,'https://e/foreign');
  assert(soResults[0].summary.includes('深圳今日人才'));
  const schoolFiltered = await (async () => {
    global.fetch = async url => url.startsWith('https://www.baidu.com/s') || url.startsWith('https://www.sogou.com/web')
      ? response('<html></html>')
      : url.startsWith('https://www.so.com/s?')
        ? response(`<li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=school" data-mdurl="https://research.example.edu.cn/event">高校会展研究项目</a></h3><span data-result-summary>会展活动运营科技研究。</span></li><li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=token" data-mdurl="https://e/company">星河科技会展系统</a></h3><span data-result-summary>星河科技提供会展运营软件。</span></li>`)
        : response(bingHtml);
    return _test.searchPublicWeb('会展运营科技企业', {limit:5});
  })();
  assert.equal(schoolFiltered.length,1);
  assert.equal(schoolFiltered[0].url,'https://e/company');
  global.fetch = async url => url.startsWith('https://www.baidu.com/s') ? response('<html></html>') : url.startsWith('https://www.sogou.com/web')
    ? response(`<h3 class="vr-title"><a href="https://baike.baidu.com/item/china">中华人民共和国</a></h3><div id="cacheresult_summary_1">中国位于亚洲东部。</div>`)
    : url.startsWith('https://www.so.com/s?') ? response(`<li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=token" data-mdurl="https://e/360-company">星河科技招聘产品升级</a></h3><span data-result-summary>星河科技提供招聘软件。</span></li>`)
      : response(bingHtml);
  const domesticSearch = await _test.searchPublicWeb('中国招聘初创企业', { limit: 5 });
  assert.equal(domesticSearch.provider, '360搜索');
  assert.equal(domesticSearch.length, 1);
  assert.equal(domesticSearch[0].url, 'https://e/360-company');
  global.fetch = async url => url.startsWith('https://www.baidu.com/s') ? response('<html></html>') : url.startsWith('https://www.sogou.com/web')
    ? response(`<h3 class="vr-title"><a href="https://e/shared">星河科技招聘产品升级</a></h3><div id="cacheresult_summary_1">星河科技提供招聘软件。</div>`)
    : url.startsWith('https://www.so.com/s?')
      ? response(`<li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=token" data-mdurl="https://e/shared">星河科技招聘产品升级</a></h3><span data-result-summary>星河科技提供招聘软件。</span></li><li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=token" data-mdurl="https://e/second">星河科技完成A轮融资</a></h3><span data-result-summary>星河科技完成人力资源科技产品的A轮融资。</span></li>`)
      : response('unexpected fallback', 500);
  const mergedSearch = await _test.searchPublicWeb('中国招聘初创企业', { limit: 5 });
  assert.equal(mergedSearch.provider, '搜狗 + 360搜索');
  assert.equal(mergedSearch.length, 2);
  assert.equal(mergedSearch[0].url, 'https://e/shared');
  assert.equal(mergedSearch[1].url, 'https://e/second');
  global.fetch = async url => url.startsWith('https://www.baidu.com/s') || url.startsWith('https://www.sogou.com/web') || url.startsWith('https://www.so.com/s?')
    ? response('blocked', 503)
    : url.startsWith('https://www.bing.com/search') ? response(bingHtml)
      : response('<a href="https://e/brave-company" class="title">星河科技完成A轮融资，招聘产品升级</a><div class="description">星河科技完成A轮融资并升级招聘产品。</div>');
  const fallbackSearch = await _test.searchPublicWeb('中国招聘初创企业', { limit: 5 });
  assert.equal(fallbackSearch.provider, 'Bing');
  assert.equal(fallbackSearch.length, 1);
  assert.equal(fallbackSearch[0].url, 'https://e/bing-company');
  configure([{}]);
  const plans = [], analysed = new Set(); let gapSearches = 0;
  global.fetch = async (url, options = {}) => {
    if (url.startsWith('https://test/source')) return response(feed());
    if (url.startsWith('https://www.baidu.com/s') || url.startsWith('https://www.sogou.com/web') || url.startsWith('https://www.so.com/s?') || url.startsWith('https://lite.duckduckgo.com') || url.startsWith('https://www.bing.com/search') || url.startsWith('https://search.brave.com/search')) {
      const parsedUrl = new URL(url);
      const query = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query');
      const id = (query.match(/dir_[a-z_]+/) || [query])[0];
      const directionTerms = { dir_hr:'招聘', dir_workforce:'用工管理', dir_people_analytics:'人力资本', dir_genai_hr:'智能招聘', dir_event:'会展', dir_ticketing:'票务', dir_venue:'场馆', dir_sport:'体育赛事', dir_ai:'自动化', dir_training:'职业培训', dir_enterprise:'企业服务', dir_trade:'跨境贸易', dir_supply_chain:'供应链' };
      const term = directionTerms[id] || '招聘';
      if (!query.includes('补搜') && id === 'dir_venue') return response('<html></html>');
      if (query.includes('补搜')) gapSearches++;
      if (url.startsWith('https://www.baidu.com/s')) return response(`<h3><a href="http://www.baidu.com/link?url=token">公司${id} ${term}相关产品</a></h3><div class="c-abstract">公司${id} 为 ${term} 方向提供专门的软件产品。</div>`);
      if (url.startsWith('https://www.sogou.com/web')) return response(`<h3 class="vr-title"><a href="/link?url=token">公司${id} ${term}相关产品</a></h3><div id="cacheresult_summary_1">公司${id} 为 ${term} 方向提供专门的软件产品。</div><div data-url="https://e/${id}"></div>`);
      if (url.startsWith('https://www.so.com/s?')) return response(`<li class="res-list"><h3 class="res-title"><a href="https://www.so.com/link?m=token" data-mdurl="https://e/${id}">公司${id} ${term}相关产品</a></h3><span data-result-summary>公司${id} 为 ${term} 方向提供专门的软件产品。</span></li>`);
      if (url.startsWith('https://lite.duckduckgo.com')) return response(`<a href="https://e/${id}" class="result-link">公司${id} ${term}相关产品</a><td class="result-snippet">公司${id} 为 ${term} 方向提供专门的软件产品。</td>`);
      if (url.startsWith('https://www.bing.com/search')) return response(`<li class="b_algo"><h2><a href="https://e/${id}">公司${id} ${term}相关产品</a></h2><p>公司${id} 为 ${term} 方向提供专门的软件产品。</p></li>`);
      return response(`<a href="https://e/${id}" class="title">公司${id} ${term}相关产品</a><div class="description">公司${id} 为 ${term} 方向提供专门的软件产品。</div>`);
    }
    const request = JSON.parse(options.body);
    const userInput = JSON.parse(request.messages[1].content);
    let output;
    if (userInput.directions) {
      plans.push(...userInput.directions);
      output={searches:userInput.directions.map(d=>({directionId:d.id,query:d.id}))};
    } else {
      const direction = userInput.knownDirections[0];
      const evidence = userInput.signals[0];
      const firstGap = direction.id==='dir_ticketing' && !analysed.has(direction.id);
      analysed.add(direction.id);
      output={ directions:[{id:direction.id,name:direction.name,evidenceIds:[evidence.id],summary:'具体产业方向'}], companies:firstGap?[]:[{name:evidence.title.split(' ')[0],directionId:direction.id,evidenceIds:[evidence.id],summary:'来源支持的企业线索',synergyLevel:'高'}], threats:[], nextSearchQuery:'补搜 '+direction.id };
    }
    return response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
  };
  const aiDiscovered = await collectAndBuild({now:NOW});
  assert.equal(aiDiscovered.mode,'ai'); assert.equal(plans.length,13);
  assert.equal(aiDiscovered.directions.length,13);
  assert.equal(aiDiscovered.companies.length,13);
  assert(aiDiscovered.directions.every(d=>d.candidateCount>=1));
  assert(aiDiscovered.companies.every(c=>c.provenance.selection==='AI 筛选' && c.synergyLevel==='待核实' && c.aiSynergyLevel==='高'));
  assert(gapSearches>=1); assert(aiDiscovered.aiActivity.searches.some(s=>s.phase==='候选缺口补搜'));
  assert.equal(aiDiscovered.aiActivity.completed,true);
  assert.equal(aiDiscovered.aiActivity.analysedSignalCount,13);
  assert(aiDiscovered.signals.every(s=>s.publishedAt===null));
  assert(aiDiscovered.sourceResults.some(s=>s.id==='ai-web-search'));
  const matureSignal=finance('large','Workday provides HR software');
  const noLarge=_test.sanitizeAI({directions:[],companies:[{name:'Workday',directionId:aiBase.directions[0].id,evidenceIds:['large']}],threats:[]},{...aiBase,signals:[matureSignal]});
  assert.equal(noLarge.companies.length,0);
  const foreignSignal=finance('foreign','Firstwork Raises Series A for HR hiring in New York');
  const noForeign=_test.sanitizeAI({directions:[],companies:[{name:'Firstwork',directionId:aiBase.directions[0].id,evidenceIds:['foreign'],region:'New York'}],threats:[]},{...aiBase,signals:[foreignSignal]});
  assert.equal(noForeign.companies.length,0);
  const foreignBaseCompany = [{name:'Firstwork',directionId:aiBase.directions[0].id,evidenceIds:['foreign'],candidateType:'早期融资候选',fundingStatus:'已识别'}];
  const noForeignFallback=_test.sanitizeAI({directions:[],companies:[],threats:[]},{...aiBase,signals:[foreignSignal],companies:foreignBaseCompany});
  assert.equal(noForeignFallback.companies.length,0);
  assert.equal(_test.makeCompanies([foreignSignal]).length,0);
  const domesticSignal=finance('domestic','上海星火科技完成A轮融资，招聘软件升级');
  const domestic=_test.sanitizeAI({directions:[],companies:[{name:'上海星火科技',directionId:aiBase.directions[0].id,evidenceIds:['domestic']}],threats:[]},{...aiBase,signals:[domesticSignal]});
  assert.equal(domestic.companies[0].region,'上海');
  assert.equal(domestic.companies[0].screeningStatus,'符合早期轮次优先口径');
  const genericSignal=finance('generic','找场地发布智慧场馆管理系统，服务大型展馆');
  const noGeneric=_test.sanitizeAI({directions:[],companies:[{name:'找场地',directionId:aiBase.directions[0].id,evidenceIds:['generic']}],threats:[]},{...aiBase,signals:[genericSignal]});
  assert.equal(noGeneric.companies.length,0);
  console.log('PASS: XML/Atom, Crossref dates, dedup/window, source timeout/HTML/size, all-source failure, cancellation, company identity and round, AI evidence/metadata, search parsing/filtering/provider merge/fallback');
}
main().finally(() => { SOURCES.splice(0,SOURCES.length,...savedSources); global.fetch=savedFetch; for(const [key,value] of Object.entries(savedEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;} }).catch(e=>{console.error(e);process.exitCode=1;});
