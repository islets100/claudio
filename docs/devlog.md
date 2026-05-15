# Claudio 开发日志

> 从 0 到 1 搭建个人 AI 音乐 DJ Agent 的完整工程记录。
> 每个技术决策都解释「为什么这样做」，供学习和回溯。

---

## 2026-05-15 — 迭代 1：工程骨架

### 1. 技术选型

| 选择 | 备选方案 | 为什么选这个 |
|---|---|---|
| **Express.js 5.x** | 裸 http 模块、Fastify、Koa | Express 生态最成熟、文档最全、中间件最多。5.x 支持 async error handling，写起来比 4.x 干净。对于 MVP 不需要 Fastify 的性能优势 |
| **better-sqlite3** | lowdb (JSON 文件)、SQLite3 (异步) | 同步 API 代码更简单直接（Node.js 中枢不需要高并发），WAL 模式支持并发读。单文件零配置，迁移到 PostgreSQL 时 SQL 语法兼容 |
| **node-cron 4.x** | node-schedule、系统 crontab | 微小的定时库，cron 语法标准，不需要持久化（scheduler.js 自己读 state.db 判断是否重复触发） |
| **ws 8.x** | socket.io | socket.io 是重量级框架，自带 room/namespace/auto-reconnect。Claudio 只需要单房间推送，ws 库更轻更可控 |
| **CommonJS** | ESM | 当前 Node.js 生态下 CJS 兼容性最好。better-sqlite3 等 native 模块在 CJS 下更稳定 |

### 2. 配置系统设计——「数据参数化」的工程落地

**问题**：架构要求「所有用户相关数据从 config.json 读取，绝不硬编码」。怎么做才算数？

**三个层次**：

```
config.example.json   ← 提交到 git，带注释，给未来用户看
config.json           ← .gitignore，用户真实数据
state.db → prefs 表   ← 运行时偏好（音量、主题），可通过 API 修改
```

**config.example.json 的设计原则**：
- 每个字段加 `_comment`，让用户不看文档也能填
- 可选功能默认 `"enabled": false`（飞书、UPnP），不阻塞核心流程
- API key 用空字符串而非 null，避免运行时 `undefined` 判断

### 3. state.db 表设计

**四张表的分工**：

| 表 | 存储什么 | 为什么独立 |
|---|---|---|
| `messages` | 聊天记录 (user/assistant/system) | 和播放记录生命周期不同 |
| `plays` | 播放历史 | 需要按时间聚合分析，独立表方便 |
| `plan` | 每日规划 (date 唯一) | 一天一条，upsert 语义（有则更新） |
| `prefs` | 键值偏好 | 本质是 KV store，不需要复杂结构 |

**为什么不用 JSON 文件（lowdb）**：
- 并发写可能损坏文件
- 查询需要全量加载到内存
- SQLite 的 SQL 语法和未来 PostgreSQL 迁移兼容

**WAL 模式**（Write-Ahead Logging）：允许同时读+写，不会因为一个写操作阻塞所有读。

### 4. 入口文件 index.js 的最小化原则

入口只做三件事：
1. 加载配置（config.json 不存在时立即报错退出）
2. 初始化持久化（state.init()）
3. 启动 HTTP 服务

每个模块通过 `module.exports` 暴露，由 index.js 组装。好处：
- 单独测试某个模块时不需要启动整个服务
- 模块间依赖明确（参数传递，不隐式 import）
- 入口文件保持在 50 行以内

### 5. 目录结构约定

```
server/     ← 所有后端逻辑
public/     ← PWA 前端（与 server 同级，方便 express.static 映射）
prompts/    ← 提示词文件（claude.js 读）
user/       ← 用户语料（context.js 读）
cache/tts/  ← TTS 音频缓存（gitignore）
```

没有把前端放在 `server/public/` 下，因为：
- PWA 是独立可部署单元，MVP 阶段共用一个 Express 进程
- 后续如果要 CDN 部署前端，直接复制 `public/` 目录即可

### 6. 当前文件清单

```
f:/claudeio/
├── .gitignore
├── server/
│   ├── package.json
│   ├── config.example.json    ← 模板（提交）
│   ├── config.json            ← 真实配置（gitignore）
│   ├── index.js               ← 入口
│   ├── state.js               ← SQLite 持久化
│   └── state.db               ← 数据文件（gitignore）
├── public/       (空，迭代5填充)
├── prompts/      (空，迭代2填充)
├── user/         (空，迭代2填充)
└── cache/tts/    (空，迭代3填充)
```

---

## 2026-05-15 — 迭代 2：Claude 适配器 + Context 组装

### 1. context.js — 6 片 prompt 拼装

**设计要点**：

