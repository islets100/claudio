const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { proxyFetch } = require("../core/http");

const CACHE_DIR = path.join(__dirname, "..", "..", "cache", "tts");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function hashText(text, voiceId = "default") {
  return crypto.createHash("md5").update(text + voiceId).digest("hex");
}

async function synthesize(text, config) {
  const apiKey = config.tts?.api_key;
  if (!apiKey || apiKey === "你的 Fish Audio API Key") {
    console.warn("Fish Audio API Key not configured, skipping TTS");
    return null;
  }

  const baseUrl = config.tts?.base_url || "https://api.fish.audio";
  const voiceId = config.tts?.voice_id || "default";

  ensureCacheDir();

  const hash = hashText(text, voiceId);
  const cachePath = path.join(CACHE_DIR, `${hash}.mp3`);

  if (fs.existsSync(cachePath)) {
    return `/tts/${hash}.mp3`;
  }

  try {
    const res = await proxyFetch(`${baseUrl}/v1/tts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, voice_id: voiceId, format: "mp3" }),
    }, config);

    if (!res.ok) {
      console.error("Fish Audio request failed:", res.status);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(cachePath, buffer);
    return `/tts/${hash}.mp3`;
  } catch (err) {
    console.error("Fish Audio TTS error:", err.message);
    return null;
  }
}

module.exports = { synthesize };
