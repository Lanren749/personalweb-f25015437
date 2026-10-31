'use strict';

const { _test } = require('../server/intelligence/pipeline');

const query = process.argv.slice(2).join(' ').trim() || '中国 人力资源科技 A轮 融资';

(async () => {
  const rows = await _test.searchPublicWeb(query, { limit: 10 });
  console.log(JSON.stringify({
    provider: rows.provider,
    query,
    resultCount: rows.length,
    examples: rows.slice(0, 5).map(({ title, url, summary }) => ({ title, url, summary }))
  }, null, 2));
})().catch(error => {
  console.error('SEARCH_PREFLIGHT_FAILED ' + error.message);
  process.exitCode = 1;
});
