const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const hdc = '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc';
const target = process.env.HDC_TARGET || '127.0.0.1:5555';
const bundle = 'pcTest.com.myapplication';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-ai-smoke-'));
const run = (...args) => execFileSync(hdc, ['-t', target, ...args], { encoding: 'utf8', timeout: 20000 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const bounds = node => node.bounds.match(/-?[0-9]+/g).map(Number);
const id = value => node => node.id === value;
const text = value => node => node.text === value;
function flatten(node, output = []) {
  if (node.attributes) output.push(node.attributes);
  for (const child of node.children || []) flatten(child, output);
  return output;
}
async function layout() {
  await wait(250);
  run('shell', 'uitest', 'dumpLayout', '-p', '/data/local/tmp/radar-ai-smoke.json', '-b', bundle);
  const file = path.join(dir, 'layout.json');
  run('file', 'recv', '/data/local/tmp/radar-ai-smoke.json', file);
  return flatten(JSON.parse(fs.readFileSync(file, 'utf8')));
}
async function click(predicate) {
  const node = (await layout()).find(predicate);
  assert.ok(node, 'Expected control not found');
  const b = bounds(node);
  run('shell', 'uitest', 'uiInput', 'click', String(Math.round((b[0]+b[2])/2)), String(Math.round((b[1]+b[3])/2)));
}
async function reveal(controlId, scrollId = 'settingsScroll') {
  for (let i=0; i<35; i++) {
    const nodes = await layout();
    const node = nodes.find(id(controlId));
    const scroll = nodes.find(id(scrollId));
    assert.ok(scroll, 'Expected scroller not found: ' + scrollId);
    const b = bounds(scroll);
    if (node) {
      const n = bounds(node);
      const original = node.origBounds ? node.origBounds.match(/-?[0-9]+/g).map(Number) : n;
      if (n[1] >= b[1] && n[3] <= b[3] && n[3]-n[1] >= original[3]-original[1]-3 && n[3] > n[1]) return;
    }
    const x = String(Math.round((b[0]+b[2])/2));
    const start = Math.round(b[1]+(b[3]-b[1])*0.65);
    const end = Math.round(b[1]+(b[3]-b[1])*0.40);
    run('shell', 'uitest', 'uiInput', 'swipe', x, String(start), x, String(end), '600');
  }
  throw new Error('Could not reveal ' + controlId);
}
async function check(label, predicate) {
  assert.ok(predicate(await layout()), label);
  checks.push(label);
  console.log('PASS ' + label);
}
async function screenshot(name) {
  const remote = '/data/local/tmp/radar-ai-' + name + '.jpeg';
  run('shell', 'snapshot_display', '-f', remote);
  const destination = path.join(dir, name + '.jpeg');
  run('file', 'recv', remote, destination);
  assert.ok(fs.existsSync(destination) && fs.statSync(destination).size > 1000, 'Screenshot was not captured');
}
async function restart() {
  run('shell', 'aa', 'force-stop', bundle);
  run('shell', 'aa', 'start', '-a', 'EntryAbility', '-b', bundle);
  await wait(500);
}
async function nav(name) {
  const short = { '发现比赛': '发现', '偏好设置': '偏好' }[name];
  await click(node => node.text === name || node.text === short);
}
async function fixtureKeyCheck() {
  // Deliberately invalid, non-secret fixture. Never overwrite an existing credential.
  const fixture = 'sk-radar-validation-not-a-real-key-0001';
  await reveal('deepseekKeyStatus');
  if ((await layout()).find(id('deepseekKeyStatus')).text !== '尚未配置 Key') {
    console.log('SKIP fixture credential test: existing credential left unchanged');
    return;
  }
  let created = false;
  try {
    await reveal('deepseekKeyInput');
    const b = bounds((await layout()).find(id('deepseekKeyInput')));
    run('shell', 'uitest', 'uiInput', 'inputText', String(Math.round((b[0]+b[2])/2)), String(Math.round((b[1]+b[3])/2)), fixture);
    if (target !== '127.0.0.1:5555') run('shell', 'uitest', 'uiInput', 'keyEvent', 'Back');
    await reveal('saveDeepseekKey');
    await click(id('saveDeepseekKey'));
    await check('Fixture credential is accepted by native secure storage', nodes =>
      nodes.find(id('deepseekKeyStatus'))?.text.includes('Key 已安全保存'));
    created = true;
    await reveal('testDeepseekConnection');
    await click(id('testDeepseekConnection'));
    for (let i=0; i<20; i++) {
      if ((await layout()).find(id('testDeepseekConnection'))?.enabled === 'true') break;
      await wait(500);
    }
    await reveal('deepseekKeyStatus');
    await check('Official API rejects invalid fixture without leaking credential', nodes => {
      const status = nodes.find(id('deepseekKeyStatus'))?.text || '';
      return status.includes('Key 无效') && !status.includes(fixture);
    });
    await restart();
    await nav('偏好设置');
    await reveal('deepseekKeyStatus');
    await check('Native secure credential persists after restart without plaintext in input', nodes =>
      nodes.find(id('deepseekKeyStatus'))?.text.includes('Key 已保存在本机安全存储') &&
      !(nodes.find(id('deepseekKeyInput'))?.text || '').includes(fixture));
  } finally {
    if (created) {
      await reveal('deleteDeepseekKey');
      await click(id('deleteDeepseekKey'));
      await click(text('删除'));
      await check('Fixture credential removed through confirmed deletion', nodes =>
        nodes.find(id('deepseekKeyStatus'))?.text.includes('已删除本机 Key'));
      await restart();
      await nav('偏好设置');
      await reveal('deepseekKeyStatus');
      await check('Fixture deletion persists after restart', nodes => nodes.find(id('deepseekKeyStatus'))?.text === '尚未配置 Key');
    }
  }
}
(async () => {
  await restart();
  await check('AI discovery entry exists without replacing fixed sources', nodes => nodes.some(id('aiEntry')) && nodes.some(id('refreshButton')));
  const mobile = (await layout()).some(id('phoneDiscoveryList'));
  if (mobile) {
    await check('Mobile discovery remains one full-height scrolling list', nodes => {
      const b = bounds(nodes.find(id('phoneDiscoveryList')));
      return b[3]-b[1] > bounds(nodes[0])[3]*0.65;
    });
  }
  await click(id('aiEntry'));
  await check('AI page has independent full-page scroller and both research modes', nodes =>
    nodes.some(id('aiResearchScroll')) && nodes.some(id('startAiWeb')) && nodes.some(id('startAiCatalog')));
  await check('Billing, opt-in and limited coverage are disclosed', nodes =>
    nodes.some(n => n.text.includes('不会每天自动调用 AI')));
  await screenshot('ai-page');
  await click(id('aiConfigure'));
  await check('Freeform major, interests and goals replace mandatory categories', nodes =>
    nodes.some(id('careerMajor')) && nodes.some(id('careerInterests')) && nodes.some(id('careerGoals')));
  const profileNodes = await layout();
  const savedMajor = profileNodes.find(id('careerMajor')).text;
  await screenshot('preferences-top');
  await reveal('saveCareerProfile');
  await click(id('saveCareerProfile'));
  await reveal('careerProfileStatus');
  await check('Current profile saves successfully without replacing personal fields', nodes =>
    nodes.find(id('careerProfileStatus'))?.text.includes('已保存到本机'));
  await restart();
  await nav('偏好设置');
  await check('Major persists after process restart', nodes => nodes.find(id('careerMajor'))?.text === savedMajor);
  if (process.env.TEST_FIXTURE_KEY === '1') {
    await fixtureKeyCheck();
    await restart();
    await nav('偏好设置');
  }
  await reveal('deepseekKeyStatus');
  const keyStatus = (await layout()).find(id('deepseekKeyStatus')).text;
  await check('Secure key control and status are present', nodes =>
    nodes.some(id('deepseekKeyInput')) && nodes.some(id('saveDeepseekKey')) && nodes.some(id('deleteDeepseekKey')));
  if (keyStatus === '尚未配置 Key') {
    await check('No-key delete action is disabled', nodes => nodes.find(id('deleteDeepseekKey')).enabled === 'false');
    await reveal('testDeepseekConnection');
    await check('No-key connection test cannot send a request', nodes => nodes.find(id('testDeepseekConnection')).enabled === 'false');
  }
  await reveal('openAiFromPreferences');
  await screenshot('deepseek-settings');
  await click(id('openAiFromPreferences'));
  await check('Preferences can open research page', nodes => nodes.some(id('startAiWeb')));
  if (keyStatus === '尚未配置 Key') {
    await click(id('startAiWeb'));
    await check('Searching without a key stops locally with setup guidance', nodes =>
      nodes.find(id('aiRequestStatus')).text.includes('请先到偏好设置保存'));
  }
  await click(text('返回发现'));
  await check('Returning restores original discovery and filters', nodes => nodes.some(id('aiEntry')) && nodes.some(id('refreshButton')));
  await nav('偏好设置');
  await check('Profile fields remain available after navigation', nodes => nodes.some(id('careerMajor')));
  await nav('发现比赛');
  console.log(JSON.stringify({ target, checks, artifacts: dir, notTested: ['Real paid API call', 'Real API-key entry'] }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
