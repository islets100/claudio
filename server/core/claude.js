const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

/**
 * 调用 Claude Code CLI 生成 DJ 播报
 *
 * Prompt 通过 stdin 传入，避免命令行参数的长度限制和转义问题。
 *
 * @param {string} systemPrompt  — 完整系统提示词
 * @param {string} userMessage   — 用户当前消息
 * @param {object} config        — 来自 config.json 的 claude 配置段
 * @returns {Promise<{say:string, play:Array, reason:string, segue:string}>}
 */
function callClaude(systemPrompt, userMessage, config = {}) {
  const cliPath = config.cli_path || "claude";
  const timeoutMs = config.timeout_ms || 60000;
  const model = config.model || "sonnet";

  const fullPrompt = `${systemPrompt}\n\n---\n\n用户消息: ${userMessage || "（无额外输入，请根据当前时间、环境和用户品味自主推荐音乐）"}`;

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(cliPath, [
      "-p",
      "--output-format", "json",
      "--model", model,
      "--max-budget-usd", "0.50",
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        CLAUDE_CODE_GIT_BASH_PATH: process.env.CLAUDE_CODE_GIT_BASH_PATH || "D:\\git\\Git\\bin\\bash.exe",
      },
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    // 通过 stdin 传入 prompt，避免 shell 转义问题
    child.stdin.write(fullPrompt);
    child.stdin.end();

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
        let parsed;
        const raw = stdout.trim();

        try {
          parsed = JSON.parse(raw);
        } catch {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("无法解析 Claude 输出中的 JSON");
          }
        }

        // 处理 Claude CLI 可能返回的 "result" 包装
        if (parsed.result && typeof parsed.result === "string") {
          try {
            parsed = JSON.parse(parsed.result);
          } catch {
            // result 是纯文本，保持原样
          }
        }

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
