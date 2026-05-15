// ws.js — WebSocket 管理
//
// 职责：管理 /stream 端点的 WebSocket 连接，向所有连接的客户端推送事件。
// 对应施工图第四层 WebSocket 流式聊天 + now-playing 推送。
//
// 推送事件类型：
//   now_playing  — 当前播放曲目变化
//   state_change — 播放状态变化（play/pause/stop）
//   chat_reply   — Claudio 的聊天回复（含逐字时间戳）
//   progress     — 播放进度更新

const { WebSocketServer } = require('ws');

let wss = null;
let clients = new Set();

/**
 * 将 WebSocket 挂载到 HTTP server
 */
function init(server) {
  wss = new WebSocketServer({ server, path: '/stream' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[ws] 客户端连接 (共 ${clients.size} 个)`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[ws] 客户端断开 (剩余 ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[ws] 客户端错误:', err.message);
      clients.delete(ws);
    });

    // 发送欢迎消息
    ws.send(JSON.stringify({ type: 'connected', time: new Date().toISOString() }));
  });

  return wss;
}

/**
 * 向所有客户端广播事件
 * @param {string} type — 事件类型
 * @param {object} data — 事件数据
 */
function broadcast(type, data = {}) {
  if (!wss) return;
  const msg = JSON.stringify({ type, ...data, time: new Date().toISOString() });
  for (const ws of clients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(msg);
    }
  }
}

/**
 * 向单个客户端发送事件
 */
function send(ws, type, data = {}) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type, ...data, time: new Date().toISOString() }));
  }
}

/**
 * 推送当前播放曲目
 */
function pushNowPlaying(track) {
  broadcast('now_playing', { track });
}

/**
 * 推送播放状态变化
 */
function pushStateChange(state) {
  broadcast('state_change', { state }); // playing | paused | stopped
}

/**
 * 推送聊天回复（Claudio 的响应消息）
 */
function pushChatReply(reply) {
  broadcast('chat_reply', { reply }); // { say, reason, tts_url, timestamp_map }
}

module.exports = { init, broadcast, send, pushNowPlaying, pushStateChange, pushChatReply };
