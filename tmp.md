feat: 交互打磨 & TTS 全面修复 — SSE 流式聊天 + 播报协调状态机 + 进度条拖动 + 声音可配置

本次提交涵盖 2026-05-26 全天开发，主要内容如下：

## 一、SSE 流式聊天（server/index.js + server/core/claude-api.js）

- POST /api/chat 从一次性 JSON 响应改为 SSE (Server-Sent Events) 流式
- claude-api.js 新增 callClaudeStream()，内置状态机在 chunk 流中实时提取 "say" 字段
- 前端 fetch → reader.getReader() 逐行解析，逐字更新聊天气泡
- 降级路径改为 SSE 内发送，避免 headers already sent 问题

## 二、进度条拖动（public/js/app.js + public/css/app.css + public/index.html）

- Pointer Events 全拖拽：pointerdown → setPointerCapture → pointermove → pointerup
- 新增 .wave-thumb 圆形拖拽手柄（12px 白色边框圆点 + box-shadow）
- renderWf() 每帧同步 thumb 位置

## 三、播报-歌曲协调状态机（public/js/app.js）

- BGM intro loop：播报期间截取歌曲前 25s 间奏低音量(0.2)循环，播完恢复全音量
- 三标志协调：narrationExpected / narrationActive / karaokeAnimDone
- tryFinishNarration() 等待 karaoke 动画 + TTS 双条件满足才恢复歌曲
- 15s 超时兜底：TTS 未到达时放弃等待，直接恢复
- 竞态修复：增加 !narrationExpected 条件，防止 karaoke 完成早于 TTS 到达

## 四、播报词持久化（public/js/app.js）

- loadHistory() 解析 plays 表 context JSON 字段提取 reason
- 刷新页面后播放队列不再丢失播报词

## 五、底部标签栏重设计（public/index.html + public/css/app.css + public/js/app.js）

- SVG 图标（Feather Icons 风格）替代 emoji
- tab-indicator 滑动 pill：cubic-bezier(0.22, 1, 0.36, 1) 缓动
- phone-shell 改用 height: 100dvh + flex-shrink: 0 确保标签栏常驻
- CSS 全面格式化（压缩 → 多行展开可读）

## 六、TTS 代理修复（server/core/http.js）—— 关键修复

- 根因：npm 安装的 undici ProxyAgent 与 Node.js 内建 undici 版本冲突
  报错 InvalidArgumentError: invalid onRequestStart method
- 修复：放弃 undici，改用 https-proxy-agent + Node.js 原生 https.request
- proxyFetch 返回 fetch 兼容 Response 对象 { ok, status, arrayBuffer(), text(), json() }
- 移除 hop-by-hop 头（content-length / transfer-encoding）
- 支持 AbortSignal 超时控制

## 七、TTS 声音可配置（server/integrations/tts.js + server/config.json + server/config.example.json）

- config.json 新增 tts.speed (0.5-2.0) 和 tts.voice_id
- 缓存 hash 包含 voiceId + speed：md5(text + voiceId + speed)
- config.example.json 同步更新模板

## 八、其他修复

- server/network/ws.js 新增 pushTtsUrl() 事件（tts_ready）
- server/index.js 新增 GET /api/weather 和 GET /api/history 端点
- CSS 深色/浅色主题变量补全（body/body.light）
- .env CLI 文档注释（server/core/claude-api.js 注释精简）

## 文件变更统计

- prompts/dj-persona.md       |  13 +-         (提示词微调)
- public/css/app.css          | 874 ++++++++   (格式化 + 新组件样式)
- public/index.html           |  28 +-         (SVG 标签栏 + thumb)
- public/js/app.js            | 897 ++++++++   (全功能前端逻辑)
- server/core/claude-api.js   | 124 ++--       (SSE 流式 + callClaudeStream)
- server/core/http.js         |  63 ++-        (proxyFetch 重写)
- server/index.js             | 130 ++--       (SSE + 新端点)
- server/integrations/ncm.js  |   2 +-         (小修)
- server/integrations/tts.js  |   9 +-         (speed/voice_id)
- server/network/ws.js        |   6 +          (pushTtsUrl)
- server/scripts/ncm-login.js |  23 +-         (小修)
- 13 files changed, 1877 insertions(+), 292 deletions(-)
