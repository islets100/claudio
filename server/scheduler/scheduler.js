const cron = require("node-cron");

let jobs = {};
let modules = {}; // { config, state, context, claude, weather, calendar, ws }

/**
 * 初始化调度器，注册所有定时任务
 */
function init(mods) {
  modules = mods;
  const { state, config } = mods;

  console.log("[scheduler] 注册定时任务...");

  // 07:00 — 日规划
  jobs.morningPlan = cron.schedule("0 7 * * *", async () => {
    console.log("[scheduler] 07:00 日规划触发");
    await runDailyPlan();
  });

  // 09:00 — 早间播报
  jobs.morningBroadcast = cron.schedule("0 9 * * *", async () => {
    console.log("[scheduler] 09:00 早间播报触发");
    await runBroadcast("morning");
  });

  // 整点 — 情绪 / 场景检查
  jobs.hourlyCheck = cron.schedule("0 * * * *", async () => {
    const hour = new Date().getHours();
    // 跳过已经在其他任务中覆盖的时间点
    if (hour === 7 || hour === 9 || hour < 6 || hour > 22) return;
    console.log(`[scheduler] ${String(hour).padStart(2, "0")}:00 整点检查`);
    await runMoodCheck();
  });

  console.log("[scheduler] 定时任务已启动 (07:00规划 / 09:00早间 / 整点检查)");
}

function stop() {
  for (const [name, job] of Object.entries(jobs)) {
    job.stop();
    console.log(`[scheduler] ${name} 已停止`);
  }
}

// ---- 内部任务 ----

async function runDailyPlan() {
  const { context, claude, weather, calendar, state, config } = modules;
  try {
    const weatherData = await weather.getWeather(config).catch(() => null);
    const events = await calendar.getTodayEvents(config).catch(() => []);

    const { systemPrompt } = context.assemble({
      userMessage: "现在是早晨，请为我规划今天的音乐体验。考虑今天的天气和我的日程，给我一个全天音乐主题和几首要听的歌。",
      weather: weatherData,
      calendarEvents: events,
      recentMessages: state.getMessages(10),
      recentPlays: state.getRecentPlays(10),
    });

    const result = await claude.callClaude(systemPrompt, "", config.claude);
    const today = new Date().toISOString().slice(0, 10);
    state.setPlan(today, { weather: weatherData, events, plan: result });
    state.addMessage("system", `日规划: ${result.say}`);

    if (result.play.length > 0) {
      modules.ws.pushNowPlaying(result.play[0]);
    }
  } catch (err) {
    console.error("[scheduler] 日规划失败:", err.message);
  }
}

async function runBroadcast(timeOfDay) {
  const { context, claude, weather, calendar, state, config } = modules;
  try {
    const weatherData = await weather.getWeather(config).catch(() => null);
    const events = await calendar.getTodayEvents(config).catch(() => []);

    const msg = timeOfDay === "morning"
      ? "早上好！请根据当前时间和天气，为我推荐几首开启新一天的歌。"
      : "请根据现在的时间和环境，为我推荐几首歌。";

    const { systemPrompt } = context.assemble({
      userMessage: msg,
      weather: weatherData,
      calendarEvents: events,
      recentMessages: state.getMessages(10),
      recentPlays: state.getRecentPlays(10),
    });

    const result = await claude.callClaude(systemPrompt, "", config.claude);
    state.addMessage("assistant", result.say, { result, timeOfDay });

    for (const song of result.play || []) {
      state.addPlay(song.song_id || "", song.song || "未知", song.artist || "", {
        reason: song.reason || "",
        context: timeOfDay,
      });
    }

    modules.ws.pushChatReply({
      say: result.say,
      reason: result.reason,
      play: result.play || [],
    });
  } catch (err) {
    console.error("[scheduler] 播报失败:", err.message);
  }
}

async function runMoodCheck() {
  const { context, claude, weather, state, config } = modules;
  try {
    const weatherData = await weather.getWeather(config).catch(() => null);

    const { systemPrompt } = context.assemble({
      userMessage: "现在是整点。看一眼现在的时间、天气和最近的播放记录，如果有需要调整的氛围就推荐一首，没有就安静。",
      weather: weatherData,
      recentMessages: state.getMessages(5),
      recentPlays: state.getRecentPlays(5),
    });

    const result = await claude.callClaude(systemPrompt, "", config.claude);
    // 只有 Claude 主动推荐时才播报
    if (result.play && result.play.length > 0) {
      state.addMessage("assistant", result.say, { result, type: "mood_check" });
      modules.ws.pushChatReply({
        say: result.say,
        reason: result.reason,
        play: result.play,
      });
    }
  } catch (err) {
    // 整点检查静默失败，不打扰用户
    console.error("[scheduler] 整点检查失败:", err.message);
  }
}

module.exports = { init, stop };
