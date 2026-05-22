# 🎧 Claudio

> *"It's late on a Monday, and here's a song that moves with your breath…"*
> — 你的 24 小时 AI 电台 DJ，比你自己更懂你想听什么

---

## ✨ 这玩意儿是啥

Claudio 不是播放器。播放器只会放歌。

Claudio 会**看着窗外的天气 🏙️、翻翻你的日历 📅、想想你几点起床 🌅、回忆你过去爱听什么 🧠**——然后像一个真正的电台 DJ 一样，用温柔的嗓音告诉你：下一首该听什么。

它是一股「反效率」的力量——在你和 Claude Code 多线程搏斗到脑壳冒烟的时候，它安静地待在侧屏幕上，帮你呼吸 🫁。

---

## 🧠 它怎么想的

```
  🌤️ 天气  ───┐
  📅 日程  ───┤
  🎵 品味  ───┼──→ 🧠 Claude Code ──→ 💬 DJ 播报词 + 🎶 歌单
  ⏰ 时间  ───┤
  📝 记忆  ───┘
```

### 🏗️ 四层小宇宙

| 🧱 层 | 🎯 干嘛的 | 🛠️ 里面有什么 |
|---|---|---|
| **① 外部感官** | 睁眼看世界 | 你的品味档案 📂 · Claude CLI 🧠 · 网易云 🎵 · Fish TTS 🗣️ · 飞书日历 📅 · OpenWeather 🌤️ · UPnP 📻 |
| **② 本地大脑** | 思考 & 决策 | 意图分流器 · Prompt 炼金术 · Claude 子进程召唤 · 节律时钟 · 声音合成管线 · 记忆库 |
| **③ 运行时熔炉** | 六片拼图粘成一个 prompt | ① DJ 人设 → ② 你的品味 → ③ 环境注入 → ④ 历史记忆 → ⑤ 你说的话 → ⑥ 执行轨迹 |
| **④ 交互表层** | 你看见 & 触碰的 | PWA 三视图 🎛️ · 6 条 HTTP 魔法线 · WebSocket 实时心跳 💓 |

---

## 🎨 不是随便画的好看

我们管这叫 **点阵复古未来主义**（Dot-matrix Retro-futurism）——

- 🖤 极黑底色 `#0d0d0d`，铺满 25px 的像素点阵噪点
- 🟢 `#00ff88` 呼吸灯一闪一闪：「ON AIR · DJ MODE」
- 〰️ 镜像对称波形——75 条采样线上下延伸，左边墨黑右边浅灰，像 Logic Pro 里截出来的音频片段
- 🎤 歌词逐字点亮——不是变色，是绿色滑块扫过文字，跟着时间戳走
- 🔮 毛玻璃气泡 `blur(20px)` + 弹簧物理缓动——消息不是 fade 进来的，是弹进来的
- 🌓 一键切换深色 / 薰衣草浅色

> 原型在 `Pageprototype/` 里，你可以打开 `twopage.html` 先感受一下 ✨

---

## ⚡ 五分钟把它叫醒

### 1️⃣ 装零件

```bash
cd server && npm install
```

### 2️⃣ 告诉它你的秘密

在项目根目录创建 `.env` 文件：

```bash
# 天气（OpenWeather 免费注册即可）
OPENWEATHER_API_KEY=你的_OpenWeather_Key

# Claude 大模型（中转平台，兼容 OpenAI 格式）
CLAUDE_API_KEY=sk-你的中转平台Key
CLAUDE_BASE_URL=https://你的中转平台地址

# Fish Audio TTS（可选，目前需代理 + 账户余额）
FISH_API_KEY=你的_Fish_Audio_Key

# HTTP 代理（可选，被墙服务用）
HTTP_PROXY=http://127.0.0.1:7897
```

`server/config.json` 里改一下基本信息：

```json
{
  "user": { "name": "你的昵称", "city": "Shenzhen" },
  "claude": { "model": "claude-sonnet-4-6" }
}
```

### 3️⃣ 登录网易云（获取 cookie）

```bash
cd server && node scripts/ncm-login.js
```

终端会出现一个 ASCII 二维码，用网易云 APP 扫码。登录成功后 cookie 自动写入 `.env`。

