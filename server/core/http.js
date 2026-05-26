/**
 * HTTP 工具模块
 *
 * 默认直连。需要代理的服务可调用 proxyFetch 并传入含 proxy.url 的 config。
 */

const http = require("http");
const https = require("https");

function getProxyUrl(config = {}) {
  return config?.proxy?.url || process.env.HTTP_PROXY || process.env.http_proxy || null;
}

/**
 * 需要代理时使用此函数，其余情况用原生 fetch 直连即可。
 * 使用 https-proxy-agent + Node.js 原生 https/http 模块，避免 undici 版本冲突。
 */
async function proxyFetch(url, options = {}, config = {}) {
  const proxyUrl = getProxyUrl(config);
  if (!proxyUrl) return fetch(url, options);

  const { HttpsProxyAgent } = require("https-proxy-agent");
  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === "https:";
  const agent = new HttpsProxyAgent(proxyUrl);
  const headers = { ...(options.headers || {}) };

  // 移除 hop-by-hop 头，避免 Content-Length 与实际 body 不匹配等问题
  delete headers["content-length"];
  delete headers["transfer-encoding"];

  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: options.method || "GET",
        headers,
        agent,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: res.headers,
            arrayBuffer: async () => buffer,
            text: async () => buffer.toString(),
            json: async () => JSON.parse(buffer.toString()),
          });
        });
      }
    );

    req.on("error", reject);

    // 支持 AbortSignal（用于超时等场景）
    if (options.signal) {
      options.signal.addEventListener("abort", () => req.destroy());
    }

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

module.exports = { proxyFetch, getProxyUrl };
