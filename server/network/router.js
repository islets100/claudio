// router.js — 意图分流
//
// 职责：解析用户输入，分流到不同的处理器。
// 对应施工图第二层 ROUTER.JS 模块。
//
// 分流逻辑：
//   简单指令（播放控制、跳过）→ 直接动作
//   音乐查询（歌手/歌名/推荐）→ ncm + claude 联动
//   自然语言（聊天、心情、闲聊）→ claude 上下文播报
//   其他 → 默认 Claude 处理
//
// 为什么设计成策略映射而不是 if-else 链？
// - 每条规则独立可测试
// - 新增意图只需加规则，不改核心逻辑
// - 规则有优先级，匹配第一个后停止

// ============================================================
// 指令检测
// ============================================================

const COMMANDS = {
  PLAY_PAUSE: /^(播放|暂停|play|pause|停|继续|开始)$/i,
  SKIP: /^(下一首|下一曲|跳过|切歌|next|skip|换一首)$/i,
  LIKE: /^(喜欢|收藏|like|love)$/i,
  VOLUME: /^(声音|音量|大[声点]|小[声点])/i,
};

const MUSIC_QUERY = /^(播放|放|来[一首点些个]|推荐|换|搜|找)/i;

// ============================================================
// 路由入口
// ============================================================

/**
 * @param {string} input — 用户输入
 * @param {object} ctx — 上下文对象，包含所有依赖
 *   ctx.config — 用户配置
 *   ctx.state — state.db 实例
 *   ctx.claude — claude.js 的 callClaude 函数
 *   ctx.context — context.js 的 assemble 函数
 *   ctx.ncm — NCMClient 实例
 *   ctx.tts — tts.js synthesize 函数
 *   ctx.weather — weather.js getWeather 函数
 *   ctx.calendar — calendar.js getTodayEvents 函数
 *   ctx.ws — ws.js 实例
 * @returns {Promise<{say:string, play:Array, reason:string, segue:string, ttsUrl:string|null}>}
 */
async function route(input, ctx) {
  const trimmed = input.trim();

  if (!trimmed) {
    return emptyReply('（无输入）');
  }

  // 1. 匹配简单指令
  for (const [name, pattern] of Object.entries(COMMANDS)) {
    if (pattern.test(trimmed)) {
      return handleCommand(name, trimmed, ctx);
    }
  }

  // 2. 匹配音乐查询
  if (MUSIC_QUERY.test(trimmed)) {
    return handleMusicQuery(trimmed, ctx);
  }

  // 3. 默认：走 Claude 上下文播报
  return handleChat(trimmed, ctx);
}

// ============================================================
// 处理器
// ============================================================

async function handleCommand(name, input, ctx) {
  switch (name) {
    case 'PLAY_PAUSE':
      ctx.ws.pushStateChange('toggle');
      return { say: '', play: [], reason: '', segue: '', ttsUrl: null, _direct: 'play_pause' };
    case 'SKIP':
      ctx.ws.pushStateChange('skip');
      return { say: '', play: [], reason: '', segue: '', ttsUrl: null, _direct: 'skip' };
    case 'LIKE':
      return { say: '已收藏 ❤', play: [], reason: '', segue: '', ttsUrl: null, _direct: 'like' };
    case 'VOLUME':
      return { say: '', play: [], reason: '', segue: '', ttsUrl: null, _direct: 'volume' };
    default:
      return emptyReply(`未知指令: ${name}`);
  }
}

async function handleMusicQuery(input, ctx) {
  // 提取关键词：去掉"播放""放""来一首"等前缀
  const keyword = input.replace(MUSIC_QUERY, '').trim();

  if (!keyword) {
    // 没有具体关键词 → 让 Claude 根据上下文推荐
    return handleChat(input, ctx);
  }

  // 先搜网易云
  let searchResults = [];
  try {
    searchResults = await ctx.ncm.search(keyword, 5);
  } catch (e) {
    console.error('[router] NCM 搜索失败:', e.message);
  }

  // 有搜索结果 → 让 Claude 在搜索结果中挑选并生成播报
  // 无结果 → 让 Claude 根据音乐知识推荐
  const searchContext = searchResults.length > 0
    ? `\n\n网易云搜索结果（"${keyword}"）:\n${JSON.stringify(searchResults, null, 2)}`
    : `\n\n用户搜索了"${keyword}"但网易云无结果，请根据你的音乐知识推荐类似歌曲。`;

  return handleChat(input + searchContext, ctx);
}

async function handleChat(input, ctx) {
  // 收集环境数据
  const [weather, calendarEvents] = await Promise.all([
    ctx.weather?.(ctx.config).catch(() => null) || null,
    ctx.calendar?.getTodayEvents(ctx.config).catch(() => []) || [],
  ]);

  const recentMessages = ctx.state.getMessages(20);
  const recentPlays = ctx.state.getRecentPlays(10);

  // 组装 context
  const { systemPrompt, userMessage } = ctx.context.assemble({
    userMessage: input,
    weather,
    calendarEvents,
    recentMessages,
    recentPlays,
  });

  // 保存用户消息
  ctx.state.addMessage('user', input);

  // 调用 Claude
  let result;
  try {
    result = await ctx.claude(systemPrompt, userMessage, ctx.config.claude);
  } catch (e) {
    console.error('[router] Claude 调用失败:', e.message);
    result = {
      say: '',
      play: [],
      reason: `Claude 暂时无法响应: ${e.message}`,
      segue: '',
    };
  }

  // 保存 Claude 回复
  if (result.say) {
    ctx.state.addMessage('assistant', result.say, { reason: result.reason });
  }

  // TTS 合成
  let ttsUrl = null;
  if (result.say && ctx.tts) {
    try {
      ttsUrl = await ctx.tts(result.say, ctx.config);
    } catch (e) {
      console.error('[router] TTS 失败:', e.message);
    }
  }

  // WebSocket 推送
  ctx.ws.pushChatReply({
    say: result.say,
    reason: result.reason,
    play: result.play,
    tts_url: ttsUrl,
  });

  return { ...result, ttsUrl };
}

// ============================================================
// 辅助
// ============================================================

function emptyReply(reason) {
  return { say: '', play: [], reason, segue: '', ttsUrl: null };
}

module.exports = { route };
