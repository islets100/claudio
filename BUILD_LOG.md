# Claudio 构建日志

## 迭代 1：工程骨架 + 配置系统 + State

### 2026-05-15 — 项目初始化

---

### 1. 依赖选型分析

在初始化 Node.js 项目时，核心依赖的选择直接影响后续开发体验：
- **express@5** — 选 v5 而非 v4，因为 v5 已稳定（2025年发布），原生支持 async error handling，不再需要 `express-async-errors` 包装
- **better-sqlite3** — 选同步 API 而非异步的 `sqlite3`，因为 Claudio 是单用户本地服务，不存在高并发瓶颈。同步代码更易调试，事务写起来更直观
- **ws** — Node.js 生态最成熟的 WebSocket 库，比 Socket.io 更轻量，不需要 fallback 到 HTTP 长轮询（Claudio 只在自己设备上跑，WebSocket 必然可用）
- **node-cron** — 基于 cron 表达式的定时任务，比 `setInterval` 更可靠，支持时区

### 2. 目录结构设计

将服务器代码统一放在 `server/` 子目录下而非根目录，原因：
- 根目录已有 Architecture/、Pageprototype/ 等设计文档，混入代码会杂乱
- 后续如需添加移动端或独立工具，可平级扩展 `mobile/`、`tools/` 等目录
- package.json 的作用域清晰，不会与根目录混淆

### 3. 配置参数化设计

`config.example.json` 的分组逻辑：
- `user` 组 — 个人身份数据，不依赖外部 API
- `apis` 组 — 第三方服务凭证，按服务名分组，方便逐个对接
- `claude` 组 — AI 大脑配置，独立成组是因为它是最核心的依赖
- `server` 组 — 运行时配置

每个字段都有 `_note` 注释，降低使用门槛。

---

## 迭代 2：Claude 适配器 + Context 组装

### 4. state.js 数据库设计

四张表对应施工图第二层 state.db 的定义：

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `messages` | 对话历史 | role(user/assistant/system), content, timestamp, metadata(JSON) |
| `plays` | 播放记录 | song_id, song_name, artist, played_at, context(JSON) |
| `plan` | 每日规划 | date(唯一), plan_json, created_at, updated_at |
| `prefs` | 用户偏好 | key(主键), value, updated_at |

设计要点：
- **WAL 模式**：`journal_mode = WAL`，允许 scheduler 和 HTTP handler 同时读写不阻塞
- **默认偏好**：首次启动自动写入 volume/theme/tts_enabled，避免空值判断
- **JSON 字段**：metadata 和 context 用 JSON 文本存储灵活扩展，SQLite 不强制 schema
- **ON CONFLICT 更新**：plan 和 prefs 用 upsert，避免"先查后插"的竞态

### 5. Context 组装引擎（context.js）

按施工图第三层定义的 6 片粘成 system prompt：

```
① dj-persona.md (系统提示词)
  ↓
② user/*.md (用户品味 + 节律 + 情绪规则)
  ↓
③ 当前时间 + 天气占位 + 日历占位 (环境注入)
  ↓
④ state.db → recentMessages + recentPlays (记忆检索)
  ↓
⑤ userMessage (用户输入，单独返回不混入 system prompt)
  ↓
⑥ schedulerState (执行轨迹，可选)
```

关键设计决策：
- **⑤ 用户输入单独返回**：不混入 system prompt，让 claude.js 决定怎么组合。这样未来可以发多轮对话消息
- **文件读取无缓存**：用户语料每次读取（`loadFile` 直接 readFileSync），因为这些文件会频繁编辑迭代；文件大小可忽略（几 KB）
- **格式化辅助函数**：`formatPlays()` 和 `formatCalendar()` 将结构化数据转成自然语言行，降低 token 消耗

### 6. Claude 子进程适配器（claude.js）

调用方式：`claude -p "<prompt>" --output-format json --max-tokens 2000`

关键工程细节：
- **超时处理**：`setTimeout` 30s 后 `child.kill("SIGTERM")`，reject 而非静默降级——让上层 router 决定是重试还是返回错误
- **JSON 解析容错**：先尝试直接 `JSON.parse(stdout)`，失败后尝试正则提取 `{...}` 块。因为 Claude CLI 偶尔在 JSON 前后输出 warning
- **stdin 忽略**：`stdio: ["ignore", "pipe", "pipe"]`，不传 stdin，prompt 通过命令行参数传入（限制 128KB，对 DJ 播报足够）
- **cwd 设到项目根**：`cwd: ROOT`，让 Claude 子进程能访问 prompts/ 和 user/ 目录（如果未来需要 `claude --include` 等文件引用）

### 7. 用户语料模板设计

