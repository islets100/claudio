let accessToken = null;
let tokenExpiresAt = 0;

async function getToken(config) {
  if (accessToken && Date.now() < tokenExpiresAt - 60000) {
    return accessToken;
  }

  const appId = config.calendar?.app_id;
  const appSecret = config.calendar?.app_secret;
  if (!appId || !appSecret || appId.startsWith("你的")) return null;

  try {
    const res = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      }
    );
    const data = await res.json();
    if (data.code !== 0) {
      console.error("Feishu token error:", data.msg);
      return null;
    }
    accessToken = data.tenant_access_token;
    tokenExpiresAt = Date.now() + (data.expire || 7200) * 1000;
    return accessToken;
  } catch (err) {
    console.error("Feishu token exception:", err.message);
    return null;
  }
}

async function getTodayEvents(config) {
  if (!config.calendar?.enabled) return [];

  const token = await getToken(config);
  if (!token) return [];

  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  try {
    const calRes = await fetch(
      "https://open.feishu.cn/open-apis/calendar/v4/calendars",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const calData = await calRes.json();
    if (calData.code !== 0) return [];

    const calendars = calData.data?.calendar_list || [];
    if (calendars.length === 0) return [];

    const primaryCal = calendars[0].calendar_id;
    const evtRes = await fetch(
      `https://open.feishu.cn/open-apis/calendar/v4/calendars/${primaryCal}/events?start_time=${startOfDay.toISOString()}&end_time=${endOfDay.toISOString()}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const evtData = await evtRes.json();
    if (evtData.code !== 0) return [];

    return (evtData.data?.items || []).map((e) => ({
      title: e.summary || "no title",
      time: e.start_time?.date_time
        ? new Date(e.start_time.date_time).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "all day",
      location: e.location?.name || "",
    }));
  } catch (err) {
    console.error("Feishu calendar error:", err.message);
    return [];
  }
}

module.exports = { getTodayEvents };
