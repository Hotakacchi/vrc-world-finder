// VRChat APIとのやり取り
// APK版: CapacitorHttp (ネイティブ通信) で直接VRChatへ。CORSの制限なし、クッキーはAndroidが保存する
// ブラウザ版: PCの中継サーバー (/vrc/*) 経由。クッキーはサーバーが保存する
const Vrc = (() => {
  const API = "https://api.vrchat.cloud/api/1";
  const USER_AGENT = "VRCWorldFinder/0.2.0 (personal Quest world search tool)";
  const worldCache = new Map();
  let me = null;

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  function parse(data) {
    if (typeof data !== "string") return data || {};
    try {
      return JSON.parse(data);
    } catch {
      return { raw: data };
    }
  }

  async function raw(method, path, { body, headers = {} } = {}) {
    const h = { ...(body ? { "Content-Type": "application/json" } : {}), ...headers };
    if (isNative()) {
      const res = await window.Capacitor.Plugins.CapacitorHttp.request({
        url: API + path,
        method,
        headers: { "User-Agent": USER_AGENT, ...h },
        data: body,
      });
      return { status: res.status, data: parse(res.data) };
    }
    const res = await fetch("/vrc" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: parse(await res.text()) };
  }

  async function call(method, path, opts, fallback = "通信に失敗しました") {
    const r = await raw(method, path, opts);
    if (r.status === 401) throw new ApiError(401, "ログインが必要です");
    if (r.status < 200 || r.status >= 300) {
      throw new ApiError(r.status, (r.data && r.data.error && r.data.error.message) || `${fallback} (${r.status})`);
    }
    return r.data;
  }

  async function clearNativeCookies() {
    if (isNative()) await window.Capacitor.Plugins.CapacitorCookies.clearCookies({ url: API });
  }

  // offset付きのAPIを最大maxPages回たどって全部取る
  async function paged(pathFn, n, maxPages) {
    const all = [];
    for (let page = 0; page < maxPages; page++) {
      const items = await call("GET", pathFn(n, page * n));
      all.push(...items);
      if (items.length < n) break;
    }
    return all;
  }

  return {
    ApiError,

    // ---- 認証 ----
    async currentUser() {
      const r = await raw("GET", "/auth/user");
      if (r.status === 200 && r.data.id) {
        me = r.data;
        return { user: me };
      }
      if (r.status === 200 && r.data.requiresTwoFactorAuth) return { twoFactor: r.data.requiresTwoFactorAuth };
      return {};
    },

    async login(username, password) {
      await clearNativeCookies();
      const basic = btoa(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`);
      const r = await raw("GET", "/auth/user", { headers: { Authorization: `Basic ${basic}` } });
      if (r.status !== 200) {
        throw new ApiError(r.status, (r.data.error && r.data.error.message) || "ログインに失敗しました");
      }
      if (r.data.requiresTwoFactorAuth) return { twoFactor: r.data.requiresTwoFactorAuth };
      me = r.data;
      return { user: me };
    },

    async verify2fa(method, code) {
      const endpoint = {
        totp: "/auth/twofactorauth/totp/verify",
        otp: "/auth/twofactorauth/otp/verify",
        emailOtp: "/auth/twofactorauth/emailotp/verify",
      }[method];
      const r = await raw("POST", endpoint, { body: { code: String(code || "").trim() } });
      if (r.status !== 200 || r.data.verified === false) {
        throw new ApiError(400, (r.data.error && r.data.error.message) || "コードが正しくありません");
      }
      return this.currentUser();
    },

    async logout() {
      await raw("PUT", "/logout").catch(() => {});
      await clearNativeCookies();
      me = null;
      worldCache.clear();
    },

    // ---- ワールド ----
    searchWorlds({ search = "", sort = "popularity", quest = false, n = 50, offset = 0, tag = "" } = {}) {
      const p = new URLSearchParams({ n, offset, sort, order: "descending", releaseStatus: "public" });
      if (search) p.set("search", search);
      if (quest) p.set("platform", "android");
      if (tag) p.set("tag", tag);
      return call("GET", `/worlds?${p}`, {}, "検索に失敗しました");
    },

    async getWorld(id, { fresh = false } = {}) {
      if (!fresh && worldCache.has(id)) return worldCache.get(id);
      const w = await call("GET", `/worlds/${id}`, {}, "ワールド情報を取得できません");
      worldCache.set(id, w);
      return w;
    },

    recentWorlds() {
      return call("GET", "/worlds/recent?n=100", {}, "最近のワールドを取得できません");
    },

    // ---- お気に入り ----
    favoriteWorlds() {
      return paged((n, offset) => `/worlds/favorites?n=${n}&offset=${offset}`, 100, 5);
    },

    favoriteGroups() {
      return call("GET", "/favorite/groups?type=world&n=50", {}, "お気に入りグループを取得できません");
    },

    addFavorite(worldId, group) {
      return call("POST", "/favorites", { body: { type: "world", favoriteId: worldId, tags: [group] } }, "お気に入りに追加できません");
    },

    removeFavorite(favoriteId) {
      return call("DELETE", `/favorites/${favoriteId}`, {}, "お気に入りから削除できません");
    },

    // ---- フレンド ----
    onlineFriends() {
      return paged((n, offset) => `/auth/user/friends?offline=false&n=${n}&offset=${offset}`, 100, 5);
    },

    // ---- インスタンス・招待 ----
    inviteMe(location) {
      return call("POST", `/invite/myself/to/${location}`, {}, "招待を送れませんでした");
    },

    async createInstanceAndInvite(worldId, type, region) {
      if (!me) await this.currentUser();
      if (!me) throw new ApiError(401, "ログインが必要です");
      const body = { worldId, type, region };
      if (type !== "public") body.ownerId = me.id;
      if (type === "private") body.canRequestInvite = false;
      const inst = await call("POST", "/instances", { body }, "インスタンスを作成できませんでした");
      const location = inst.location || `${worldId}:${inst.instanceId}`;
      await this.inviteMe(location);
      return location;
    },
  };
})();
