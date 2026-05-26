class NCMClient {
  constructor(baseUrl = "http://localhost:3000", cookie = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.cookie = cookie;
  }

  async _get(path, params = {}) {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`NCM ${path} returned ${res.status}`);
    return res.json();
  }

  /** 确保请求携带 cookie */
  _authParams(extra = {}) {
    return this.cookie ? { cookie: this.cookie, ...extra } : extra;
  }

  // ---- 基础 ----

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
    const data = await this._get("/song/url/v1", this._authParams({ id: songId, level: "exhigh" }));
    if (data.code !== 200 || !data.data?.[0]) return null;
    return { url: data.data[0].url, br: data.data[0].br };
  }

  async getLyric(songId) {
    const data = await this._get("/lyric", { id: songId });
    if (data.code !== 200) return null;
    return { lyric: data.lrc?.lyric || "", tlyric: data.tlyric?.lyric || "" };
  }

  // ---- 用户相关（需要 cookie） ----

  /** 获取用户歌单列表（创建 + 收藏） */
  async getUserPlaylists(uid) {
    const params = this._authParams();
    if (uid) params.uid = uid;
    const data = await this._get("/user/playlist", params);
    if (data.code !== 200) return [];
    return (data.playlist || []).map((pl) => ({
      id: String(pl.id),
      name: pl.name,
      trackCount: pl.trackCount,
      playCount: pl.playCount,
      creator: pl.creator?.nickname || "",
      subscribed: pl.subscribed,
    }));
  }

  /** 获取喜欢的歌曲列表 */
  async getLikedSongs(uid) {
    const params = this._authParams();
    if (uid) params.uid = uid;
    const data = await this._get("/likelist", params);
    if (data.code !== 200) return [];
    return (data.ids || []).map((id) => String(id));
  }

  /** 获取歌单详情 */
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

  /** 获取听歌历史（最近 N 首） */
  async getHistory(limit = 50) {
    const data = await this._get("/record/recent/song", this._authParams());
    if (data.code !== 200) return [];
    return ((data.data?.list || []).slice(0, limit)).map((item) => ({
      id: String(item.data?.id || ""),
      name: item.data?.name || "",
      artist: (item.data?.ar || []).map((a) => a.name).join("/"),
      playTime: item.playTime,
      playCount: item.data?.playCount || 0,
    }));
  }

  /** 获取日推 */
  async getRecommend() {
    const data = await this._get("/recommend/songs", this._authParams());
    if (data.code !== 200) return [];
    return (data.data?.dailySongs || []).map((s) => ({
      id: String(s.id),
      name: s.name,
      artist: (s.ar || []).map((a) => a.name).join("/"),
    }));
  }

  /** 获取用户信息 */
  async getUserInfo() {
    const data = await this._get("/user/account", this._authParams());
    if (data.code !== 200) return null;
    return {
      id: data.profile?.userId,
      nickname: data.profile?.nickname,
      avatar: data.profile?.avatarUrl,
    };
  }
}

module.exports = { NCMClient };
