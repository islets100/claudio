# 🎧 Claudio

> *"It's late on a Monday, and here's a song that moves with your breath…"*
> —— 你的 24 小时 AI 电台 DJ，比你自己更懂你想听什么

Claudio 不是播放器。播放器只会放歌。

Claudio 会**看着窗外的天气、翻翻你的日历、想想你几点起床、回忆你过去爱听什么**——然后像一个真正的电台 DJ 一样，用温柔的嗓音告诉你：下一首该听什么。

---

## 它是怎么工作的

```
  🌤️ 天气  ───┐
  📅 日程  ───┤
  🎵 品味  ───┼──→ 🧠 Claude ──→ 💬 DJ 播报词 + 🎶 歌单
  ⏰ 时间  ───┤
  📝 记忆  ───┘
```

四层架构：
1. **外部感官** — 天气 API、网易云音乐、Fish Audio TTS、飞书日历
2. **本地大脑** — Node.js 中枢，Context 拼装 + Claude API 调用 + SSE 流式输出
3. **运行时熔炉** — 6 片 prompt 粘合：DJ 人设 → 用户品味 → 环境 → 记忆 → 输入 → 轨迹
4. **交互表层** — PWA 三视图（播放器 / 聊天 / 设置），WebSocket 实时推送

---

## 前置依赖

| 依赖 | 说明 |
|------|------|
| **Node.js** ≥ 18 | 运行环境 |
| **NeteaseCloudMusicApi** | 网易云音乐 API 服务（本地部署） |
| **Claude API** | 大模型调用（中转平台，OpenAI 兼容格式） |
| **OpenWeather API Key** | 天气数据（免费注册） |
| **Fish Audio API Key** | TTS 语音合成（可选，但播报功能依赖） |
| **HTTP 代理** | 仅 Fish Audio 需要（api.fish.audio 被墙） |

---

## 快速开始

### 1. 安装依赖

```bash
cd server && npm install
```

根目录也需要安装（https-proxy-agent 等）：

```bash
npm install
```

### 2. 配置 .env

在项目根目录创建 `.env` 文件：

```bash
# Claude 大模型（中转平台，兼容 OpenAI 格式）
CLAUDE_API_KEY=sk-你的中转平台Key
CLAUDE_BASE_URL=https://你的中转平台地址

# 天气（https://openweathermap.org 免费注册）
OPENWEATHER_API_KEY=你的OpenWeather_Key

# Fish Audio TTS（https://fish.audio 注册）
FISH_API_KEY=你的Fish_Audio_Key

# HTTP 代理（Fish Audio 需要，Clash/V2Ray 等）
HTTP_PROXY=http://127.0.0.1:7897

# 网易云 Cookie（可选，通过 ncm-login.js 自动获取）
NCM_COOKIE=你的Cookie
```

### 3. 填写个人信息

编辑 `server/config.json`：

```json
{
  "user": {
    "name": "你的昵称",
    "city": "你的城市拼音（如 Shenzhen）"
  }
}
```

配置文件说明详见 [server/config.example.json](server/config.example.json)。

### 4. 登录网易云

```bash
cd server && node scripts/ncm-login.js
```

终端会出现 ASCII 二维码，用网易云音乐 APP 扫码。登录成功后 cookie 自动写入 `.env`。

### 5. 启动网易云 API

```bash
npx -y NeteaseCloudMusicApi --port 3000
```

保持这个窗口开着，这是 Claudio 的曲库。

### 6. 启动 Claudio

另开一个终端：

```bash
cd server && node index.js
```

打开浏览器访问 `http://localhost:8080`，在聊天框跟 Claudio 说话。

### 7. 关闭

```bash
# Windows
taskkill //F //IM node.exe

# macOS / Linux
pkill -f "node index.js"
pkill -f "NeteaseCloudMusicApi"
```

---

## 个性化配置

所有配置集中在两个文件：

| 文件 | 内容 | 是否提交 |
|------|------|----------|
| `.env` | API Keys、Cookie、代理 | ❌ gitignore |
| `server/config.json` | 用户信息、功能开关、模型参数 | ❌ gitignore |
| `server/config.example.json` | 配置模板（参考） | ✅ 提交 |
| `user/*.md` | 音乐品味、作息、情绪规则 | ✅ 提交 |

### 播报声音

修改 `server/config.json` 中 `tts` 段：

```json
"tts": {
  "provider": "fish_audio",
  "api_key": "93f58dfe0612472cbae62ce44be4158d",
  "base_url": "https://api.fish.audio",
  "voice_id": "68c13a4c190a4057a6c1f91e72c6c3e4",
  "speed": 1.1
}
```

