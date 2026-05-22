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

---

## 2026-05-22 — 真实环境集成 & 速度优化

### 1. .env 配置系统

**问题**：API Key 散落在 `.env` 和 `config.json` 两处，如何统一？

**方案**：`.env` 作为唯一密钥来源（`.gitignore`，不提交），服务启动时解析并注入 `config` 对象。

```
.env (根目录)
  ├── OPENWEATHER_API_KEY  → config.weather.api_key
  ├── FISH_API_KEY         → config.tts.api_key
  ├── CLAUDE_API_KEY       → config.claude.api_key
  ├── CLAUDE_BASE_URL      → config.claude.base_url
  ├── NCM_COOKIE           → config.ncm.cookie
  └── HTTP_PROXY           → config.proxy.url
```

**.env 解析器 last-wins 语义**（重要修复）：
```js
// 错误做法（first-wins）：重复 key 时，先出现的占位符覆盖后出现的真实值
if (!process.env[key]) process.env[key] = value;

// 正确做法（last-wins）：后面的值覆盖前面
process.env[key] = value;
```

### 2. 网易云音乐全链路集成

**NeteaseCloudMusicApi 部署**：
- 通过 `npx -y NeteaseCloudMusicApi --port 3000` 本地运行
- 原 GitHub 仓库（Binaryify/NeteaseCloudMusicApi）已重构只剩 README，npm 包不受影响

**QR 码登录流程**（`server/scripts/ncm-login.js`）：
```
/login/qr/key  → 获取 unikey
/login/qr/create?key=&qrimg=true  → 生成 QR 码
/login/qr/check?key=  → 轮询扫码状态 (803=登录成功)
```
- 使用 `qrcode-terminal` 在终端渲染 ASCII QR 码
- 登录成功后将 `MUSIC_U` cookie 写入 `.env`

**用户数据注入 DJ context**（`server/core/context.js`）：
```
NCM 认证接口:
  /user/account        → 用户昵称、uid
  /user/playlist?uid=  → 歌单列表（20个）
  /likelist?uid=       → 收藏歌曲（617首）
  /record/recent/song  → 最近播放

组装为 context 片段:
  "## 用户的网易云音乐数据"
  "最近在听: Khruangbin - Friday Morning (3次)"
  "主要歌单: 我的最爱 (120首)"
  "收藏了 617 首喜欢的歌"
```
- 30 分钟内存缓存，避免每次请求都拉取

### 3. Claude 调用方案迁移：CLI 子进程 → HTTP 直连 API

**原方案（claude.js）的问题**：
- 每次调用 spawn 新进程，冷启动 ~3s
- Windows 需要 `shell: true` + `CLAUDE_CODE_GIT_BASH_PATH` 环境变量
- 长 prompt 通过命令行传参有 shell 转义风险（中文标点、换行符）
- 通过 stdin 传 prompt 绕过了转义问题，但冷启动仍在

**新方案（claude-api.js）**：HTTP 直连中转平台 API
```js
// OpenAI 兼容格式
POST https://cloud.hongqiye.com/v1/chat/completions
{
  model: "claude-sonnet-4-6",
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage }
  ],
  max_tokens: 2000,
  temperature: 0.8
}
```

**关键编码修复**：Node.js 24 的 `fetch` 对 body 中的 UTF-8 中文处理有 bug（ByteString 错误）。
```js
// 错误：含中文的 body 直接传 string 会抛 ByteString 异常
body: JSON.stringify(body)

// 正确：使用 TextEncoder 转为 Uint8Array
body: new TextEncoder().encode(JSON.stringify(body))
```

### 4. HTTP 代理策略优化

**原则**：国内可直连的服务不走代理，被墙的才用 `proxyFetch()`。

| 服务 | 策略 | 原因 |
|---|---|---|
| OpenWeather | 直连 `fetch()` | 国内可访问，代理反而慢且不稳定 |
| Claude API (hongqiye) | 直连 `fetch()` | 中转平台国内可直接访问 |
| NCM (localhost) | 直连 `fetch()` | 本地服务 |
| Fish Audio TTS | 需代理 `proxyFetch()` | api.fish.audio 被墙 |

**架构变化**：
- 删除全局 `setGlobalDispatcher(new ProxyAgent(...))`（会影响所有请求，包括 localhost）
- `http.js` 改为按需导出 `proxyFetch()`，每个模块自行决定是否走代理
- 天气模块移除 `proxyFetch` 依赖，改用原生 `fetch()` + `AbortController` 超时控制

### 5. 前端 Bug 修复

**CSS 主题变量不生效**：
```css
/* 错误：.theme-dark 从未被设置到任何 DOM 元素上 */
.theme-dark { --bg: #0d0d0d; }
.theme-light { --bg: #f0f0f7; }

/* 正确：直接挂 body，通过 body.light 切换 */
body { --bg: #0d0d0d; }
body.light { --bg: #f0f0f7; }
```

**聊天消息不可见**：
- `addChat()` 缺少 `.chat-msg` 包裹层，导致 CSS 的 flex 布局（头像+气泡横排）、spring 动画、max-width 全部失效
- 修复：创建完整结构 `.chat-msg > .chat-avatar + .chat-bubble`

### 6. 速度优化结果

| 指标 | 优化前 | 优化后 | 改善 |
|---|---|---|---|
| 总 POST /api/chat 延迟 | ~25s | **~7.8s** | **3.2x** |
| Claude 调用 | CLI spawn ~3s 冷启动 | HTTP API ~2-3s | 消除冷启动 |
| 天气 API | 代理超时 ~10s | 直连 ~3.7s | 2.7x |
| 降级率 | 频繁 | 0%（本次测试） | — |

### 7. 今日踩坑记录

| 问题 | 根因 | 修复 |
|---|---|---|
| Claude API 始终降级 | `.env` 有两条 `CLAUDE_API_KEY`，第一条是中文占位符 → 被用作 API Key → Authorization header 含中文 → ByteString 崩溃 | 删除占位符 + 解析器改为 last-wins + TextEncoder 编码 |
| 天气"超时" | OpenWeather 不接受中文城市名 "深圳" | 改为 "Shenzhen" |
| 天气走代理超时 ~10s | 代理不稳定 | 改为直连 + 8s AbortController 超时 |
| NCM 歌单返回 0 条 | `/user/playlist` 需要传 `uid` 参数 | 从 `getUserInfo()` 获取 uid 后传入 |
| 前端无法交互 | CSS 选择器 `.theme-dark` 从未被 JS 设置 | 改用 `body` / `body.light` |
| TTS 402 | Fish Audio 账户余额不足（非代码问题） | 待用户充值 |
| `config.json` model 名无效 | `"sonnet"` 是 CLI 简写，API 需要 `"claude-sonnet-4-6"` | 改为完整名称 |

### 8. 当前运行时状态

**启动依赖**（两个进程）：
```
npx -y NeteaseCloudMusicApi --port 3000   ← 必须先启动
node server/index.js                       ← 主服务 :8080
```

**验证通过**：
- POST /api/chat 端到端闭环（天气 + NCM 数据 → Claude → 结构化 DJ 回复）
- DJ 能准确引用：天气（"闷热的阴天"=深圳 31°C 多云）+ 听歌历史（Khruangbin、Tycho、Cocteau Twins）
- 降级兜底词生效（"抱歉，我现在有点短路了"）

**已知待修**：
- Fish Audio TTS：需代理 + 账户余额
- user/ 语料文件（taste.md 等）仍为模板内容，DJ 目前靠 NCM 数据个性化
- 前端细节：点阵时钟、天气角标、导航按钮功能未完成
