'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../server/db');
const store = require('../server/intelligence/store');
const { sign } = require('../server/auth');
const port = Number(process.env.VERIFY_PORT || 3212);
(async () => {
  await store.ensureSchema();
  const [[users]] = await pool.query('SELECT COUNT(*) AS total FROM users');
  assert(users.total > 0, 'No existing users');
  const [admins] = await pool.query("SELECT id, username, role, display_name FROM users WHERE role='admin' ORDER BY id LIMIT 1");
  assert(admins.length, 'No existing admin');
  const u = admins[0];
  // Short-lived localhost-only verification; never print or persist the token.
  const token = sign({uid:u.id,username:u.username,role:u.role,displayName:u.display_name},60);
  const base = 'http://127.0.0.1:'+port;
  const health = await fetch(base+'/api/health');
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
  assert.equal((await fetch(base+'/api/intelligence/dashboard')).status,401);
  const response = await fetch(base+'/api/intelligence/dashboard',{headers:{Authorization:'Bearer '+token}});
  assert.equal(response.status,200);
  const d = await response.json();
  assert(Array.isArray(d.history));
  const html = await (await fetch(base+'/')).text();
  assert(html.includes('owner-20261023-cn-search-5'));
  assert(html.includes('AI 推荐 · 等待负责人确认'));
  assert(html.includes('AI 识别 / AI 筛选 / AI 生成 / AI 初判'));
  const pipeline = fs.readFileSync(path.join(__dirname, '../server/intelligence/pipeline.js'), 'utf8');
  assert(pipeline.includes("provider: '搜狗'"), 'Sogou search is missing');
  assert(pipeline.includes("provider: '360搜索'"), '360 search fallback is missing');
  assert(pipeline.includes("provider: 'Bing'"), 'Bing fallback is missing');
  for (const asset of ['api.js','app.js','owner-components.js','owner.css']) {
    assert.equal((await fetch(base+'/assets/'+asset)).status,200);
  }
  console.log(JSON.stringify({health:'PASS',auth:'PASS',dashboard:'PASS',assets:'PASS',usersPreserved:users.total,aiConfigured:d.settings.aiConfigured,schedule:d.settings.schedule,snapshot:d.snapshot?{id:d.snapshot.id,mode:d.snapshot.mode,signals:d.snapshot.signals.length,companies:d.snapshot.companies.length}:null,job:d.job.status}));
})().catch(e=>{console.error('RELEASE_CHECK_FAILED',e.message);process.exitCode=1;}).finally(()=>pool.end());
