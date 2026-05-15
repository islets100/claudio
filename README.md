# Claudio

**具备环境感知能力的情感化 AI 音乐助手 / 个人电台 DJ**

Claudio 不只是播放器——它结合你的地理位置、天气、日程和听歌历史，生成带有「叙事感」的音乐体验。它 24 小时在线，像真正的电台 DJ 一样为你策展音乐。

---

## 工作原理

```
PWA 播放器 ← WebSocket/HTTP → Node.js 中枢 ← Claude Code（大脑）
                              ↓
              网易云音乐 · Fish Audio TTS · 飞书日历
              OpenWeather · UPnP 硬件调度
```

### 四层架构

| 层 | 职责 |
|---|---|
| **第一层 — 外部上下文** | 用户品味语料 · Claude Code CLI · 网易云音乐 API · Fish Audio TTS · 飞书日历 · OpenWeather · UPnP |
| **第二层 — 本地大脑** | Node.js 中枢：意图分流 · Prompt 组装 · Claude 子进程适配 · 节律调度 · TTS 管线 · 状态持久化 |
| **第三层 — 运行时聚合** | 每次触发时按 6 片粘成 Context Window：系统提示词 + 用户语料 + 环境注入 + 记忆 + 用户输入 + 执行轨迹 |
| **第四层 — 交互表层** | PWA（Player / Chat / Settings 三视图）· 6 条 HTTP Contract · WebSocket 实时推送 |

## 视觉设计

**点阵复古未来主义**（Dot-matrix Retro-futurism）

- 极黑底色 `#0d0d0d` 叠加 25px 点阵噪点纹理
- 镜面对称波形进度条——75 条采样线，sin 叠加算法，硬截断着色
- 歌词逐字高亮（Karaoke-style），由时间戳同步驱动
- 毛玻璃气泡 `backdrop-filter: blur(20px) saturate(180%)`
- JetBrains Mono + Noto Sans SC 字体组合
- 消息 spring 物理缓动动画
- 深色/浅色主题一键切换

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js + Express 5 · better-sqlite3 · ws · node-cron |
| AI 大脑 | Claude Code CLI (`claude -p --output-format json`) |
| 音乐数据 | [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) |
| 语音合成 | Fish Audio TTS |
| 前端 | 原生 HTML/CSS/JS PWA · Service Worker 离线缓存 |
| 实时通信 | WebSocket (`/stream`) |

## 快速开始

### 1. 克隆仓库

```bash
git clone <your-repo-url>
cd claudio
```

### 2. 安装依赖

```bash
cd server
npm install
```

### 3. 配置

```bash
cp config.example.json config.json
```

编辑 `config.json`，填入你的 API Key 和偏好：

```json
{
  "user": { "name": "你的昵称", "city": "上海" },
  "weather": { "api_key": "你的 OpenWeather API Key" },
  "tts": { "api_key": "你的 Fish Audio API Key" },
  "ncm": { "base_url": "http://localhost:3000" }
}
```

### 4. 启动依赖服务

```bash
# 启动网易云音乐 API（需要单独克隆部署）
git clone https://github.com/Binaryify/NeteaseCloudMusicApi
cd NeteaseCloudMusicApi && npm install && node app.js
```

### 5. 填写你的音乐品味

编辑 `user/` 目录下的文件：
- `taste.md` — 喜欢的歌手、流派、场景偏好
- `routines.md` — 每天的作息规律
- `mood-rules.md` — 心情与音乐的映射规则

### 6. 启动 Claudio

```bash
cd server
npm start
```

打开 `http://localhost:8080`，开始和你的 AI DJ 对话。

## 项目结构

```
claudio/
├── server/                          # Node.js 中枢
│   ├── index.js                     # 入口
│   ├── config.json                  # 用户配置（gitignore）
│   ├── config.example.json          # 配置模板
│   ├── state/state.js               # SQLite 持久化
│   ├── core/                        # 大脑层
│   │   ├── context.js               # 6 片 Prompt 组装
│   │   └── claude.js                # Claude CLI 适配器
│   ├── integrations/                # 外部 API
│   │   ├── weather.js               # OpenWeather
│   │   ├── ncm.js                   # 网易云音乐
│   │   ├── tts.js                   # Fish Audio TTS
│   │   └── calendar.js              # 飞书日历
│   ├── network/                     # 传输层
│   │   ├── router.js                # 意图分流
│   │   └── ws.js                    # WebSocket
│   └── scheduler/scheduler.js       # 节律调度
├── public/                          # PWA 前端
│   ├── index.html
│   ├── css/app.css                  # 完整视觉规范实现
│   ├── js/app.js
│   ├── sw.js                        # Service Worker
│   └── manifest.json
├── prompts/dj-persona.md            # DJ 人设提示词
├── user/                            # 你的品味语料
│   ├── taste.md
│   ├── routines.md
│   ├── mood-rules.md
│   └── playlists.json
├── Architecture/                    # 架构图
├── Pageprototype/                   # 原型页面
└── docs/devlog.md                   # 开发日志
```

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/chat` | 对话 & DJ 播报 |
| `GET` | `/api/now` | 当前播放 |
| `GET` | `/api/next` | 即将播放 |
| `GET` | `/api/search?q=` | 搜索歌曲 |
| `GET` | `/api/song/:id` | 歌曲详情 + 歌词 |
| `GET` | `/api/taste` | 品味档案 |
| `GET` | `/api/plan/today` | 今日规划 |
| `WS` | `/stream` | 实时推送（now_playing / chat_reply） |

## 开发路线

- [x] 工程骨架 + 配置系统 + SQLite 持久化
- [x] Claude Code 子进程适配器 + Context 组装
- [x] 外部 API 集成（天气 / 网易云 / TTS / 日历）
- [x] HTTP 端点 + WebSocket 实时推送
- [x] PWA 前端 + 节律调度器
- [ ] API Key 配置 & 端到端验证
- [ ] DJ 播报词调优
- [ ] UPnP 音响推送
- [ ] PWA 细节打磨

## License

MIT
