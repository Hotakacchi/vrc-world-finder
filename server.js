// VRC World Finder - PC上で動かし、Meta Questのブラウザからアクセスする中継サーバー
// 依存パッケージなし (Node.js 18+ の組み込み fetch を使用)
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 3939;
const API = "https://api.vrchat.cloud/api/1";
const USER_AGENT = "VRCWorldFinder/0.1.0 (personal Quest world search tool)";
const SESSION_FILE = path.join(__dirname, ".session.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// ---- セッション (VRChatのauthクッキー) をファイルに保存して再起動後も使えるようにする ----
let cookies = {};
try {
  cookies = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
} catch {}

function saveCookies() {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies));
}

function cookieHeader() {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function storeSetCookies(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (name === "auth" || name === "twoFactorAuth") {
      if (value) cookies[name] = value;
      else delete cookies[name];
    }
  }
  saveCookies();
}

async function vrc(method, apiPath, { body, headers = {} } = {}) {
  const res = await fetch(API + apiPath, {
    method,
    headers: {
      "User-Agent": USER_AGENT,
      Cookie: cookieHeader(),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  storeSetCookies(res);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

// ---- HTTPユーティリティ ----
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function errorMessage(data, fallback) {
  return (data && data.error && data.error.message) || fallback;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

// ---- APIルート ----
let me = null; // ログイン中のユーザー情報

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/me") {
    if (!cookies.auth) return sendJson(res, 200, { loggedIn: false });
    const r = await vrc("GET", "/auth/user");
    if (r.status === 200 && r.data.id) {
      me = r.data;
      return sendJson(res, 200, { loggedIn: true, displayName: me.displayName });
    }
    if (r.status === 200 && r.data.requiresTwoFactorAuth) {
      return sendJson(res, 200, { loggedIn: false, twoFactor: r.data.requiresTwoFactorAuth });
    }
    return sendJson(res, 200, { loggedIn: false });
  }

  if (route === "POST /api/login") {
    const { username, password } = await readBody(req);
    if (!username || !password) return sendJson(res, 400, { error: "ユーザー名とパスワードを入力してください" });
    cookies = {};
    const basic = Buffer.from(
      `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
    ).toString("base64");
    const r = await vrc("GET", "/auth/user", { headers: { Authorization: `Basic ${basic}` } });
    if (r.status !== 200) return sendJson(res, 401, { error: errorMessage(r.data, "ログインに失敗しました") });
    if (r.data.requiresTwoFactorAuth) return sendJson(res, 200, { twoFactor: r.data.requiresTwoFactorAuth });
    me = r.data;
    return sendJson(res, 200, { loggedIn: true, displayName: me.displayName });
  }

  if (route === "POST /api/2fa") {
    const { code, method } = await readBody(req);
    const endpoint = {
      totp: "/auth/twofactorauth/totp/verify",
      otp: "/auth/twofactorauth/otp/verify",
      emailOtp: "/auth/twofactorauth/emailotp/verify",
    }[method];
    if (!endpoint) return sendJson(res, 400, { error: "不明な2段階認証方式です" });
    const r = await vrc("POST", endpoint, { body: { code: String(code || "").trim() } });
    if (r.status !== 200 || r.data.verified === false) {
      return sendJson(res, 401, { error: errorMessage(r.data, "コードが正しくありません") });
    }
    const u = await vrc("GET", "/auth/user");
    me = u.data;
    return sendJson(res, 200, { loggedIn: true, displayName: me.displayName });
  }

  if (route === "POST /api/logout") {
    await vrc("PUT", "/logout").catch(() => {});
    cookies = {};
    me = null;
    saveCookies();
    return sendJson(res, 200, { ok: true });
  }

  if (route === "GET /api/worlds") {
    const q = url.searchParams;
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
    if (r.status === 401) return sendJson(res, 401, { error: "ログインが必要です" });
    if (r.status !== 200) return sendJson(res, r.status, { error: errorMessage(r.data, "検索に失敗しました") });
    return sendJson(res, 200, r.data);
  }

  const worldMatch = url.pathname.match(/^\/api\/worlds\/(wrld_[\w-]+)$/);
  if (req.method === "GET" && worldMatch) {
    const r = await vrc("GET", `/worlds/${worldMatch[1]}`);
    if (r.status !== 200) return sendJson(res, r.status, { error: errorMessage(r.data, "ワールド情報を取得できません") });
    return sendJson(res, 200, r.data);
  }

  // インスタンスを作って自分に招待を送る → Quest内のVRChatに招待通知が届く
  if (route === "POST /api/invite-me") {
    const { worldId, type = "public", region = "jp" } = await readBody(req);
    if (!/^wrld_[\w-]+$/.test(worldId || "")) return sendJson(res, 400, { error: "worldIdが不正です" });
    if (!me) {
      const u = await vrc("GET", "/auth/user");
      if (!u.data.id) return sendJson(res, 401, { error: "ログインが必要です" });
      me = u.data;
    }
    const body = { worldId, type, region };
    if (type !== "public") body.ownerId = me.id;
    if (type === "private") body.canRequestInvite = false;
    const inst = await vrc("POST", "/instances", { body });
    if (inst.status !== 200) {
      return sendJson(res, inst.status, { error: errorMessage(inst.data, "インスタンスを作成できませんでした") });
    }
    const location = inst.data.location || `${worldId}:${inst.data.instanceId}`;
    const inv = await vrc("POST", `/invite/myself/to/${location}`);
    if (inv.status !== 200) {
      return sendJson(res, inv.status, { error: errorMessage(inv.data, "招待を送れませんでした") });
    }
    return sendJson(res, 200, { ok: true, location });
  }

  sendJson(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: "サーバーエラー: " + e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  console.log("VRC World Finder 起動しました");
  console.log(`  PC:    http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Quest: http://${ip}:${PORT}`);
});
