class NCMClient {
  constructor(baseUrl = "http://localhost:3000") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async _get(path, params = {}) {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`NCM ${path} returned ${res.status}`);
    return res.json();
  }

  async search(keyword, limit = 5) {
    const data = await this._get("/search", { keywords: keyword, limit });
    if (data.code !== 200) return [];
    return (data.result?.songs || []).map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.artists || []).map((a) => a.name).join("/"),
      album: s.album?.name || "",
      duration: s.duration,
    }));
  }

  async getSongUrl(songId) {
    const data = await this._get("/song/url/v1", { id: songId, level: "standard" });
    if (data.code !== 200 || !data.data?.[0]) return null;
    return { url: data.data[0].url, br: data.data[0].br };
  }

  async getLyric(songId) {
    const data = await this._get("/lyric", { id: songId });
    if (data.code !== 200) return null;
    return { lyric: data.lrc?.lyric || "", tlyric: data.tlyric?.lyric || "" };
  }

  async getRecommend(cookie) {
    const data = await this._get("/recommend/songs", { cookie });
    if (data.code !== 200) return [];
    return (data.data?.dailySongs || []).map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.ar || []).map((a) => a.name).join("/"),
    }));
  }

  async getPlaylist(playlistId) {
    const data = await this._get("/playlist/detail", { id: playlistId });
    if (data.code !== 200) return null;
    const pl = data.playlist;
    return {
      id: String(pl.id),
      name: pl.name,
      tracks: (pl.tracks || []).map((t) => ({
        id: String(t.id),
        name: t.name,
        artist: (t.ar || []).map((a) => a.name).join("/"),
      })),
    };
  }
}

module.exports = { NCMClient };
