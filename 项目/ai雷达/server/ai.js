/* AI 网关客户端：调用本地配置的 OpenAI 兼容服务（默认 DeepSeek 模型）
 * 注意：该模型先输出 reasoning_content 再输出 content，max_tokens 必须给足 */
const AI_URL = process.env.AI_URL || 'http://127.0.0.1:3000/api/v1/chat/completions';
const AI_KEY = process.env.AI_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'deepseek-v4-pro';

async function chat(messages, { maxTokens = 4096, temperature = 0.4, timeout = 100000, model } = {}) {
  if (!AI_KEY) throw new Error('AI 网关未配置（.env 缺少 AI_KEY）');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + AI_KEY },
      body: JSON.stringify({ model: model || AI_MODEL, messages, max_tokens: maxTokens, temperature, stream: false }),
      signal: ctrl.signal
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`AI 网关 ${resp.status}：${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('AI 未返回内容（可能 max_tokens 被推理消耗完）');
    return content.trim();
  } finally { clearTimeout(timer); }
}

/* 要求模型输出 JSON 并防御式解析（剥离 ```json 围栏、截取首个 {...}） */
async function chatJSON(system, user, opts = {}) {
  const text = await chat(
    [{ role: 'system', content: system + '\n\n只输出一个合法 JSON 对象，不要输出任何解释、markdown 代码块或其他文字。' },
     { role: 'user', content: user }],
    opts);
  let s = text.replace(/```json|```/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('AI 返回内容不是合法 JSON');
  return JSON.parse(s.slice(a, b + 1));
}

module.exports = { chat, chatJSON, AI_MODEL };
