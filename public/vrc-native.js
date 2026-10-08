// APK版: PCサーバーを使わず、アプリから直接VRChat APIを呼ぶ
// server.js の /api/* と同じ入出力にしてあるので、app.js はどちらでも同じように動く
// 通信は CapacitorHttp (ネイティブ) 経由なのでCORSの制限を受けず、
// 認証クッキーはAndroidのCookieManagerに自動で保存・送信される
const VrcNative = (() => {
  const API = "https://api.vrchat.cloud/api/1";
  const USER_AGENT = "VRCWorldFinder/0.1.0 (personal Quest world search tool)";
  const Http = () => window.Capacitor.Plugins.CapacitorHttp;
  let me = null;

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function vrc(method, path, { body, headers = {} } = {}) {
    const res = await Http().request({
      url: API + path,
      method,
      headers: {
        "User-Agent": USER_AGENT,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      data: body,
    });
    let data = res.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        data = { raw: data };
      }
    }
    return { status: res.status, data: data || {} };
  }

  function errorMessage(data, fallback) {
    return (data && data.error && data.error.message) || fallback;
  }

  const routes = {
    async "GET /api/me"() {
      const r = await vrc("GET", "/auth/user");
      if (r.status === 200 && r.data.id) {
        me = r.data;
        return { loggedIn: true, displayName: me.displayName };
      }
      if (r.status === 200 && r.data.requiresTwoFactorAuth) {
        return { loggedIn: false, twoFactor: r.data.requiresTwoFactorAuth };
      }
      return { loggedIn: false };
    },

    async "POST /api/login"(_, { username, password }) {
      if (!username || !password) throw new ApiError(400, "ユーザー名とパスワードを入力してください");
      await window.Capacitor.Plugins.CapacitorCookies.clearCookies({ url: API });
      const basic = btoa(`${encodeURIComponent(username)}:${encodeURIComponent(password)}`);
      const r = await vrc("GET", "/auth/user", { headers: { Authorization: `Basic ${basic}` } });
      if (r.status !== 200) throw new ApiError(401, errorMessage(r.data, "ログインに失敗しました"));
      if (r.data.requiresTwoFactorAuth) return { twoFactor: r.data.requiresTwoFactorAuth };
      me = r.data;
      return { loggedIn: true, displayName: me.displayName };
    },

    async "POST /api/2fa"(_, { code, method }) {
      const endpoint = {
        totp: "/auth/twofactorauth/totp/verify",
        otp: "/auth/twofactorauth/otp/verify",
        emailOtp: "/auth/twofactorauth/emailotp/verify",
      }[method];
      if (!endpoint) throw new ApiError(400, "不明な2段階認証方式です");
      const r = await vrc("POST", endpoint, { body: { code: String(code || "").trim() } });
      if (r.status !== 200 || r.data.verified === false) {
        throw new ApiError(400, errorMessage(r.data, "コードが正しくありません"));
      }
      const u = await vrc("GET", "/auth/user");
      me = u.data;
      return { loggedIn: true, displayName: me.displayName };
    },

    async "POST /api/logout"() {
      await vrc("PUT", "/logout").catch(() => {});
      await window.Capacitor.Plugins.CapacitorCookies.clearCookies({ url: API });
      me = null;
      return { ok: true };
    },

    async "GET /api/worlds"(q) {
      const params = new URLSearchParams({
        n: String(Math.min(Number(q.get("n")) || 24, 100)),
        offset: String(Number(q.get("offset")) || 0),
        sort: q.get("sort") || "popularity",
        order: "descending",
        releaseStatus: "public",
      });
      if (q.get("search")) params.set("search", q.get("search"));
      if (q.get("quest") === "1") params.set("platform", "android");
      if (q.get("tag")) params.set("tag", q.get("tag"));
      const r = await vrc("GET", `/worlds?${params}`);
      if (r.status === 401) throw new ApiError(401, "ログインが必要です");
      if (r.status !== 200) throw new ApiError(r.status, errorMessage(r.data, "検索に失敗しました"));
      return r.data;
    },

    async "POST /api/invite-me"(_, { worldId, type = "public", region = "jp" }) {
      if (!/^wrld_[\w-]+$/.test(worldId || "")) throw new ApiError(400, "worldIdが不正です");
      if (!me) {
        const u = await vrc("GET", "/auth/user");
        if (!u.data.id) throw new ApiError(401, "ログインが必要です");
        me = u.data;
      }
      const body = { worldId, type, region };
      if (type !== "public") body.ownerId = me.id;
      if (type === "private") body.canRequestInvite = false;
      const inst = await vrc("POST", "/instances", { body });
      if (inst.status !== 200) {
        throw new ApiError(inst.status, errorMessage(inst.data, "インスタンスを作成できませんでした"));
      }
      const location = inst.data.location || `${worldId}:${inst.data.instanceId}`;
      const inv = await vrc("POST", `/invite/myself/to/${location}`);
      if (inv.status !== 200) throw new ApiError(inv.status, errorMessage(inv.data, "招待を送れませんでした"));
      return { ok: true, location };
    },
  };

  async function getWorld(id) {
    const r = await vrc("GET", `/worlds/${id}`);
    if (r.status !== 200) throw new ApiError(r.status, errorMessage(r.data, "ワールド情報を取得できません"));
    return r.data;
  }

  // app.js の api() から呼ばれる。サーバー版と同じパスを受け取る
  async function request(path, method, body) {
    const url = new URL(path, "http://app");
    const worldMatch = url.pathname.match(/^\/api\/worlds\/(wrld_[\w-]+)$/);
    if (method === "GET" && worldMatch) return getWorld(worldMatch[1]);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) throw new ApiError(404, "not found");
    return handler(url.searchParams, body || {});
  }

  return {
    available: () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
    request,
  };
})();
