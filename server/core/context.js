const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

function loadFile(...segments) {
  const p = path.join(...segments);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8").trim();
}

function formatPlays(plays) {
  if (!plays || plays.length === 0) return "（暂无播放记录）";
  const recent = plays.slice(-10);
  return recent
    .map((p) => `- ${p.played_at} | ${p.song_name} | ${p.artist || "未知"}`)
    .join("\n");
}

function formatCalendar(events) {
  if (!events || events.length === 0) return "今日暂无日程";
  return events
    .map((e) => `- ${e.time || ""} ${e.title || e.summary || ""}`)
    .join("\n");
}

/**
 * 按 6 片粘成 Claude 的完整 system prompt
 *
 *  ① 系统提示词    — prompts/dj-persona.md
 *  ② 用户语料      — user/*.md + 网易云用户数据
 *  ③ 环境注入      — weather + calendar + now
 *  ④ 已检索记忆    — state.db messages + plays
 *  ⑤ 用户输入      — 当前消息
 *  ⑥ 执行轨迹      — scheduler 状态（可选）
 */
function assemble(opts = {}) {
  const {
    userMessage = "",
    weather = null,
    calendarEvents = [],
    recentMessages = [],
    recentPlays = [],
    schedulerState = null,
    ncmProfile = null,
  } = opts;

  // ①
  const persona = loadFile(ROOT, "prompts", "dj-persona.md");

  // ②
  const taste = loadFile(ROOT, "user", "taste.md");
  const routines = loadFile(ROOT, "user", "routines.md");
  const moodRules = loadFile(ROOT, "user", "mood-rules.md");

  const userCorpus = [taste, routines, moodRules]
    .filter(Boolean)
    .join("\n\n---\n\n");

  // 网易云用户数据（真实听歌行为）
  let ncmBlock = "";
  if (ncmProfile) {
    ncmBlock = "## 用户的网易云音乐数据\n";
    if (ncmProfile.nickname) {
      ncmBlock += `网易云昵称: ${ncmProfile.nickname}\n`;
    }
    if (ncmProfile.recentHistory && ncmProfile.recentHistory.length > 0) {
      ncmBlock += `\n最近在听:\n${ncmProfile.recentHistory.map(h => `- ${h.name} - ${h.artist} (${h.playCount}次)`).join("\n")}\n`;
    }
    if (ncmProfile.topPlaylists && ncmProfile.topPlaylists.length > 0) {
      ncmBlock += `\n主要歌单:\n${ncmProfile.topPlaylists.map(p => `- ${p.name} (${p.trackCount}首)`).join("\n")}\n`;
    }
    if (ncmProfile.likedCount) {
      ncmBlock += `\n收藏了 ${ncmProfile.likedCount} 首喜欢的歌\n`;
    }
  }

  // ③
  const now = new Date();
  const nowStr = `${now.toLocaleDateString("zh-CN")} ${now.toLocaleTimeString("zh-CN")}`;
  let envBlock = `当前时间: ${nowStr}`;

  if (weather) {
    envBlock += `\n天气: ${weather.description || ""}，${weather.temp != null ? weather.temp + "°C" : ""}，湿度 ${weather.humidity != null ? weather.humidity + "%" : ""}`;
  }

  if (calendarEvents.length > 0) {
    envBlock += `\n今日日程:\n${formatCalendar(calendarEvents)}`;
  } else {
    envBlock += `\n今日日程: 暂无`;
  }

  // ④
  let memoryBlock = "";
  if (recentMessages.length > 0) {
    memoryBlock +=
      "最近的对话:\n" +
      recentMessages
        .slice(-6)
        .map((m) => `[${m.role}] ${m.content.slice(0, 200)}`)
        .join("\n");
  }
  memoryBlock += "\n\n最近播放:\n" + formatPlays(recentPlays);

  // ⑥
  let traceBlock = "";
  if (schedulerState) {
    traceBlock = `当前调度状态: ${JSON.stringify(schedulerState)}`;
  }

  // 组装完整系统提示词
  const systemPrompt = [
    persona,
    "---",
    "## 用户品味档案",
    userCorpus,
    ncmBlock,
    "---",
    "## 当前环境",
    envBlock,
    "---",
    "## 记忆",
    memoryBlock,
    traceBlock ? "---\n## 执行轨迹\n" + traceBlock : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // ⑤ 用户输入单独在 message 中传入，不混入 system prompt
  return { systemPrompt, userMessage };
}

module.exports = { assemble };
