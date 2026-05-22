/**
 * Claude API 直连适配器
 *
 * 通过 HTTP 直接调用 Claude API（兼容 OpenAI 格式），
 * 替代 spawn(claude CLI) 方案，消除进程冷启动延迟。
 *
 * 配置来源 config.claude:
 *   - api_key:    API 密钥（.env 中的 CLAUDE_API_KEY）
 *   - base_url:   API 端点（.env 中的 CLAUDE_BASE_URL）
 *   - model:      模型名称，默认 claude-sonnet-4-6
 *   - timeout_ms: 超时时间，默认 30000
 *   - max_tokens: 最大输出 token，默认 2000
 */

/**
 * @param {string} systemPrompt  — 完整系统提示词
 * @param {string} userMessage   — 用户当前消息
 * @param {object} config        — config.json 的 claude 配置段
 * @returns {Promise<{say:string, play:Array, reason:string, segue:string}>}
 */
async function callClaude(systemPrompt, userMessage, config = {}) {
  const apiKey = config.api_key || process.env.CLAUDE_API_KEY;
  const baseUrl = config.base_url || process.env.CLAUDE_BASE_URL || "https://api.anthropic.com";
  const model = config.model || "claude-sonnet-4-6";
  const maxTokens = config.max_tokens || 2000;
  const timeoutMs = config.timeout_ms || 30000;

  if (!apiKey || apiKey.startsWith("sk-你的")) {
    throw new Error("Claude API Key 未配置");
  }

  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage || "请根据当前环境推荐音乐" },
    ],
    max_tokens: maxTokens,
    temperature: 0.8,
  };

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: new TextEncoder().encode(JSON.stringify(body)),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Claude API 返回 ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  // 解析 JSON 输出
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // 尝试提取 JSON 块
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* fall through */ }
    }
    if (!parsed) {
      throw new Error(`Claude API 返回非 JSON: ${content.slice(0, 300)}`);
    }
  }

  return {
    say: parsed.say || "",
    play: parsed.play || [],
    reason: parsed.reason || "",
    segue: parsed.segue || "",
  };
}

module.exports = { callClaude };
