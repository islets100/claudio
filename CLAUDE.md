# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Claudio 是一个**具备环境感知能力的情感化 AI 音乐助手 / 个人电台 DJ**。它不只是播放器，而是结合用户地理位置、天气、日程和听歌历史，生成带有"叙事感"音乐体验的 Agent。

核心闭环：**前端 PWA 播放器 ← WebSocket/HTTP → 本地 Node.js 中枢服务器 ← 子进程调用 → Claude Code（大脑）+ 网易云音乐 API + Fish Audio TTS + 飞书日历 + OpenWeather + UPnP 硬件调度**

## 架构：四层施工图

项目按 `Architecture/claudio_architecture.html` 定义的四层结构组织：

### 第一层 — 外部上下文
- **用户品味语料**：`taste.md` / `routines.md` / `playlists.json` / `mood-rules.md`（结构化喂给 Claude 的长期记忆）
- **Claude Code**：通过 `claude -p --output json` 子进程调用，作为自然语言理解与 DJ 播报词生成的大脑
- **NeteaseCloudMusicApi**：歌曲检索、直链、歌词、推荐
- **Voice · I/O**：Fish Audio TTS → 语音合成；飞书 API → 日程；OpenWeather → 天气；UPnP → 客厅音响推送

### 第二层 — 本地大脑（Node.js 中枢）
按功能域分目录：

| 目录 | 文件 | 职责 |
|---|---|---|
| `server/core/` | `context.js`, `claude.js` | 大脑：prompt 组装 + Claude CLI 子进程适配 |
| `server/integrations/` | `weather.js`, `ncm.js`, `tts.js`, `calendar.js` | 外部 API 客户端，每文件一个服务 |
| `server/network/` | `router.js`, `ws.js` | 传输：意图分流 + WebSocket 管理 |
| `server/scheduler/` | `scheduler.js` | cron 定时任务（07:00 / 09:00 / 整点） |
| `server/state/` | `state.js` | SQLite 持久化（messages/plays/plan/prefs 四表） |
| `server/` | `index.js` | 入口：组装模块 + 启动 HTTP/WS 服务 |

### 第三层 — 运行时聚合（Context Window）
每次触发时按 6 片粘成 prompt：
1. 系统提示词（`prompts/dj-persona.md`）
2. 用户语料（`user/*.md`）
3. 环境注入（weather · calendar · now）
4. 已检索记忆（state.db · plays）
5. 用户输入 / 工具结果（`/api/chat` · ncm search）
6. 执行轨迹（scheduler · webhook）

模型前向过程输出 `{say, play[], reason, segue}`，然后 ncm 解析 queue、tts 合成 say、WS 推送 now-playing。

### 第四层 — 交互表层
- **PWA**（localhost:8080）：Player / Profile / Settings 三视图，单 `<audio>` 元素，WebSocket 流式聊天，Service Worker 缓存壳层，prefetch 10s
- **HTTP Contract**（6 条线）：`POST /api/chat`、`GET /api/now`、`GET /api/next`、`GET /api/taste`、`GET /api/plan/today`、`WS /stream`

## 视觉设计语言：点阵复古未来主义

Claudio 的 UI 审美是项目核心差异化之一。所有前端实现必须遵循以下规范：

### 配色
- 全局底色：`#0d0d0d`（极黑，叠加点阵噪点纹理）
- 深色模式面板：`#0f0f13`（带极深紫色调）
- 浅色模式面板：`#f0f0f7`（带淡淡薰衣草紫的粉白）
- 播放器卡片（Light）：纯白 `#ffffff`，圆角 `border-radius: 24px`
- 文本高亮：浅绿背景 `#d1fadf`，文字纯黑
- 强调绿：`#00ff88`（ON AIR 指示灯等）
- 点阵底纹：`background-image: radial-gradient(#1a1a1a 1px, transparent 1px); background-size: 25px 25px;`

### 字体
- 等宽/代码元素：`JetBrains Mono`
- 中文正文：`Noto Sans SC`
- Logo/品牌名使用 `JetBrains Mono`，`letter-spacing: 2px`，带发光 `text-shadow`

### 关键动效参数
- 卡片切入：`cubic-bezier(0.22, 1, 0.36, 1)`（Out-Expo），`600ms`
- 消息进入：使用 spring 物理缓动（y 轴位移 + 缩放弹动），不是简单 fade
- 歌词高亮：timestamp 驱动的"滑动滑块"式逐字点亮，不是整体变色
- 波形图：Web Audio API `AnalyserNode` 驱动，`fftSize: 256`，`smoothingTimeConstant: 0.8`
- 主题切换：全局 `transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1)`

### 核心 UI 组件特征
- **镜像对称波形进度条**：以中心水平线为轴上下等距延伸，极高密度细线，左侧纯黑/右侧淡灰的硬截断（非渐变），叠加 ±2px 呼吸感 jitter
- **顶部破碎波形**：高频噪声叠加制造"刺头"参差感，锐利错落
- **点阵时钟**：5×7 或 7×9 像素点阵数字，推荐 `Silkscreen` 字体或 Canvas 绘制
- **聊天流**：半透明黑色气泡 + 微弱边框高亮，带圆形头像和极简输入框
- **3D 点阵球体**：Canvas 或 Three.js `Points` 材质旋转球体，用于个人主页弹窗
- **毛玻璃**：`backdrop-filter: blur(20px) saturate(180%)`

