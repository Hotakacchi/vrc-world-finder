const $ = (id) => document.getElementById(id);
const PAGE = 24;

let twoFactorMethod = null;
let offset = 0;
let currentWorld = null;

async function api(path, options = {}) {
  // APK版はアプリ内から直接VRChatへ、ブラウザ版はPCサーバー経由
  if (VrcNative.available()) {
    try {
      return await VrcNative.request(path, options.method || "GET", options.body);
    } catch (err) {
      if (err.status === 401) showLogin();
      throw err;
    }
  }
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) showLogin();
    throw new Error(data.error || `エラー (${res.status})`);
  }
  return data;
}

// ---------- ログイン ----------
function showLogin(twoFactor) {
  $("search-view").hidden = true;
  $("user").hidden = true;
  $("login-view").hidden = false;
  if (twoFactor) showTwoFactor(twoFactor);
}

function showTwoFactor(methods) {
  twoFactorMethod = methods.includes("emailOtp") ? "emailOtp" : methods.includes("totp") ? "totp" : "otp";
  $("twofa-label").textContent =
    twoFactorMethod === "emailOtp"
      ? "メールに届いた認証コードを入力してください"
      : "認証アプリのコードを入力してください";
  $("login-form").hidden = true;
  $("twofa-form").hidden = false;
  $("twofa-code").focus();
}

function showApp(displayName) {
  $("login-view").hidden = true;
  $("search-view").hidden = false;
  $("user").hidden = false;
  $("user-name").textContent = displayName;
  if (!$("results").children.length) search(true);
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    const r = await api("/api/login", {
      method: "POST",
      body: { username: $("username").value, password: $("password").value },
    });
    $("password").value = "";
    if (r.twoFactor) showTwoFactor(r.twoFactor);
    else showApp(r.displayName);
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("twofa-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    const r = await api("/api/2fa", {
      method: "POST",
      body: { code: $("twofa-code").value, method: twoFactorMethod },
    });
    $("twofa-code").value = "";
    $("twofa-form").hidden = true;
    $("login-form").hidden = false;
    showApp(r.displayName);
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("logout").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  $("results").innerHTML = "";
  showLogin();
});

// ---------- 検索 ----------
function fmt(n) {
  if (n == null) return "-";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function supportsQuest(w) {
  return (w.unityPackages || []).some((p) => p.platform === "android");
}

function card(w) {
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <img loading="lazy" alt="">
    <div class="info">
      <h3></h3>
      <div class="meta">
        <span class="author"></span>
        <span>👥 ${fmt(w.occupants)}</span>
        <span>⭐ ${fmt(w.favorites)}</span>
        ${supportsQuest(w) ? '<span class="badge">Quest</span>' : ""}
      </div>
    </div>`;
  el.querySelector("img").src = w.thumbnailImageUrl || w.imageUrl || "";
  el.querySelector("h3").textContent = w.name;
  el.querySelector(".author").textContent = w.authorName;
  el.addEventListener("click", () => openWorld(w));
  return el;
}

async function search(reset) {
  if (reset) {
    offset = 0;
    $("results").innerHTML = "";
  }
  $("status").textContent = "読み込み中…";
  $("more").hidden = true;
  const params = new URLSearchParams({
    search: $("query").value.trim(),
    sort: $("sort").value,
    quest: $("quest-only").checked ? "1" : "0",
    n: PAGE,
    offset,
  });
  try {
    const worlds = await api(`/api/worlds?${params}`);
    worlds.forEach((w) => $("results").appendChild(card(w)));
    offset += worlds.length;
    $("status").textContent = $("results").children.length ? "" : "ワールドが見つかりませんでした";
    $("more").hidden = worlds.length < PAGE;
  } catch (err) {
    $("status").textContent = err.message;
  }
}

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  search(true);
});
$("sort").addEventListener("change", () => search(true));
$("quest-only").addEventListener("change", () => search(true));
$("more").addEventListener("click", () => search(false));
document.querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => {
    $("query").value = c.dataset.q;
    search(true);
  })
);

// ---------- 詳細 ----------
async function openWorld(w) {
  currentWorld = w;
  $("d-img").src = w.imageUrl || w.thumbnailImageUrl || "";
  $("d-name").textContent = w.name;
  $("d-author").textContent = `作者: ${w.authorName}`;
  $("d-desc").textContent = "";
  $("d-tags").innerHTML = "";
  $("d-msg").textContent = "";
  renderStats(w);
  $("modal").hidden = false;

  try {
    const full = await api(`/api/worlds/${w.id}`);
    if (currentWorld !== w) return;
    renderStats(full);
    $("d-desc").textContent = full.description || "";
    (full.tags || [])
      .filter((t) => t.startsWith("author_tag_"))
      .forEach((t) => {
        const s = document.createElement("span");
        s.textContent = t.replace("author_tag_", "#");
        $("d-tags").appendChild(s);
      });
  } catch (err) {
    $("d-msg").textContent = err.message;
  }
}

function renderStats(w) {
  $("d-stats").innerHTML = "";
  const items = [
    `👥 現在 ${fmt(w.occupants)}人`,
    `🚪 定員 ${w.capacity ?? "-"}`,
    `⭐ ${fmt(w.favorites)}`,
    `👣 訪問 ${fmt(w.visits)}`,
    supportsQuest(w) ? "✅ Quest対応" : "❌ PC専用",
  ];
  for (const t of items) {
    const s = document.createElement("span");
    s.textContent = t;
    $("d-stats").appendChild(s);
  }
}

$("d-invite").addEventListener("click", async () => {
  const btn = $("d-invite");
  btn.disabled = true;
  $("d-msg").textContent = "招待を送信中…";
  try {
    await api("/api/invite-me", {
      method: "POST",
      body: { worldId: currentWorld.id, type: $("d-type").value, region: $("d-region").value },
    });
    $("d-msg").textContent = "✅ 招待を送りました！VRChatの通知から参加できます";
  } catch (err) {
    $("d-msg").textContent = "⚠ " + err.message;
  } finally {
    btn.disabled = false;
  }
});

function closeModal() {
  $("modal").hidden = true;
  currentWorld = null;
}
$("modal-close").addEventListener("click", closeModal);
$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) closeModal();
});

// ---------- 起動 ----------
(async () => {
  try {
    const r = await api("/api/me");
    if (r.loggedIn) showApp(r.displayName);
    else showLogin(r.twoFactor);
  } catch {
    showLogin();
  }
})();
