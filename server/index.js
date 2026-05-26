const express = require("express");
const path = require("path");
const fs = require("fs");

// 加载根目录 .env 文件（优先级高于 config.json）
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = value;  // 后出现的值覆盖前面的
  }
  console.log("📋 .env 已加载");
}

// 加载配置
const configPath = path.join(__dirname, "config.json");
if (!fs.existsSync(configPath)) {
  console.error("❌ 缺少 config.json，请从 config.example.json 复制并填写真实值");
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

// .env 值自动覆盖 config.json（约定：.env 中的 Key 映射到 config 字段）
if (process.env.OPENWEATHER_API_KEY) config.weather.api_key = process.env.OPENWEATHER_API_KEY;
if (process.env.FISH_API_KEY) config.tts.api_key = process.env.FISH_API_KEY;
if (process.env.NETEASE_API_URL) config.ncm.base_url = process.env.NETEASE_API_URL;
if (process.env.NETEASE_API_KEY && !process.env.NETEASE_API_URL) config.ncm.base_url = process.env.NETEASE_API_KEY;
if (process.env.HTTP_PROXY) config.proxy = config.proxy || { url: process.env.HTTP_PROXY };
if (process.env.NCM_COOKIE) config.ncm.cookie = process.env.NCM_COOKIE;
if (process.env.CLAUDE_API_KEY) config.claude.api_key = process.env.CLAUDE_API_KEY;
if (process.env.CLAUDE_BASE_URL) config.claude.base_url = process.env.CLAUDE_BASE_URL;

// 用 async IIFE 包裹启动流程
(async () => {

// 初始化持久化
const state = require("./state/state");
state.init();
console.log("🗄️  state.db 已就绪");

// 核心模块
const context = require("./core/context");
const claude = require("./core/claude-api");
const weather = require("./integrations/weather");
const calendar = require("./integrations/calendar");
const { NCMClient } = require("./integrations/ncm");
const tts = require("./integrations/tts");
const ws = require("./network/ws");

// 初始化 NCM 客户端
const ncm = new NCMClient(config.ncm?.base_url || "http://localhost:3000", config.ncm?.cookie || "");
let ncmProfileCache = null;   // 网易云用户数据缓存（30分钟刷新）

// Express 实例
const app = express();
app.use(express.json());

// 静态文件 — PWA 前端
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// TTS 缓存静态服务
app.use("/tts", express.static(path.join(__dirname, "..", "cache", "tts")));

// ---- 健康检查 ----
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---- GET /api/weather ----
app.get("/api/weather", async (_req, res) => {
  try {
    const data = await weather.getWeather(config);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("/api/weather error:", err.message);
    res.json({ ok: true, data: null });
  }
});

// ---- GET /api/search ----
app.get("/api/search", async (req, res) => {
  try {
    const keyword = req.query.q;
    if (!keyword) return res.json({ ok: true, data: [] });
    const songs = await ncm.search(keyword, 10);
    res.json({ ok: true, data: songs });
  } catch (err) {
    console.error("/api/search error:", err.message);
    res.json({ ok: true, data: [] });
  }
});

// ---- GET /api/song/:id ----
app.get("/api/song/:id", async (req, res) => {
  try {
    const [urlData, lyricData] = await Promise.all([
      ncm.getSongUrl(req.params.id),
      ncm.getLyric(req.params.id),
    ]);
    res.json({ ok: true, data: { url: urlData, lyric: lyricData } });
  } catch (err) {
    console.error("/api/song/:id error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---- POST /api/chat ----
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message || "";

    // 获取环境数据
    const [weatherData, calendarEvents] = await Promise.all([
      weather.getWeather(config).catch(() => null),
      calendar.getTodayEvents(config).catch(() => []),
    ]);

    // 获取网易云用户数据（带简单的内存缓存，30 分钟刷新一次）
    let ncmProfile = null;
    if (config.ncm?.cookie) {
      const now = Date.now();
      if (!ncmProfileCache || now - ncmProfileCache._ts > 30 * 60 * 1000) {
        try {
          const info = await ncm.getUserInfo();
          const uid = info?.id;
          const [playlists, history, likedSongs] = await Promise.all([
            ncm.getUserPlaylists(uid).catch(() => []),
            ncm.getHistory(30).catch(() => []),
            ncm.getLikedSongs(uid).catch(() => []),
          ]);
          ncmProfileCache = {
            nickname: info?.nickname || "",
            recentHistory: history.slice(0, 15),
            topPlaylists: playlists.slice(0, 10),
            likedCount: likedSongs.length,
            _ts: now,
          };
        } catch (e) {
          console.warn("获取网易云用户数据失败:", e.message);
        }
      }
      ncmProfile = ncmProfileCache;
    }

    // 组装 context
    const { systemPrompt } = context.assemble({
      userMessage,
      weather: weatherData,
      calendarEvents,
      recentMessages: state.getMessages(20),
      recentPlays: state.getRecentPlays(20),
      ncmProfile,
    });

    // 流式 SSE 响应
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });

    try {
      let fullSay = "";

      await claude.callClaudeStream(
        systemPrompt,
        userMessage,
        config.claude,
        // onChunk — 逐字推送到前端
        (delta) => {
          fullSay += delta;
          res.write(`data: ${JSON.stringify({ c: delta })}\n\n`);
        },
        // onDone — 发送完整结果
        (result) => {
          // 保存助手回复
          state.addMessage("assistant", result.say, { result });

          // 记录播放
          for (const song of result.play || []) {
            state.addPlay(
              song.song_id || "",
              song.song || "未知",
              song.artist || "",
              { reason: song.reason || "" }
            );
          }

          // 异步合成 TTS，完成后通过 WebSocket 推送
          if (result.say) {
            tts.synthesize(result.say, config).then((url) => {
              if (url) {
                result._ttsUrl = url;
                ws.pushTtsUrl(url);
              }
            }).catch(() => {});
          }

          // WebSocket 推送
          ws.pushChatReply({
            say: result.say,
            reason: result.reason,
            play: result.play || [],
            segue: result.segue,
            tts_url: result._ttsUrl,
          });

          // 发送最终结果
          res.write(`data: ${JSON.stringify({ done: true, say: result.say, play: result.play, reason: result.reason, segue: result.segue })}\n\n`);
          res.end();
        }
      );
    } catch (err) {
      console.error("Claude 调用失败:", err.message);
      // 降级
      const fallback = { say: "抱歉，我现在有点短路了。试试自己手动选首歌？", play: [], reason: "Claude 调用失败，触发降级", segue: "" };
      res.write(`data: ${JSON.stringify({ c: fallback.say })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true, ...fallback })}\n\n`);
      res.end();
    }

    // 保存用户消息（在流开始后）
    state.addMessage("user", userMessage);
  } catch (err) {
    console.error("/api/chat 异常:", err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message });
    } else {
      res.end();
    }
  }
});