### 可以参考的原型文件
- `Pageprototype/card.html` — 最简播放器卡片（波形 + 逐字高亮）
- `Pageprototype/onepage.html` — 镜像波形进度条独立组件（75 条采样线 + 点击交互）
- `Pageprototype/twopage.html` — 完整手机框架集成（深色背景 + 点阵底纹 + 顶部破碎波形 + 中部镜像进度条 + 歌词 KTV 高亮 + 底部导航）

## 产品路线路哲学

来自 `Pending_determination/micservice.md` 的核心决策：

### 开发策略：先个人 Agent，再产品化
- **阶段 1**：只为自己做，但数据必须参数化（读 JSON，不硬编码），打磨 AI 灵魂和动态 UI
- **阶段 2**：把本地 JSON 搬到数据库，引入多租户，定义标准化接口
- **阶段 3**：SaaS 化 —— 知识图谱 + RAG + 向量数据库 + 多端 App

### 关键工程原则
- 所有用户相关数据从 `config.json` 读取，绝不硬编码姓名/城市/偏好
- 先定义数据契约（用户画像 JSON 规范），再写逻辑
- 敏感生活数据放本地（IndexedDB），只将脱敏向量指纹传云端
- "算法"本质是"如果...那么..."规则 + LLM 推理，不需要传统推荐系统

### 三层产品架构
- **感知层**：物理轨迹、生活数据、品味语料
- **思考层**：长期记忆（向量库）+ 即时策略 + LLM 脚本生成
- **表现层**：点阵 UI + 情感化 TTS + 手势交互

## 目录结构含义

- `Architecture/` — 系统结构图和施工图（HTML 可渲染版本 + PNG + PDF），是理解架构的权威来源
- `Pageprototype/` — 交互原型截图 + HTML 复现 + 总体视觉描述文档，是前端实现的审美标准
- `Inspiration/` — 原始灵感视频（含英文字幕）
- `Pending_determination/` — 产品化思路讨论，包含从个人脚本到 SaaS 的跃迁方案

## 仓库文件清单与阅读指引

本仓库目前是**设计/规划阶段**，尚无运行时代码。每个文件都有其存在理由：

### Architecture/（架构权威来源）
- `claudio_architecture.html` — **四层施工图**（主文件），用 HTML/CSS 渲染的完整系统架构图，定义每一层的模块、职责和数据流向
- `claudio_macro_structure.html` — **宏观结构图**，展示播放器界面、本地服务器、几个 API 三大部分的关系
- `Claudio 的施工图.pdf` — 施工图的 PDF 导出（1页），内容与 HTML 一致
- `Claudio 系统结构图.pdf` — 宏观结构图的 PDF 导出（1页），内容与 HTML 一致
- `施工图第一~四层.png` — 四层施工图的 PNG 截图（深色主题，95%+ 暗区）
- `系统结构图.png` — 宏观结构图的 PNG 截图

### Pageprototype/（前端审美标准）
- `总体描述.md` — **最重要的视觉参考文档**（749行），包含：原创作者语音讲解转录、配色/动效/字体的像素级参数、镜像波形算法、KTV歌词高亮逻辑、点阵时钟规范、Dashboard布局拆解、聊天流设计、3D点阵球体建议
- `card.html` — **最简播放器卡片原型**：白色卡片 + 简单波形 CSS 动画 + 逐句高亮切换
- `onepage.html` — **镜像波形进度条独立组件**：75条采样线 + 叠加 sin 算法 + flex居中对称 + 硬截断着色 + ±2px jitter + 点击跳转
- `twopage.html` — **完整手机框架集成**：深色点阵背景 + 顶部破碎波形（45条高频噪声）+ 白色主卡片 + 歌词KTV逐字点亮 + 中部镜像进度条 + 底部导航
- `动态面1-1/1-2/1-3帧.png` — 播放器核心组件截图（41%亮区，白色卡片在深色背景上）
- `动态面2dark-1/2-2帧.png` — 深色模式 Dashboard 截图（89-90%暗区，含点阵时钟+聊天流）
- `动态面2light-1帧.png` — 浅色模式 Dashboard 截图（94%亮区，粉白薰衣草底色）
- `动态面dark2-2帧.png` — 另一深色模式帧（93%暗区）
- `交互1-1/1-2/1-3帧.png` — 交互序列截图（89-95%暗区）
- `agent操作演示.png` / `agent演示1.png` — 终端后台日志截图（60-66%暗区，显示飞书/天气/网易云数据集成、场景化逻辑、多端设备调度）
- `页面3-1.png` / `页面4-1.png` — 后台系统日志截图（92-96%暗区）
- `gemini_generated_example.jpg` — Gemini 生成的 UI 示例参考图

### Inspiration/
- `clauido-web-en.mp4` — 原创作者的英文介绍视频（含英文字幕），内容转录在 `总体描述.md` 第一部分

### Pending_determination/
- `micservice.md` — 产品化路线图（400行），讨论从本地脚本→SaaS 的完整演进路径、数据契约设计、隐私策略、「算法=规则+LLM推理」的核心论点

## 技术栈方向

- 后端中枢：Node.js（MVP 阶段）
- AI 大脑：Claude Code CLI（`claude -p` 子进程，结构化 JSON 输出）
- 音乐数据：NeteaseCloudMusicApi（开源网易云 API）
- TTS：Fish Audio
- 前端：PWA（原生 HTML/CSS/JS，不用框架），Service Worker 离线缓存
- 实时通信：WebSocket（`/stream` 端点）
- 后续可升级：Go-Micro / Spring Cloud 微服务、PostgreSQL + Neo4j + Milvus、Flutter/React Native App