- **系统提示词放在最前面**：Claude 对开头的指令最敏感。`dj-persona.md` 定义了角色、语气和输出格式
- **用户语料紧随其后**：taste.md + routines.md + mood-rules.md 构成 Claudio 的"长期记忆"，告诉 Claude 用户是什么样的人
- **环境注入位于中部**：时间、天气、日程是实时变化的，放在中间位置不会影响角色认知
- **记忆和轨迹放在末尾**：最近的对话和播放记录是辅助上下文，放末尾不影响核心指令

**为什么 system prompt 和 user message 分开**：
```
system: 你是一个 DJ，你的角色是...（反复使用，可缓存）
user:   现在给我推荐音乐（每次不同）
```
这样做为以后引入 Claude API 的 `system` 参数做好准备（API 支持 system prompt caching）。

### 2. claude.js — 子进程管理

**核心挑战**：`claude -p` 是 CLI 工具，不是 HTTP API。我们需要在 Node.js 中管理子进程生命周期。

**关键设计决策**：

1. **超时机制 (30s)**：CLI 可能卡住（网络问题、模型排队），不能无限等待
2. **JSON 解析容错**：Claude 输出可能包含 markdown 代码块（\`\`\`json），也可能直接裸输出 JSON。先用直接解析，失败后尝试正则提取
3. **降级策略**：Claude 调用失败时返回兜底播报词，而不是返回 500 错误。因为用户打开 APP 时看到错误页远比听到"我现在有点短路"更糟

**Spawning 参数解析**：
```js
spawn("claude", ["-p", prompt, "--output-format", "json", "--max-tokens", "2000"])
```
- `-p`：非交互模式，适合脚本调用
- `--output-format json`：要求 Claude 以 JSON 格式输出
- `--max-tokens`：限制生成长度，DJ 播报词不需要很长

### 3. DJ 人设提示词设计

从 `Pageprototype/总体描述.md` 的语音转录提取的 DJ 人格特征：
- 24 小时在线 AI 电台主播
- 比用户更懂他们的听歌品味
- 像策展人一样规划音乐体验
- 温柔、有品味、不啰嗦

**输出格式约束**：要求输出 `{say, play[], reason, segue}` 四种字段：
- `say`：语音播报词（给 TTS 合成）
- `play[]`：推荐歌曲列表（给 ncm.js 解析为实际音频）
- `reason`：策展思路（内部使用，帮助理解推荐逻辑）
- `segue`：歌曲间过渡词（可选项）

### 4. 用户语料模板设计

四个文件各司其职：
| 文件 | 什么 | 为什么独立 |
|---|---|---|
| taste.md | 喜欢的歌手/流派/场景偏好 | 口味是基础，变化最慢 |
| routines.md | 作息规律 | 时间驱动的推荐依据 |
| mood-rules.md | 情绪-音乐映射 | "如果...那么..."逻辑规则 |
| playlists.json | 歌单ID和收藏曲目 | 结构化数据，程序可解析 |

**模板设计原则**：
- 用 HTML 注释给出示例，让用户知道填什么格式
- 半填空式——关键字段带下划线提示（"起床时间："），让用户一行行填
- 不是一次性文档，鼓励随时修改

### 5. POST /api/chat 的请求-响应流

```
用户 "早上好"
  ↓
state.addMessage("user", "早上好")
  ↓
context.assemble({ userMessage, recentMessages, recentPlays })
  ↓ 返回 { systemPrompt, userMessage }
claude.callClaude(systemPrompt, userMessage, config)
  ↓ 返回 { say, play[], reason, segue }
state.addMessage("assistant", say)
for each song in play: state.addPlay(...)
  ↓