| 参数 | 说明 | 范围 |
|------|------|------|
| `voice_id` | 声音模型 ID | 在 [fish.audio](https://fish.audio/zh-CN/) 试听，URL 中的那串 ID |
| `speed` | 语速 | 0.5（慢）~ 2.0（快），推荐 0.9 ~ 1.2 |

推荐女声 ID：
- `68c13a4c190a4057a6c1f91e72c6c3e4` — 嘿嘿温柔文艺女声（热门）
- `3c75b2d0c620482d81adb223b25396a7` — 温柔女声 讲解
- `6402fe3038e041f5803f7a9ae09f3ba1` — 温柔女声 甜美对话风

修改后需**重启服务器**生效。

### 音乐品味

编辑 `user/` 目录下的文件：

| 文件 | 内容 |
|------|------|
| `user/taste.md` | 喜欢的歌手、流派、场景偏好、讨厌的音乐 |
| `user/routines.md` | 日常作息（起床/工作/休息时间） |
| `user/mood-rules.md` | 情绪-音乐映射（"如果...那么..."规则） |
| `user/playlists.json` | 结构化歌单数据 |

### 主题切换

前端支持深色/浅色主题，在 Settings 面板切换，偏好保存在 localStorage。

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat` | 对话 & DJ 播报（SSE 流式响应） |
| `GET` | `/api/now` | 当前播放曲目 |
| `GET` | `/api/next` | 即将播放队列 |
| `GET` | `/api/search?q=` | 搜索网易云歌曲 |
| `GET` | `/api/song/:id` | 歌曲详情（直链 + 歌词） |
| `GET` | `/api/taste` | 用户品味档案 |
| `GET` | `/api/plan/today` | 今日音乐规划 |
| `GET` | `/api/history` | 聊天 & 播放历史 |
| `GET` | `/api/weather` | 当前天气 |
| `GET` | `/api/health` | 健康检查 |
| `WS` | `/stream` | 实时推送（now_playing / chat_reply / tts_ready） |

---

## 项目结构

```
claudio/
├── server/                     # 🧠 中枢
│   ├── index.js                #   入口：SSE + 10 端点
│   ├── config.json             #   用户配置（gitignore）
│   ├── config.example.json     #   配置模板
│   ├── core/                   #   大脑：Context 组装 + Claude API
│   ├── integrations/           #   感官：天气 / 网易云 / TTS / 日历
│   ├── network/                #   传输：Router + WebSocket
│   ├── scheduler/              #   节律：cron 定时任务
│   ├── state/                  #   记忆：SQLite 持久化
│   └── scripts/                #   工具：NCM 登录
├── public/                     # 🎭 PWA 前端
│   ├── index.html              #   三视图 + SVG 标签栏
│   ├── css/app.css             #   点阵复古未来主义
│   ├── js/app.js               #   全功能交互逻辑
│   ├── sw.js                   #   Service Worker
│   └── manifest.json           #   PWA 清单
├── prompts/dj-persona.md       # 🎙️ DJ 人格剧本
├── user/                       # 📓 用户音乐日记
├── cache/tts/                  # 🔊 TTS 音频缓存
├── Architecture/               # 🏛️ 设计蓝图
├── Pageprototype/              # 🎨 视觉原型
├── docs/devlog.md              # 📝 开发日志
└── README.md
```

---

## 开发进度

- [x] 工程骨架 + 配置系统 + SQLite
- [x] Claude HTTP API 直连 + SSE 流式聊天
- [x] 天气 + 网易云全链路集成（QR 登录 / 用户数据）
- [x] 10 条 HTTP 端点 + WebSocket 实时推送
- [x] PWA 三视图 + 视觉规范落地 + Service Worker
- [x] 速度优化（25s → 7.8s）
- [x] Fish Audio TTS（代理修复 + 声音可配置）
- [x] 进度条拖动 + BGM intro loop + 播报协调状态机
- [ ] 用户品味语料填充
- [ ] 点阵时钟 Canvas + 天气角标
- [ ] UPnP 音响推送

---

## 故障排查

**Q: Claude API 返回 "检测到客户端异常"**  
A: 你的中转平台可能只允许特定客户端。换一个支持通用 HTTP 调用的中转平台。

**Q: TTS 报 "fetch failed"**  
A: 检查代理是否开启（`HTTP_PROXY=http://127.0.0.1:7897`），确认 Fish Audio API Key 在 `.env` 中正确配置。

**Q: 网易云歌单返回空**  
A: Cookie 可能已过期，重新运行 `node scripts/ncm-login.js` 扫码登录。

**Q: 天气数据为 null**  
A: `config.json` 中 `city` 必须用英文拼音（如 Shenzhen），OpenWeather 不接受中文。

**Q: 改完配置没生效**  
A: `config.json` 修改后需**重启服务器**。`user/*.md` 修改后无需重启，下次 chat 自动生效。

**Q: 前端 WebSocket 连不上**  
A: 确认服务器已启动，检查防火墙是否拦截了 8080 端口。

---

## License

MIT
