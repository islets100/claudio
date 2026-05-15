async function getWeather(config) {
  const apiKey = config.weather?.api_key;
  if (!apiKey || apiKey.startsWith("你的")) {
    console.warn("OpenWeather API Key not configured, skipping weather");
    return null;
  }

  const city = config.user?.city || "Shanghai";
  const { lat, lon } = config.weather || {};

  let url;
  if (lat && lon && lat !== 0 && lon !== 0) {
    url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=zh_cn`;
  } else {
    url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=zh_cn`;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error("OpenWeather request failed:", res.status);
      return null;
    }
    const data = await res.json();
    return {
      description: data.weather?.[0]?.description || "unknown",
      temp: Math.round(data.main?.temp),
      feelsLike: Math.round(data.main?.feels_like),
      humidity: data.main?.humidity,
      icon: data.weather?.[0]?.icon || "",
      city: data.name || city,
    };
  } catch (err) {
    console.error("OpenWeather error:", err.message);
    return null;
  }
}

module.exports = { getWeather };
