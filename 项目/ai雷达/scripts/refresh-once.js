'use strict';
const { pool } = require('../server/db');
const { runRefresh, stopScheduler } = require('../server/routes/intelligence');
const store = require('../server/intelligence/store');
(async()=>{
  await runRefresh({reason:'deployment-verification'});
  const s=await store.latestSnapshot();
  if(!s) throw new Error('No snapshot saved');
  console.log(JSON.stringify({id:s.id,mode:s.mode,counts:s.counts,directions:s.directions.length,companies:s.companies.length,threats:s.threats.length,sources:s.sourceResults.map(x=>({name:x.name,status:x.status,count:x.count,eligible:x.eligibleCount})),warnings:s.warnings},null,2));
})().catch(e=>{console.error('REFRESH_FAILED',e.code||e.message);process.exitCode=1;}).finally(async()=>{await stopScheduler();await pool.end();});