### 4️⃣ 启动网易云 API 引擎

```bash
npx -y NeteaseCloudMusicApi --port 3000
```

保持窗口开着，这是 Claudio 的曲库。

### 5️⃣ 喊醒 Claudio

再开一个终端：

```bash
cd server && node index.js
```

打开 `http://localhost:8080`，对着聊天框说话 🎉

### 🧹 关掉

```bash
taskkill //F //IM node.exe
```

> **已知限制**：Fish Audio TTS 需要 HTTP 代理 + 账户余额，当前语音合成不可用。核心 DJ 功能不受影响。

---

## 📡 API 一览

| 🔧 方法 | 🛣️ 路径 | 💬 它会 |
|---|---|---|
| `POST` | `/api/chat` | 跟你聊天 + 给你排歌 + 生成 DJ 串词 |
| `GET` | `/api/now` | 告诉你现在在播什么 |
| `GET` | `/api/next` | 剧透下一首 |
| `GET` | `/api/search?q=` | 在网易云里翻箱倒柜 |
| `GET` | `/api/song/:id` | 掏出某首歌的链接和歌词 |
| `GET` | `/api/taste` | 回忆你的品味档案 |
| `GET` | `/api/plan/today` | 报告今天的音乐计划 |
| `⚡` | `/stream` | WebSocket 实时心跳：当前曲目、DJ 播报、进度更新 |

---

## 🧭 走到哪了

- [x] 🏗️ 工程骨架 + 配置系统 + SQLite 记忆库
- [x] 🧠 Claude HTTP API 直连 + 6 片 Context 炼金（含网易云真实数据）
- [x] 🌤️🎵 天气 + 网易云全链路集成（QR 登录 / cookie / 用户数据）
- [x] 🌐 9 条 HTTP 端点 + WebSocket 实时心跳
- [x] 📱 PWA 三视图 + 视觉规范落地 + Service Worker
- [x] ⚡ 速度优化（25s → 7.8s，CLI 子进程改为 HTTP 直连）
- [ ] 🗣️ Fish Audio TTS（需代理 + 账户余额）
- [ ] 📝 用户品味语料填充（taste / routines / mood-rules）
- [ ] 🎙️ DJ 播报词灵魂调优
- [ ] 📻 UPnP 推到客厅音响
- [ ] ✨ PWA 细节像素级打磨（点阵时钟 / 天气角标）

---

## 📂 翻开看看

```
claudio/
├── server/                     # 🧠 中枢神经系统
│   ├── index.js                #   总闸
│   ├── config.json             #   你的秘密（gitignore 护体）
│   ├── config.example.json     #   空白表格
│   ├── state/                  #   💾 记忆库
│   ├── core/                   #   🧬 大脑皮层（Claude + Context）
│   ├── integrations/           #   🔌 感官组件（天气/网易云/TTS/日历）
│   ├── network/                #   📡 神经传导（Router + WebSocket）
│   └── scheduler/              #   ⏰ 生物钟
├── public/                     # 🎭 皮囊（PWA）
│   ├── index.html              #   三视图切换
│   ├── css/app.css             #   视觉规范的每一行
│   ├── js/app.js               #   交互逻辑
│   ├── sw.js                   #   离线也能用
│   └── manifest.json           #   可以被「安装」
├── prompts/dj-persona.md       # 🎙️ Claudio 的人格剧本
├── user/                       # 📓 你的音乐日记
├── Architecture/               # 🏛️ 设计蓝图
├── Pageprototype/              # 🎨 颜值原型
└── docs/devlog.md              # 📝 从 0 到 1 的每一脚
```

---

## 🫶 为什么做这个

每天和 Claude Code 多线程协作，注意力烧干了 🔥。

我需要一个放在侧屏幕上的东西——不催我、不卷我、不给我弹通知。

它只是在我盯着代码的时候，安安静静地切一首对的歌 🎵。

Claudio 是我的「反效率」实验。

如果你也觉得生活需要一点温柔的白噪音，欢迎把它装到你的机器里 ✨

---

## 📜 License

MIT —— 拿去改成你喜欢的样子 🎸
