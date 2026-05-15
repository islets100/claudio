const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

/**
 * 调用 Claude Code CLI 生成 DJ 播报
 *
 * @param {string} systemPrompt  — 完整系统提示词
 * @param {string} userMessage   — 用户当前消息
 * @param {object} config        — 来自 config.json 的 claude 配置段
 * @returns {Promise<{say:string, play:Array, reason:string, segue:string}>}
 */
function callClaude(systemPrompt, userMessage, config = {}) {
  const cliPath = config.cli_path || "claude";
  const timeoutMs = config.timeout_ms || 30000;
  const maxTokens = config.max_tokens || 2000;

  const fullPrompt = `${systemPrompt}\n\n---\n\n用户消息: ${userMessage || "（无额外输入，请根据当前时间、环境和用户品味自主推荐音乐）"}\n\n请按 JSON 格式输出。`;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(cliPath, [
      "-p",
      fullPrompt,
      "--output-format",
      "json",
      "--max-tokens",
      String(maxTokens),
    ], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Claude 子进程超时"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(`Claude 子进程退出码 ${code}: ${stderr}`));
        return;
      }

      try {
        // Claude 返回的 JSON 可能在 result 字段里，也可能直接就是
        let parsed;
        const raw = stdout.trim();

        // 尝试直接解析
        try {
          parsed = JSON.parse(raw);
        } catch {
          // 可能是 { result: "..." } 格式的 Claude API 响应
          // 也可能输出中有非 JSON 内容，尝试提取 JSON 块
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("无法解析 Claude 输出中的 JSON");
          }
        }

        // 规范化输出结构
        const result = {
          say: parsed.say || "",
          play: parsed.play || [],
          reason: parsed.reason || "",
          segue: parsed.segue || "",
        };

        resolve(result);
      } catch (err) {
        reject(
          new Error(
            `Claude JSON 解析失败。原始输出前 500 字符:\n${stdout.slice(0, 500)}`
          )
        );
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 Claude CLI (${cliPath}): ${err.message}`));
    });
  });
}

module.exports = { callClaude };
