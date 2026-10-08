// VRC World Finder ブラウザ版の中継サーバー
// QuestのブラウザからはVRChat APIを直接呼べない (CORS) ので、/vrc/* をVRChat APIへ転送する。
// 認証クッキーはこのサーバーが保持する。VRChatとのやり取りの中身は public/vrc.js にある。
// 依存パッケージなし (Node.js 18+ の組み込み fetch を使用)
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 3939;
const API = "https://api.vrchat.cloud/api/1";
const USER_AGENT = `VRCWorldFinder/${require("./package.json").version} (personal Quest world search tool)`;
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

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function proxy(req, res, url) {
  const apiPath = url.pathname.slice("/vrc".length) + url.search;
  const headers = { "User-Agent": USER_AGENT };
  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
  if (req.headers.authorization) {
    // 新しくログインするときは古いセッションを捨てる
    cookies = {};
    headers.Authorization = req.headers.authorization;
  } else {
    headers.Cookie = cookieHeader();
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readRaw(req);
  const r = await fetch(API + apiPath, {
    method: req.method,
    headers,
    body: body && body.length ? body : undefined,
  });
  storeSetCookies(r);
  if (apiPath.startsWith("/logout")) {
    cookies = {};
    saveCookies();
  }
  res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/json" });
  res.end(Buffer.from(await r.arrayBuffer()));
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
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/vrc/")) await proxy(req, res, url);
    else serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { message: "VRChatに接続できません: " + e.message } }));
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
