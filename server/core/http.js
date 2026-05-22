/**
 * HTTP 工具模块
 *
 * 默认直连。需要代理的服务可调用 proxyFetch 并传入含 proxy.url 的 config。
 */

function getProxyUrl(config = {}) {
  return config?.proxy?.url || process.env.HTTP_PROXY || process.env.http_proxy || null;
}

/**
 * 需要代理时使用此函数，其余情况用原生 fetch 直连即可
 */
async function proxyFetch(url, options = {}, config = {}) {
  const proxyUrl = getProxyUrl(config);
  if (!proxyUrl) return fetch(url, options);

  try {
    const { ProxyAgent } = require("undici");
    const agent = new ProxyAgent(proxyUrl);
    return fetch(url, { ...options, dispatcher: agent });
  } catch {
    return fetch(url, options);
  }
}

module.exports = { proxyFetch, getProxyUrl };
