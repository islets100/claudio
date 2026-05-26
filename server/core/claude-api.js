/**
 * Claude API 直连适配器
 *
 * 通过 HTTP 直接调用 Claude API（兼容 OpenAI 格式）。
 * 支持流式 (SSE) 和非流式两种模式。
 */

/**
 * 流式调用 Claude，逐 chunk 回调
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {object} config
 * @param {function} onChunk  — 每收到一段文字时回调 (deltaText)
 * @param {function} onDone   — 流结束后回调 (parsedResult)
 */
async function callClaudeStream(systemPrompt, userMessage, config = {}, onChunk, onDone) {
  const apiKey = config.api_key || process.env.CLAUDE_API_KEY;
  const baseUrl = config.base_url || process.env.CLAUDE_BASE_URL || "https://api.anthropic.com";
  const model = config.model || "claude-sonnet-4-6";
  const maxTokens = config.max_tokens || 2000;
  const timeoutMs = config.timeout_ms || 60000;

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
    stream: true,
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

  // 读取流式响应体
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

  // 简易状态机：只提取 "say" 字段的值做流式输出
  let sayBuf = "";       // 累积的 say 值
  let sayState = 0;      // 0=寻找"say", 1=找到say key等冒号, 2=等引号, 3=在say值内
  let sayKeyPos = 0;
  const SAY_KEY = '"say"';
  let prevCh = "";       // 用于检测转义

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") continue;

        try {
          const chunk = JSON.parse(dataStr);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (!delta) continue;
          fullContent += delta;

          // 用状态机从 delta 中提取 say 值
          for (let i = 0; i < delta.length; i++) {
            const ch = delta[i];
            if (sayState === 0) {
              // 寻找 "say" 关键字
              if (ch === SAY_KEY[sayKeyPos]) {
                sayKeyPos++;
                if (sayKeyPos === SAY_KEY.length) sayState = 1; // 找到了 "say"
              } else {
                sayKeyPos = 0;
              }
            } else if (sayState === 1) {
              // 跳过冒号前的空白
              if (ch === ":") sayState = 2;
            } else if (sayState === 2) {
              // 跳过冒号后的空白，找开引号
              if (ch === '"') { sayState = 3; prevCh = ""; continue; }
            } else if (sayState === 3) {
              // 在 say 值内部
              if (ch === '"' && prevCh !== '\\') {
                sayState = 4; // 未转义的引号 = say 值结束
              } else {
                sayBuf += ch;
                onChunk(ch);
              }
            }
            prevCh = ch;
          }
        } catch { /* 跳过无法解析的行 */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // 解析完整 JSON 结果
  let parsed;
  try {
    parsed = JSON.parse(fullContent);
  } catch {
    const match = fullContent.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* fall through */ }
    }
    if (!parsed) {
      parsed = { say: fullContent, play: [], reason: "", segue: "" };
    }
  }

  const result = {
    say: parsed.say || "",
    play: parsed.play || [],
    reason: parsed.reason || "",
    segue: parsed.segue || "",
  };
  onDone(result);
}

/**
 * 非流式调用（向后兼容）
 */
async function callClaude(systemPrompt, userMessage, config = {}) {
  return new Promise((resolve, reject) => {
    let fullText = "";
    callClaudeStream(
      systemPrompt, userMessage, config,
      () => {}, // 忽略 chunk
      (result) => resolve(result)
    ).catch(reject);
  });
}

module.exports = { callClaude, callClaudeStream };