四份模板均采用「引导式填空」而非空白文件：
- **taste.md**：歌手/流派/场景偏好/讨厌的音乐/特殊记忆，覆盖 Claude 需要了解的所有维度
- **routines.md**：时间轴 + 周末差异 + 特殊习惯，直接映射到 scheduler 的时间段
- **mood-rules.md**：用「如果...那么...」格式，直接对应用户在 micservice.md 中定义的规则引擎理念
- **playlists.json**：结构化歌单数据，后续 ncm.js 可直接消费

---

## 迭代 3：外部 API 集成

### weather.js — OpenWeather 客户端
- 使用 `node-fetch` 而非原生 `https`，代码更简洁（模板字符串 URL 比手动拼接 path 更直观）
- 返回结构化数据：`{description, temp, feelsLike, humidity, icon, city}`
- 如果 API key 未配置（占位值），静默返回 null 不阻塞流程
- 优先级：经纬度 > 城市名

### ncm.js — 网易云音乐客户端
- 类封装 `NCMClient`，与 `new NCMClient(baseUrl)` 实例化
- 统一 `_get(path, params)` 内部方法处理 URL 拼接和 JSON 解析
- 主要方法：`search()`、`getSongUrl()`、`getLyric()`、`getRecommend()`、`getPlaylist()`

### calendar.js — 飞书日历客户端
- 自动管理 `tenant_access_token` 缓存（2h 有效期，提前 60s 刷新）
- 先获取日历列表再查事件（飞书 API 需要 `calendar_id`）
- 格式化返回：`{title, time, location}`

### tts.js — Fish Audio TTS
- 内容哈希缓存：`MD5(text + voiceId)` → `/tts/<hash>.mp3`
- 缓存命中直接返回 URL，避免重复调用

---

## 迭代 4：HTTP + WebSocket 服务

### 端点总览（8 条线，超施工图定义的 6 条）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/search?q=` | GET | 歌曲搜索（NCM） |
| `/api/song/:id` | GET | 歌曲详情（直链+歌词） |
| `/api/chat` | POST | 对话 & DJ 播报（核心） |
| `/api/now` | GET | 当前播放状态 |
| `/api/next` | GET | 即将播放队列 |
| `/api/taste` | GET | 用户品味档案 |
| `/api/plan/today` | GET | 今日规划 |
| `/stream` | WS | 实时推送（now_playing/chat_reply/state_change） |

### WebSocket 事件类型
- `connected` — 连接确认
- `now_playing` — 当前曲目变化（含 track 对象）
- `state_change` — 播放状态（toggle/skip/playing/paused）
- `chat_reply` — Claudio 回复（含 say/reason/play/tts_url）

---

## 迭代 5：PWA 前端 + Scheduler

### 前端已创建
- `public/index.html` — 三视图（Player / Chat / Settings）+ 手机框架
- `public/css/app.css` — 完整样式表，含深色/浅色主题变量、镜像波形、破碎波形、毛玻璃、spring 消息动画
- `public/manifest.json` — PWA 安装清单
- `public/sw.js` — Service Worker（Cache First 壳层 + 自动清理旧版本）
- `public/js/app.js` — 前端逻辑占位（待完善）

### scheduler.js — 定时任务
- `cron.schedule("0 7 * * *")` — 07:00 日规划
- `cron.schedule("0 9 * * *")` — 09:00 早间播报
- `cron.schedule("0 * * * *")` — 整点情绪检查（6-22 点，跳过 7/9）
- 通过 `init({ config, state, context, claude, weather, calendar, ws })` 注入依赖

---

## 当前工程状态

```
server/
├── index.js         ✅ 入口，加载配置→初始化模块→启动服务
├── config.example.json ✅ 配置模板
├── state.js         ✅ SQLite 持久化（messages/plays/plan/prefs）
├── context.js       ✅ 6 片 Context Window 组装
├── claude.js        ✅ Claude CLI 子进程适配器
├── router.js        ✅ 意图分流（指令/音乐/自然语言）
├── weather.js       ✅ OpenWeather 客户端
├── calendar.js      ✅ 飞书日历客户端
├── ncm.js           ✅ 网易云音乐客户端（NCMClient 类）
├── tts.js           ✅ Fish Audio TTS（MD5 哈希缓存）
├── ws.js            ✅ WebSocket 管理（/stream 推送）
└── scheduler.js     ✅ 节律调度（07:00/09:00/整点）

public/
├── index.html       ✅ 三视图 PWA 页面
├── css/app.css      ✅ 完整样式表（深色/浅色主题）
├── js/app.js        ⚠️ 占位（前端交互逻辑待完善）
├── sw.js            ✅ Service Worker
└── manifest.json    ✅ PWA 安装清单
```