res.json({ ok: true, data: result })
```

**降级路径**：如果 claude.callClaude 抛出异常 → 记录错误日志 → 返回兜底播报词 → HTTP 200（不是 500）

---

## 2026-05-15 — 迭代 3：外部 API 集成

### 模块设计原则

每个 API 客户端是一个独立模块，通过 `module.exports` 暴露纯函数。不持有全局状态（除了 calendar.js 的 token 缓存）。

**为什么这样做**：
- 每个模块可单独测试（不依赖 Express、不依赖数据库）
- API key 未配置时静默降级，不抛异常
- 返回 `null` 或 `[]` 而非 throw，调用方自行判断

### weather.js
- 支持按城市名或坐标查询
- `units=metric` 返回摄氏度
- `lang=zh_cn` 返回中文天气描述

### ncm.js
- 封装为 `NCMClient` 类，baseUrl 可配置
- 方法：`search()` / `getSongUrl()` / `getLyric()` / `getRecommend()` / `getPlaylist()`
- 所有方法正常化返回结构（统一字段名），屏蔽 NCM API 差异

### tts.js
- 核心机制：`md5(text + voiceId)` 做缓存键
- 命中缓存直接返回文件路径，不重调 API
- 异步合成，不阻塞聊天响应

### calendar.js
- `enabled: false` 时直接返回空数组，零开销
- token 自动刷新（提前 60s 过期）
- 只读取主日历

---

## 2026-05-15 — 迭代 4：HTTP + WebSocket 服务

### index.js 端点设计

所有端点统一返回 `{ ok: true/false, data/error }` 结构。好处：
- 前端可以统一判断 `if (data.ok)`
- 错误信息通过 `error` 字段传递，不暴露堆栈

### ws.js
- 基于 `ws` 库的 `WebSocketServer`
- 事件类型：`connected` / `chat_reply` / `now_playing` / `state_change` / `progress`
- 广播用 `broadcast()`，单发用 `send()`
- 自动清理断开连接

### 降级策略
- Claude 调用失败 → 返回兜底播报词，HTTP 200（不是 500）
- 天气/日历获取失败 → 静默跳过，不阻塞 chat 流程
- WebSocket 断连 → 3s 自动重连

---

## 2026-05-15 — 迭代 5：PWA 前端 + Scheduler

### scheduler.js
- 三个 cron 任务：07:00 日规划 / 09:00 早间播报 / 整点检查
- 整点检查跳过 6:00 前和 22:00 后（不打扰休息）
- 每个任务独立 try/catch，互不影响

### PWA 前端架构
- 单 HTML 文件，三视图切换（Player / Chat / Settings）
- CSS 严格遵循视觉规范：点阵底纹、JetBrains Mono、镜像波形、破碎顶部波形、spring 动画
- JS 为 IIFE 模式，不污染全局作用域
- Service Worker 缓存壳层，离线可用

### 视觉规范实现对照
| 规范 | 实现 |
|---|---|
| 点阵底纹 `#0d0d0d` 25px | `body { radial-gradient(#1a1a1a 1px, transparent 1px); background-size: 25px; }` |
| JetBrains Mono + Noto Sans SC | Google Fonts CDN 引入 |
| 镜像对称波形 75条线 | `align-items: center` + sin叠加算法 + `requestAnimationFrame` |
| 顶部破碎波形 45条线 | 高频噪声 `Math.random()*15` + sin 叠加 |
| 歌词逐字高亮 | `setInterval` 驱动 `word-node.active` 切换 |
| 消息 spring 动画 | `cubic-bezier(0.34, 1.56, 0.64, 1)` overshoot 缓动 |
| 毛玻璃气泡 | `backdrop-filter: blur(20px) saturate(180%)` |
| ON AIR 呼吸灯 | `@keyframes pulse` 1.5s infinite |
| 主题切换 | `body.light` CSS 变量覆盖 + localStorage 持久化 |

---

## 当前系统状态

### 已实现的 9 个 HTTP 端点
| 方法 | 路径 | 功能 |
|---|---|---|
| GET | / | PWA 前端 |
| GET | /api/health | 健康检查 |
| POST | /api/chat | 对话 + DJ 播报 |
| GET | /api/now | 当前播放 |
| GET | /api/next | 即将播放 |
| GET | /api/search?q= | 搜索歌曲 |
| GET | /api/song/:id | 歌曲详情+歌词 |
| GET | /api/taste | 品味档案 |
| GET | /api/plan/today | 今日规划 |
| WS | /stream | 实时推送 |

### 已实现的后端模块（重构后按功能域分目录）

| 目录 | 文件 | 职责 |
|---|---|---|
| `server/state/` | `state.js` | SQLite 持久化（4表） |
| `server/core/` | `context.js`, `claude.js` | 大脑：prompt 组装 + Claude CLI 子进程 |
| `server/integrations/` | `weather.js`, `ncm.js`, `tts.js`, `calendar.js` | 外部 API 客户端 |
| `server/network/` | `router.js`, `ws.js` | 传输：意图分流 + WebSocket |
| `server/scheduler/` | `scheduler.js` | cron 定时任务（3个） |

### 目录重构（2026-05-15）
原所有模块平铺在 `server/` 下，不利于扩展。按功能域拆分为 5 个子目录：
- `state/` — 持久化层
- `core/` — 大脑层
- `integrations/` — 外部 API 客户端
- `network/` — 传输层
- `scheduler/` — 定时任务

每个目录内可独立增删文件，互不污染。

### 需要用户提供的数据
1. config.json 中的真实值（API keys 等）
2. 网易云音乐 API 服务（本地部署 NeteaseCloudMusicApi）
3. user/ 目录下的品味语料（taste.md / routines.md / mood-rules.md）
