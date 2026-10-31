export async function requestText(url, { body, key, signal, fetchImpl = fetch, timeout = 20000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const headers = { Accept: 'application/json,text/html', 'User-Agent': 'CareerRadar/1.0 (personal competition reader)' };
    if (key) headers.Authorization = 'Bearer ' + key;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', headers,
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error('上游接口返回 HTTP ' + response.status); error.status = response.status; throw error;
    }
    if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) { await response.body?.cancel(); throw new Error('上游响应过大'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; if (size > 2 * 1024 * 1024) { controller.abort(); throw new Error('上游响应过大'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
