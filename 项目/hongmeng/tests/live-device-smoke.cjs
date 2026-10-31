const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const hdc = '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc';
const target = process.env.HDC_TARGET || '127.0.0.1:5555';
const bundle = 'pcTest.com.myapplication';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-live-smoke-'));
const checks = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = (...args) => execFileSync(hdc, ['-t', target, ...args], { encoding: 'utf8', timeout: 20000 });
function flatten(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (node.attributes) output.push(node.attributes);
  for (const child of node.children || []) flatten(child, output);
  return output;
}
async function layout() {
  await wait(400);
  run('shell', 'uitest', 'dumpLayout', '-p', '/data/local/tmp/radar-live-smoke.json', '-b', bundle);
  const file = path.join(dir, 'layout.json');
  run('file', 'recv', '/data/local/tmp/radar-live-smoke.json', file);
  return flatten(JSON.parse(fs.readFileSync(file, 'utf8')));
}
async function click(predicate) {
  const node = (await layout()).find(predicate);
  assert.ok(node, 'Expected control missing');
  const b = node.bounds.match(/-?\d+/g).map(Number);
  run('shell', 'uitest', 'uiInput', 'click', String(Math.round((b[0]+b[2])/2)), String(Math.round((b[1]+b[3])/2)));
}
const mobileLabels = { '发现比赛': '发现', '我的收藏': '收藏', '报名计划': '计划', '更新设置': '更新', '偏好设置': '偏好' };
const text = value => node => node.text === value || node.text === mobileLabels[value];
const id = value => node => node.id === value;
async function reveal(controlId) {
  for (let i=0; i<8; i++) {
    const nodes = await layout();
    const control = nodes.find(id(controlId));
    const scroll = nodes.find(id('detailScroll'));
    assert.ok(scroll, 'Detail scroller missing');
    const b = scroll.bounds.match(/-?\d+/g).map(Number);
    if (control) {
      const c = control.bounds.match(/-?\d+/g).map(Number);
      if (c[1] >= b[1] && c[3] <= b[3] && c[3] > c[1]) return;
    }
    run('shell', 'uitest', 'uiInput', 'swipe', String(Math.round((b[0]+b[2])/2)), String(b[3]-35),
      String(Math.round((b[0]+b[2])/2)), String(b[1]+35), '700');
  }
  throw new Error('Could not reveal ' + controlId);
}
async function check(label, predicate) {
  const nodes = await layout();
  assert.ok(predicate(nodes), label + '\n' + JSON.stringify(nodes.filter(n => n.id || n.text).map(n => ({id:n.id,text:n.text}))));
  checks.push(label); console.log('PASS ' + label);
}
async function restart() {
  run('shell', 'aa', 'force-stop', bundle);
  run('shell', 'aa', 'start', '-a', 'EntryAbility', '-b', bundle);
  await wait(800);
}
(async () => {
  let chosen, originalFavorite, originalPlan, createdNote = false;
  try {
    await click(text('发现比赛'));
    await click(id('refreshButton'));
    for (let i=0; i<25; i++) {
      const nodes = await layout();
      if (nodes.find(id('refreshButton'))?.enabled === 'true') break;
      await wait(600);
    }
    await check('Both domestic sources update successfully', nodes => nodes.some(n => n.text.includes('2/2 个国内来源更新成功')));
    await click(text('近期赛程'));
    await check('Upcoming filter displays domestic scheduled events', nodes => nodes.some(n => n.id.startsWith('detail-nc-')));
    const nodes = await layout();
    chosen = nodes.find(n => n.id.startsWith('detail-')).id.slice(7);
    originalFavorite = nodes.find(id('favorite-' + chosen)).text === '★';
    if (!originalFavorite) await click(id('favorite-' + chosen));
    await click(text('我的收藏'));
    await check('Favorite is available in favorites view', nodes => nodes.some(id('detail-' + chosen)));
    await click(id('detail-' + chosen));
    await check('Details disclose official source and opening time', nodes => nodes.some(id('officialLinkButton')) && nodes.some(n => n.text.includes('开赛（北京时间）')));
    originalPlan = (await layout()).find(id('planButton')).text === '移出计划';
    if (!originalPlan) await click(id('planButton'));
    await check('Official event can be added to personal plan', nodes => nodes.find(id('planButton')).text === '移出计划');
    await click(text('关闭'));
    await restart();
    await click(text('我的收藏'));
    await check('Favorites and catalog survive process restart', nodes => nodes.some(id('detail-' + chosen)));
    await click(text('报名计划'));
    await check('Plans survive process restart', nodes => nodes.some(id('detail-' + chosen)));
    await click(id('detail-' + chosen));
    await reveal('noteTemplateButton');
    if ((await layout()).find(id('noteTemplateButton'))?.enabled === 'true') {
      await click(id('noteTemplateButton'));
      await click(text('关闭'));
      await check('Unsaved notes require explicit discard confirmation', nodes => nodes.some(text('记录尚未保存')));
      await click(text('继续编辑'));
      await reveal('saveNoteButton');
      await click(id('saveNoteButton'));
      createdNote = true;
      await reveal('noteStatus');
      await check('Project outline saves successfully', nodes => nodes.some(n => n.text.startsWith('已保存于')));
      await click(text('关闭'));
      await restart();
      await click(text('报名计划'));
      await click(id('detail-' + chosen));
      await reveal('projectNoteInput');
      await check('Project text survives process restart', nodes => nodes.find(id('projectNoteInput'))?.text.includes('目标与个人职责：'));
      await reveal('clearNoteButton');
      await click(id('clearNoteButton'));
      await check('Deleting a note requires confirmation', nodes => nodes.some(text('清除这场比赛的记录？')));
      await click(text('确认清除'));
      createdNote = false;
      await reveal('noteStatus');
      await check('Test note is removed without changing plan', nodes => nodes.some(text('记录已清除')) && nodes.find(id('planButton')).text === '移出计划');
      await check('Programmatic clear does not mark the empty note dirty', nodes => !nodes.some(text('有未保存的修改')));
    }
    await click(text('关闭'));
    await check('Detail closes after a clean note reset', nodes => !nodes.some(id('detailScroll')));
    await click(text('发现比赛'));
    await click(text('官方公告'));
    await check('Announcements are explicitly distinct from registration status', nodes => nodes.some(n => n.text === '官方公告 · 非报名状态'));
    await click(text('更新设置'));
    await check('Daily scheduling controls explain foreground and background limitations', nodes => nodes.some(id('dailyToggle')) &&
      nodes.some(n => n.text.includes('关闭应用或设备休眠时不保证准点执行')));
    await click(text('偏好设置'));
    for (let i=0; i<12; i++) {
      const nodes = await layout();
      if (nodes.some(n => n.text.includes('不会上传你的笔记'))) break;
      const b = nodes.find(id('settingsScroll')).bounds.match(/-?\d+/g).map(Number);
      run('shell', 'uitest', 'uiInput', 'swipe', String(Math.round((b[0]+b[2])/2)), String(b[3]-35),
        String(Math.round((b[0]+b[2])/2)), String(b[1]+35), '900');
    }
    await check('Privacy and local-record information is reachable by scrolling', nodes => nodes.some(n => n.text.includes('不会上传你的笔记')));
  } finally {
    if (chosen) {
      try {
        if (createdNote) {
          await reveal('clearNoteButton');
          await click(id('clearNoteButton'));
          await click(text('确认清除'));
        }
        if ((await layout()).some(id('planButton'))) await click(text('关闭'));
        await click(text('我的收藏'));
        await click(id('detail-' + chosen));
        if (originalPlan === false && (await layout()).find(id('planButton')).text === '移出计划') await click(id('planButton'));
        await click(text('关闭'));
        if (originalFavorite === false && (await layout()).find(id('favorite-' + chosen)).text === '★') await click(id('favorite-' + chosen));
      } catch (error) { console.error('Cleanup failed: ' + error.message); process.exitCode=1; }
    }
    await restart();
    console.log(JSON.stringify({ target, checks, skipped: ['Text input requires user-controlled input-method first-use consent'], artifacts: dir }));
  }
})().catch(error => { console.error(error); process.exitCode=1; });