// ---- GET /api/now ----
app.get("/api/now", (_req, res) => {
  const recent = state.getRecentPlays(1);
  res.json({
    ok: true,
    data: recent.length > 0 ? recent[0] : null,
  });
});

// ---- GET /api/next ----
app.get("/api/next", (_req, res) => {
  // 当前无队列，返回空。后续与 ncm.js 和 claude.js 联动
  res.json({ ok: true, data: [] });
});

// ---- GET /api/taste ----
app.get("/api/taste", (_req, res) => {
  const root = path.join(__dirname, "..");
  const taste = fs.existsSync(path.join(root, "user", "taste.md"))
    ? fs.readFileSync(path.join(root, "user", "taste.md"), "utf-8")
    : "";
  const routines = fs.existsSync(path.join(root, "user", "routines.md"))
    ? fs.readFileSync(path.join(root, "user", "routines.md"), "utf-8")
    : "";
  const moodRules = fs.existsSync(path.join(root, "user", "mood-rules.md"))
    ? fs.readFileSync(path.join(root, "user", "mood-rules.md"), "utf-8")
    : "";
  res.json({ ok: true, data: { taste, routines, moodRules } });
});

// ---- GET /api/plan/today ----
app.get("/api/plan/today", (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const plan = state.getPlan(today);
  res.json({ ok: true, data: plan });
});

// ---- GET /api/history ----
app.get("/api/history", (_req, res) => {
  const messages = state.getMessages(50);
  const plays = state.getRecentPlays(30);
  res.json({ ok: true, data: { messages, plays } });
});

// ---- 启动 ----
const PORT = config.server?.port || 8080;
const HOST = config.server?.host || "localhost";

const server = app.listen(PORT, HOST, () => {
  console.log(`🎧 Claudio 已启动 → http://${HOST}:${PORT}`);
  console.log(`   WebSocket 端点: ws://${HOST}:${PORT}/stream`);
  console.log("");
  console.log("   已注册端点:");
  console.log("   POST /api/chat       — 对话 & DJ 播报");
  console.log("   GET  /api/now        — 当前播放");
  console.log("   GET  /api/next       — 即将播放");
  console.log("   GET  /api/taste      — 品味档案");
  console.log("   GET  /api/plan/today — 今日规划");
  console.log("   WS   /stream         — 实时推送");
  console.log("   GET  /api/health     — 健康检查");
});

// 初始化 WebSocket
ws.init(server);

// 初始化调度器
const scheduler = require("./scheduler/scheduler");
scheduler.init({ config, state, context, claude, weather, calendar, ws });

// 导出供 ws.js 共用 HTTP server
module.exports = { app, server, config, state };
})();
