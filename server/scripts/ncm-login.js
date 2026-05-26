/**
 * 网易云音乐扫码登录脚本
 *
 * 用法：node server/scripts/ncm-login.js
 *
 * 流程：
 *   1. 调用 /login/qr/key 获取扫码用的 unikey
 *   2. 调用 /login/qr/create 获取二维码链接
 *   3. 在终端直接打印二维码，用手机网易云 App 扫码确认
 *   4. 自动将 cookie 写入项目根目录 .env 文件
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const NCM_BASE = "http://localhost:3000";
const ENV_PATH = path.join(__dirname, "..", "..", ".env");

function httpGet(url) {
  const lib = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

function saveCookie(cookie) {
  if (!cookie || cookie.length < 50) {
    console.error("❌ 获取到的 cookie 无效:", cookie);
    return;
  }
  let envContent = "";
  if (fs.existsSync(ENV_PATH)) {
    envContent = fs.readFileSync(ENV_PATH, "utf-8");
  }

  // 用字符串替换处理超长 cookie 行
  const lines = envContent.split("\n");
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("NCM_COOKIE=")) {
      lines[i] = "NCM_COOKIE=" + cookie;
      found = true;
      break;
    }
  }
  if (!found) {
    lines.push("NCM_COOKIE=" + cookie);
  }
  fs.writeFileSync(ENV_PATH, lines.join("\n"));
  console.log(`\n✅ Cookie 已写入 ${ENV_PATH}`);
}

async function main() {
  console.log("🎵 Claudio — 网易云音乐扫码登录\n");

  // 检查 NCM 服务是否在运行
  try {
    await httpGet(`${NCM_BASE}/search?keywords=test`);
  } catch {
    console.error("❌ 网易云 API 服务未在 http://localhost:3000 运行");
    console.error("   请先启动 NeteaseCloudMusicApi");
    process.exit(1);
  }

  // Step 1: 获取 unikey
  console.log("📡 正在连接网易云...");
  const keyData = await httpGet(`${NCM_BASE}/login/qr/key`);
  const unikey = keyData.data?.unikey;
  if (!unikey) {
    console.error("❌ 获取扫码密钥失败:", JSON.stringify(keyData));
    process.exit(1);
  }

  // Step 2: 创建二维码
  const qrData = await httpGet(`${NCM_BASE}/login/qr/create?key=${unikey}&qrimg=true`);
  const qrUrl = qrData.data?.qrurl;
  if (!qrUrl) {
    console.error("❌ 生成二维码失败:", JSON.stringify(qrData));
    process.exit(1);
  }

  // Step 3: 在终端打印二维码
  const qrcode = require("qrcode-terminal");
  console.log("\n📱 请用手机网易云 App 扫描下方二维码：\n");
  qrcode.generate(qrUrl, { small: true });
  console.log("\n⏳ 等待扫码确认...（有效期 3 分钟）\n");

  // Step 4: 轮询等待扫码确认
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const checkData = await httpGet(`${NCM_BASE}/login/qr/check?key=${unikey}`);
    const code = checkData.code;

    if (code === 800) {
      console.log("⏳ 二维码已过期，请重新运行脚本");
      process.exit(1);
    }
    if (code === 803) {
      // 登录成功
      saveCookie(checkData.cookie);
      console.log("✅ 扫码登录成功！");
      if (checkData.data?.nickname) {
        console.log(`   👤 ${checkData.data.nickname}，欢迎回来`);
      }
      console.log("\n💡 重启 Claudio 后 cookie 自动生效，即可读取歌单和听歌历史");
      process.exit(0);
    }
    if (i === 0) {
      // 首次轮询不打印
    } else if (code === 802) {
      console.log("📱 已扫码，请在手机上确认...");
    } else if (i % 10 === 0) {
      console.log(`⏳ 等待中... (${Math.round(i * 2 / 60)} 分钟)`);
    }
  }
  console.log("⏳ 等待超时（3 分钟），请重试");
  process.exit(1);
}

main().catch((err) => {
  console.error("登录异常:", err.message);
  process.exit(1);
});
