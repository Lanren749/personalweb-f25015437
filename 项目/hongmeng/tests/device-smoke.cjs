const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const hdc = process.env.HDC_PATH || '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc';
const target = process.env.HDC_TARGET || '127.0.0.1:5555';
const bundle = 'pcTest.com.myapplication';
const checks = [];
const skipped = [];
const skipInput = process.env.SKIP_INPUT === '1';
const tempDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'career-radar-ui-'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = (...args) => execFileSync(hdc, ['-t', target, ...args], { encoding: 'utf8', timeout: 15000 });
function flatten(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (node.attributes) output.push(node.attributes);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => flatten(item, output));
    else if (value && typeof value === 'object') flatten(value, output);
  }
  return output;
}
async function layout() {
  await wait(500);
  run('shell', 'uitest', 'dumpLayout', '-p', '/data/local/tmp/career-radar-smoke-layout.json', '-b', bundle);
  const localPath = path.join(tempDirectory, 'layout.json');
  run('file', 'recv', '/data/local/tmp/career-radar-smoke-layout.json', localPath);
  return flatten(JSON.parse(fs.readFileSync(localPath, 'utf8')));
}
function center(node) {
  assert.ok(node, 'Expected UI control not found');
  const bounds = node.bounds.match(/-?\d+/g).map(Number);
  return [Math.round((bounds[0] + bounds[2]) / 2).toString(), Math.round((bounds[1] + bounds[3]) / 2).toString()];
}
async function clickNode(predicate) {
  const nodes = await layout();
  run('shell', 'uitest', 'uiInput', 'click', ...center(nodes.find(predicate)));
}
const text = (value, type) => node => node.text === value && (!type || node.type === type);
const id = value => node => node.id === value;
const clickText = (value, type) => clickNode(text(value, type));
async function input(controlId, value) {
  const node = (await layout()).find(id(controlId));
  run('shell', 'uitest', 'uiInput', 'click', ...center(node));
  await wait(250);
  run('shell', 'uitest', 'uiInput', 'text', value);
  await wait(350);
}
async function check(name, predicate) {
  const nodes = await layout();
  if (!predicate(nodes)) {
    console.error(JSON.stringify(nodes.filter(n => n.id || n.type === 'SearchField' || n.text).map(n => ({ id: n.id, type: n.type, text: n.text }))));
  }
  assert.ok(predicate(nodes), name);
  checks.push(name);
  console.log('PASS ' + name);
}
async function restart() {
  run('shell', 'aa', 'force-stop', bundle);
  run('shell', 'aa', 'start', '-a', 'EntryAbility', '-b', bundle);
  await wait(600);
}
(async () => {
  let originalFavorite;
  let originalPlan;
  try {
    await clickText('发现比赛');
    const initialNodes = await layout();
    const initialButton = initialNodes.find(id('favorite-demo-software'));
    assert.ok(initialButton, JSON.stringify(initialNodes.filter(n => n.id || n.text).map(n => ({ id: n.id, text: n.text, bounds: n.bounds }))));
    originalFavorite = initialButton.text === '★';
    if (skipInput) {
      skipped.push('Device text entry blocked by initial input method consent screen; pure search logic covered separately');
    } else {
    await input('competitionSearch', 'ArkTS');
    await check('Search by skill returns one matching competition', nodes =>
      nodes.some(id('detail-demo-software')) && !nodes.some(id('favorite-demo-ai')) && nodes.some(text('1 项')));
    await clickText('发现比赛');
    await input('competitionSearch', 'zz-no-such-event');
    await check('No-match search renders a helpful empty state', nodes => nodes.some(text('没有找到匹配的比赛')));
    await clickText('清除筛选', 'Button');
    await check('Clear filters restores the list', nodes => nodes.some(text('5 项')));
    }
    await clickText('已截止', 'Button');
    await check('Expired filter displays the expired record only', nodes =>
      nodes.some(id('detail-demo-algorithm')) && !nodes.some(id('detail-demo-software')));
    await clickNode(id('detail-demo-algorithm'));
    await check('Expired event cannot be added to a plan', nodes => nodes.find(id('planButton')).enabled === 'false');
    await clickText('关闭', 'Button');
    await clickText('全部', 'Button');
    if (!originalFavorite) await clickNode(id('favorite-demo-software'));
    await check('Favorite button updates immediately', nodes => nodes.find(id('favorite-demo-software')).text === '★');
    await clickText('我的收藏');
    await check('Favorites navigation displays the saved event', nodes => nodes.some(id('detail-demo-software')));
    await clickNode(id('detail-demo-software'));
    const plan = (await layout()).find(id('planButton'));
    originalPlan = plan.text === '移出计划';
    assert.equal(plan.enabled, 'true', 'Demo event must not be expired for this smoke test');
    if (!originalPlan) await clickNode(id('planButton'));
    await check('Add plan updates the detail action', nodes => nodes.find(id('planButton')).text === '移出计划');
    await clickText('关闭', 'Button');
    await clickText('报名计划');
    await check('Plan navigation displays the planned event', nodes => nodes.some(id('detail-demo-software')));
    await restart();
    await check('Favorite persists after process restart', nodes => nodes.find(id('favorite-demo-software')).text === '★');
    await clickText('报名计划');
    await check('Plan persists after process restart', nodes => nodes.some(id('detail-demo-software')));
    await clickText('更新设置');
    await check('Update page states online search is not enabled', nodes => nodes.some(text('数据源尚未接入')) && nodes.some(id('updateTimeInput')));
    if (!skipInput) {
    await input('updateTimeInput', '25:61');
    await clickText('保存时间', 'Button');
    await check('Invalid time does not replace saved setting', nodes => !nodes.some(text('当前偏好：每天 25:61（未启用）')));
    }
    await clickText('偏好设置');
    await check('Preferences navigation renders editable categories', nodes => nodes.some(text('我的技能方向')) && nodes.some(text('查看这个方向的比赛')));
    const preferenceNodes = await layout();
    const selectedPreference = preferenceNodes.find(n => n.type === 'Button' && n.backgroundColor.toUpperCase() === '#FF3366FF' &&
      ['全部方向', '软件开发', '人工智能', '网络安全', '算法竞赛', '创新创业'].includes(n.text));
    await clickText('查看这个方向的比赛', 'Button');
    await check('Preference action applies the direction filter', nodes => nodes.some(n => n.type === 'Select' && n.text === (selectedPreference ? selectedPreference.text : '软件开发')));
  } finally {
    // Remove only the temporary favorite/plan added by this test.
    try {
      await clickText('发现比赛');
      if (originalPlan === false) {
        await clickNode(id('detail-demo-software'));
        if ((await layout()).find(id('planButton')).text === '移出计划') await clickNode(id('planButton'));
        await clickText('关闭', 'Button');
      }
      if (originalFavorite === false && (await layout()).find(id('favorite-demo-software')).text === '★') {
        await clickNode(id('favorite-demo-software'));
      }
      await restart();
    } catch (error) {
      console.error('Test state cleanup requires attention: ' + error.message);
      process.exitCode = 1;
    }
    const report = path.resolve(__dirname, '../.recovery/2026-10-18-before-optimization/device-smoke.json');
    fs.writeFileSync(report, JSON.stringify({ target, checks, skipped, checkedAt: new Date().toISOString() }, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
