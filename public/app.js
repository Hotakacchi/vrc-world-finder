const $ = (id) => document.getElementById(id);
const PAGE = 24;
const REGIONS = { jp: "日本", us: "アメリカ西", use: "アメリカ東", eu: "ヨーロッパ" };
const DEFAULT_FAV_GROUPS = ["worlds1", "worlds2", "worlds3", "worlds4"].map((name, i) => ({
  name,
  displayName: `グループ${i + 1}`,
}));

// ---------- 端末内の保存 ----------
function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// 行きたいリスト: VRChatのお気に入りとは別に、この端末に無制限で保存する
const Wish = {
  all: () => load("vwf.wishlist", {}),
  get: (id) => Wish.all()[id],
  put(id, patch) {
    const all = Wish.all();
    all[id] = { ...all[id], ...patch };
    save("vwf.wishlist", all);
  },
  remove(id) {
    const all = Wish.all();
    delete all[id];
    save("vwf.wishlist", all);
  },
};

const state = {
  questOnly: load("vwf.questOnly", true),
  tab: load("vwf.tab", "search"),
  recentIds: new Set(),
  favorites: null, // Map<worldId, {favoriteId, group}>
  favGroups: DEFAULT_FAV_GROUPS,
  current: null,
  rankMode: "rising",
  rankCache: {},
  wishFilter: "all",
};

// ---------- 小物 ----------
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function fmt(n) {
  if (n == null) return "-";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function daysSince(date) {
  const t = Date.parse(date);
  return Number.isNaN(t) ? null : (Date.now() - t) / 864e5;
}

function fmtDate(date) {
  const t = Date.parse(date);
  return Number.isNaN(t) ? "-" : new Date(t).toLocaleDateString("ja-JP");
}

const supportsQuest = (w) => (w.unityPackages || []).some((p) => p.platform === "android");
const isJapanese = (w) => /[぀-ヿ一-鿿]/.test(`${w.name} ${w.description || ""}`);
const isVisited = (id) => state.recentIds.has(id) || !!(Wish.get(id) && Wish.get(id).visited);

// VRChatのlocation文字列 (wrld_xxx:12345~hidden(usr_..)~region(jp)) を読みやすくする
function instanceInfo(location) {
  const type = /~private\(/.test(location)
    ? /~canRequestInvite/.test(location)
      ? "招待+"
      : "招待のみ"
    : /~friends\(/.test(location)
      ? "フレンドのみ"
      : /~hidden\(/.test(location)
        ? "フレンド+"
        : /~group\(/.test(location)
          ? "グループ"
          : "パブリック";
  const region = (location.match(/~region\((\w+)\)/) || [])[1] || "us";
  const name = ((location.split(":")[1] || "").split("~")[0]) || "?";
  return { type, region: REGIONS[region] || region, name };
}

let toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3000);
}

function handleError(err, statusEl) {
  if (err.status === 401) return showLogin();
  if (statusEl) statusEl.textContent = "⚠ " + err.message;
  else toast("⚠ " + err.message);
}

// ---------- ログイン ----------
let twoFactorMethod = null;

function showLogin(twoFactor) {
  $("app").hidden = true;
  $("user").hidden = true;
  $("login-view").hidden = false;
  closeModal();
  if (twoFactor) showTwoFactor(twoFactor);
}

function showTwoFactor(methods) {
  twoFactorMethod = methods.includes("emailOtp") ? "emailOtp" : methods.includes("totp") ? "totp" : "otp";
  $("twofa-label").textContent =
    twoFactorMethod === "emailOtp" ? "メールに届いた認証コードを入力してください" : "認証アプリのコードを入力してください";
  $("login-form").hidden = true;
  $("twofa-form").hidden = false;
  $("twofa-code").focus();
}

function showApp(user) {
  $("login-view").hidden = true;
  $("login-form").hidden = false;
  $("twofa-form").hidden = true;
  $("app").hidden = false;
  $("user").hidden = false;
  $("user-name").textContent = user.displayName;
  // 「行ったことがない」判定用に履歴を先に読んでおく
  Vrc.recentWorlds()
    .then((ws) => ws.forEach((w) => state.recentIds.add(w.id)))
    .catch(() => {});
  showTab(state.tab);
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    const r = await Vrc.login($("username").value, $("password").value);
    $("password").value = "";
    if (r.twoFactor) showTwoFactor(r.twoFactor);
    else showApp(r.user);
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("twofa-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    const r = await Vrc.verify2fa(twoFactorMethod, $("twofa-code").value);
    $("twofa-code").value = "";
    if (r.user) showApp(r.user);
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

$("logout").addEventListener("click", async () => {
  await Vrc.logout();
  state.favorites = null;
  state.recentIds.clear();
  state.rankCache = {};
  document.querySelectorAll(".grid, #fav-results, #friends-results, #friends-others, #gacha-result").forEach((g) => (g.innerHTML = ""));
  showLogin();
});

$("quest-only").checked = state.questOnly;
$("quest-only").addEventListener("change", () => {
  state.questOnly = $("quest-only").checked;
  save("vwf.questOnly", state.questOnly);
  if (state.tab === "search") runSearch(true);
  if (state.tab === "ranking") loadRanking();
});

// ---------- タブ ----------
const tabLoaders = {
  search: () => !$("search-results").children.length && runSearch(true),
  ranking: () => loadRanking(),
  gacha: () => {},
  favorites: () => loadFavorites(),
  recent: () => loadRecent(),
  friends: () => loadFriends(),
  wish: () => renderWish(),
};

function showTab(name) {
  if (!tabLoaders[name]) name = "search";
  state.tab = name;
  save("vwf.tab", name);
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  tabLoaders[name]();
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

// ---------- ワールドカード ----------
function card(w, { extra, rank } = {}) {
  const c = el("div", "card");
  const thumb = el("div", "thumb");
  const img = el("img");
  img.loading = "lazy";
  img.alt = "";
  img.src = w.thumbnailImageUrl || w.imageUrl || "";
  thumb.appendChild(img);
  if (rank) thumb.appendChild(el("span", "rank", `#${rank}`));
  c.appendChild(thumb);

  const info = el("div", "info");
  info.appendChild(el("h3", null, w.name));
  const meta = el("div", "meta");
  meta.appendChild(el("span", null, w.authorName));
  if (w.occupants != null) meta.appendChild(el("span", null, `👥 ${fmt(w.occupants)}`));
  if (w.favorites != null) meta.appendChild(el("span", null, `⭐ ${fmt(w.favorites)}`));
  if (supportsQuest(w)) meta.appendChild(el("span", "badge quest", "Quest"));
  if (isVisited(w.id)) meta.appendChild(el("span", "badge visited", "行った"));
  if (Wish.get(w.id)) meta.appendChild(el("span", "badge wish", "📝"));
  info.appendChild(meta);
  if (extra) info.appendChild(el("div", "extra", extra));
  c.appendChild(info);

  c.addEventListener("click", () => openWorld(w));
  return c;
}

// ---------- 検索 + 詳細フィルター ----------
let searchOffset = 0;
let searchDone = false;
let searchToken = 0;

function readFilters() {
  const num = (id) => ($(id).value === "" ? null : Number($(id).value));
  return {
    capMin: num("f-cap-min"),
    capMax: num("f-cap-max"),
    occMin: num("f-occ-min"),
    occMax: num("f-occ-max"),
    favMin: num("f-fav-min"),
    pubDays: $("f-pub").value ? Number($("f-pub").value) : null,
    jp: $("f-jp").checked,
    unvisited: $("f-unvisited").checked,
  };
}

function passesFilters(w, f) {
  if (f.capMin != null && (w.capacity ?? 0) < f.capMin) return false;
  if (f.capMax != null && (w.capacity ?? 0) > f.capMax) return false;
  if (f.occMin != null && (w.occupants ?? 0) < f.occMin) return false;
  if (f.occMax != null && (w.occupants ?? 0) > f.occMax) return false;
  if (f.favMin != null && (w.favorites ?? 0) < f.favMin) return false;
  if (f.pubDays != null) {
    const d = daysSince(w.publicationDate);
    if (d == null || d > f.pubDays) return false;
  }
  if (f.jp && !isJapanese(w)) return false;
  if (f.unvisited && isVisited(w.id)) return false;
  return true;
}

function activeFilterCount(f) {
  return Object.values(f).filter((v) => v !== null && v !== false).length;
}

async function runSearch(reset) {
  const token = ++searchToken;
  if (reset) {
    searchOffset = 0;
    searchDone = false;
    $("search-results").innerHTML = "";
  }
  const f = readFilters();
  const count = activeFilterCount(f);
  $("filter-count").textContent = count ? `(${count}件)` : "";
  $("search-status").textContent = "読み込み中…";
  $("search-more").hidden = true;

  // フィルターで減る分は自動で次のページも取りに行く (最大5ページ)
  let added = 0;
  try {
    for (let page = 0; page < 5 && added < PAGE && !searchDone; page++) {
      const worlds = await Vrc.searchWorlds({
        search: $("query").value.trim(),
        sort: $("sort").value,
        quest: state.questOnly,
        n: 50,
        offset: searchOffset,
      });
      if (token !== searchToken) return;
      searchOffset += worlds.length;
      if (worlds.length < 50) searchDone = true;
      for (const w of worlds) {
        if (!passesFilters(w, f)) continue;
        $("search-results").appendChild(card(w));
        added++;
      }
    }
    const empty = !$("search-results").children.length;
    $("search-status").textContent = !empty
      ? ""
      : searchDone
        ? "ワールドが見つかりませんでした"
        : "条件に合うワールドがまだ見つかりません。「もっと見る」で続きを探します";
    $("search-more").hidden = searchDone;
  } catch (err) {
    handleError(err, $("search-status"));
  }
}

$("search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runSearch(true);
});
$("sort").addEventListener("change", () => runSearch(true));
$("search-more").addEventListener("click", () => runSearch(false));
$("f-apply").addEventListener("click", () => runSearch(true));
$("f-clear").addEventListener("click", () => {
  ["f-cap-min", "f-cap-max", "f-occ-min", "f-occ-max", "f-fav-min", "f-pub"].forEach((id) => ($(id).value = ""));
  $("f-jp").checked = false;
  $("f-unvisited").checked = false;
  runSearch(true);
});
document.querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => {
    $("query").value = c.dataset.q;
    runSearch(true);
  })
);

// ---------- ランキング (独自集計) ----------
const RANK_DESC = {
  rising: "公開から90日以内のワールドを「1日あたりのお気に入り増加数」で並べています。今まさに伸びている新作です。",
  gems: "お気に入りが200以上あるのに、今は話題性が低く人も少ないワールドです。じっくり楽しめる隠れた名作を探せます。",
};

async function buildRankingPool() {
  // 複数の並び順から集めてプールを作る。VRChatの一覧APIには訪問数が含まれないため、お気に入り数・公開日・話題度で評価する
  const plans = [
    ["heat", 0], ["heat", 100], ["popularity", 0], ["publicationDate", 0], ["publicationDate", 100],
    ["favorites", 100], ["favorites", 200], ["shuffle", 0], ["shuffle", 0],
  ];
  const pool = new Map();
  for (let i = 0; i < plans.length; i++) {
    $("rank-status").textContent = `集計中… (${i + 1}/${plans.length})`;
    const [sort, offset] = plans[i];
    const worlds = await Vrc.searchWorlds({ sort, offset, n: 100, quest: state.questOnly });
    worlds.forEach((w) => pool.set(w.id, w));
  }
  const all = [...pool.values()];

  const rising = all
    .map((w) => ({ w, days: daysSince(w.publicationDate) }))
    .filter(({ w, days }) => days != null && days >= 0 && days <= 90 && w.favorites >= 20)
    .map((x) => ({ ...x, score: x.w.favorites / Math.max(x.days, 3) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map(({ w, days, score }) => ({ w, extra: `📈 1日あたり⭐${score.toFixed(1)} ・ 公開${Math.floor(days)}日前` }));

  const gems = all
    .filter((w) => w.favorites >= 200 && (w.occupants ?? 0) <= 10 && (w.heat ?? 0) <= 2)
    .sort((a, b) => b.favorites - a.favorites)
    .slice(0, 30)
    .map((w) => ({ w, extra: `💎 ⭐${fmt(w.favorites)} なのに今${w.occupants ?? 0}人` }));

  return { at: Date.now(), rising, gems };
}

let rankLoading = false;
async function loadRanking(force) {
  const key = state.questOnly ? "quest" : "all";
  const cached = state.rankCache[key];
  $("rank-desc").textContent = RANK_DESC[state.rankMode];
  if (cached && !force && Date.now() - cached.at < 30 * 60e3) return renderRanking(cached);
  if (rankLoading) return;
  rankLoading = true;
  $("rank-results").innerHTML = "";
  try {
    state.rankCache[key] = await buildRankingPool();
    renderRanking(state.rankCache[key]);
  } catch (err) {
    handleError(err, $("rank-status"));
  } finally {
    rankLoading = false;
  }
}

function renderRanking(data) {
  const items = data[state.rankMode];
  $("rank-results").innerHTML = "";
  items.forEach(({ w, extra }, i) => $("rank-results").appendChild(card(w, { extra, rank: i + 1 })));
  $("rank-status").textContent = items.length
    ? `${new Date(data.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 時点の集計`
    : "該当するワールドがありませんでした。「再集計」で別のワールドを集めます";
}

document.querySelectorAll("[data-rank]").forEach((b) =>
  b.addEventListener("click", () => {
    state.rankMode = b.dataset.rank;
    document.querySelectorAll("[data-rank]").forEach((x) => x.classList.toggle("active", x === b));
    loadRanking();
  })
);
$("rank-refresh").addEventListener("click", () => loadRanking(true));

// ---------- ワールドガチャ ----------
async function pullGacha() {
  const btn = $("g-pull");
  btn.disabled = true;
  $("gacha-status").textContent = "ガチャを回しています…";
  const keyword = $("g-keyword").value.trim();
  const minFav = Number($("g-minfav").value);
  const f = { unvisited: $("g-unvisited").checked, jp: $("g-jp").checked };
  try {
    for (let tries = 0; tries < 4; tries++) {
      const worlds = await Vrc.searchWorlds({
        sort: "shuffle",
        search: keyword,
        n: 100,
        offset: keyword ? Math.floor(Math.random() * 3) * 100 : 0,
        quest: state.questOnly,
      });
      const hits = worlds.filter(
        (w) => (w.favorites ?? 0) >= minFav && (!f.unvisited || !isVisited(w.id)) && (!f.jp || isJapanese(w))
      );
      if (hits.length) {
        showGachaResult(hits[Math.floor(Math.random() * hits.length)]);
        $("gacha-status").textContent = "";
        return;
      }
    }
    $("gacha-status").textContent = "条件に合うワールドが出ませんでした。条件をゆるめてもう一度どうぞ";
  } catch (err) {
    handleError(err, $("gacha-status"));
  } finally {
    btn.disabled = false;
  }
}

function showGachaResult(w) {
  const box = $("gacha-result");
  box.innerHTML = "";
  const r = el("div", "gacha-card");
  const img = el("img");
  img.src = w.imageUrl || w.thumbnailImageUrl || "";
  img.alt = "";
  r.appendChild(img);
  r.appendChild(el("h2", null, w.name));
  r.appendChild(el("p", "note", `作者: ${w.authorName}`));
  const stats = el("div", "stats");
  [`👥 今 ${fmt(w.occupants)}人`, `🚪 定員 ${w.capacity ?? "-"}`, `⭐ ${fmt(w.favorites)}`, `📅 ${fmtDate(w.publicationDate)}`].forEach(
    (t) => stats.appendChild(el("span", null, t))
  );
  r.appendChild(stats);
  const row = el("div", "row");
  const detail = el("button", null, "詳しく見る");
  detail.addEventListener("click", () => openWorld(w));
  const wish = el("button", "secondary", Wish.get(w.id) ? "📝 リストに追加済み" : "📝 行きたいリストへ");
  wish.addEventListener("click", () => {
    addToWish(w);
    wish.textContent = "📝 リストに追加済み";
  });
  const again = el("button", "ghost", "🎲 もう一回");
  again.addEventListener("click", pullGacha);
  row.append(detail, wish, again);
  r.appendChild(row);
  box.appendChild(r);
}

$("g-pull").addEventListener("click", pullGacha);

// ---------- お気に入り (VRChat) ----------
async function ensureFavorites(force) {
  if (state.favorites && !force) return;
  const [worlds, groups] = await Promise.all([Vrc.favoriteWorlds(), Vrc.favoriteGroups().catch(() => [])]);
  state.favorites = new Map(worlds.map((w) => [w.id, { favoriteId: w.favoriteId, group: w.favoriteGroup, world: w }]));
  if (groups.length) state.favGroups = groups.map((g) => ({ name: g.name, displayName: g.displayName || g.name }));
}

async function loadFavorites() {
  $("fav-status").textContent = "読み込み中…";
  $("fav-results").innerHTML = "";
  try {
    await ensureFavorites(true);
    const byGroup = new Map();
    for (const f of state.favorites.values()) {
      if (!byGroup.has(f.group)) byGroup.set(f.group, []);
      byGroup.get(f.group).push(f.world);
    }
    const order = [...state.favGroups.map((g) => g.name), ...[...byGroup.keys()].filter((k) => !state.favGroups.some((g) => g.name === k))];
    for (const name of order) {
      const worlds = byGroup.get(name);
      if (!worlds || !worlds.length) continue;
      const group = state.favGroups.find((g) => g.name === name);
      $("fav-results").appendChild(el("h3", "group-title", `${group ? group.displayName : name} (${worlds.length})`));
      const grid = el("div", "grid");
      worlds.forEach((w) => grid.appendChild(card(w)));
      $("fav-results").appendChild(grid);
    }
    $("fav-status").textContent = state.favorites.size ? "" : "お気に入りのワールドはまだありません";
  } catch (err) {
    handleError(err, $("fav-status"));
  }
}

$("fav-refresh").addEventListener("click", loadFavorites);

// ---------- 最近行ったワールド ----------
async function loadRecent() {
  $("recent-status").textContent = "読み込み中…";
  $("recent-results").innerHTML = "";
  try {
    const worlds = await Vrc.recentWorlds();
    worlds.forEach((w) => {
      state.recentIds.add(w.id);
      $("recent-results").appendChild(card(w));
    });
    $("recent-status").textContent = worlds.length ? "" : "最近行ったワールドはありません";
  } catch (err) {
    handleError(err, $("recent-status"));
  }
}

$("recent-refresh").addEventListener("click", loadRecent);

// ---------- フレンドの居場所 ----------
async function loadFriends() {
  $("friends-status").textContent = "読み込み中…";
  $("friends-results").innerHTML = "";
  $("friends-others").innerHTML = "";
  try {
    const friends = await Vrc.onlineFriends();
    const byLocation = new Map();
    const others = [];
    for (const f of friends) {
      if (f.location && f.location.startsWith("wrld_")) {
        if (!byLocation.has(f.location)) byLocation.set(f.location, []);
        byLocation.get(f.location).push(f);
      } else {
        others.push(f);
      }
    }
    $("friends-status").textContent = friends.length
      ? `オンライン ${friends.length}人 ・ 入れそうな場所 ${byLocation.size}か所`
      : "オンラインのフレンドはいません";

    const locations = [...byLocation.entries()].sort((a, b) => b[1].length - a[1].length);
    // 先に枠を並べて、ワールド情報は順番に埋める (APIに負荷をかけないため)
    const rows = locations.map(([location, members]) => {
      const row = friendRow(location, members);
      $("friends-results").appendChild(row.root);
      return row;
    });
    for (const row of rows) {
      try {
        row.fill(await Vrc.getWorld(row.worldId));
      } catch {
        row.fill(null);
      }
    }

    if (others.length) {
      $("friends-others").appendChild(el("h3", "group-title", `プライベート・移動中など (${others.length})`));
      const list = el("div", "friend-chips");
      others.forEach((f) => list.appendChild(el("span", "friend-chip", f.displayName)));
      $("friends-others").appendChild(list);
    }
  } catch (err) {
    handleError(err, $("friends-status"));
  }
}

function friendRow(location, members) {
  const worldId = location.split(":")[0];
  const info = instanceInfo(location);
  const root = el("div", "friend-row");
  const img = el("img");
  img.alt = "";
  const body = el("div", "friend-body");
  const title = el("h3", null, "読み込み中…");
  const meta = el("div", "note", `${info.type} ・ ${info.region} ・ #${info.name}`);
  const chips = el("div", "friend-chips");
  members.forEach((f) => chips.appendChild(el("span", "friend-chip", f.displayName)));
  body.append(title, meta, chips);
  const actions = el("div", "friend-actions");
  const join = el("button", null, "合流する");
  join.addEventListener("click", async () => {
    join.disabled = true;
    try {
      await Vrc.inviteMe(location);
      toast("✅ 招待を送りました！VRChatの通知から合流できます");
    } catch (err) {
      handleError(err);
    } finally {
      join.disabled = false;
    }
  });
  actions.appendChild(join);
  root.append(img, body, actions);

  return {
    root,
    worldId,
    fill(world) {
      if (!world) {
        title.textContent = worldId;
        return;
      }
      title.textContent = world.name;
      img.src = world.thumbnailImageUrl || world.imageUrl || "";
      img.addEventListener("click", () => openWorld(world));
      title.addEventListener("click", () => openWorld(world));
      root.classList.add("clickable");
    },
  };
}

$("friends-refresh").addEventListener("click", loadFriends);

// ---------- 行きたいリスト ----------
function snapshot(w) {
  // 一覧表示に必要な分だけ保存する
  const { id, name, authorName, thumbnailImageUrl, imageUrl, capacity, favorites, occupants, unityPackages, publicationDate } = w;
  return {
    id, name, authorName, thumbnailImageUrl, imageUrl, capacity, favorites, occupants, publicationDate,
    unityPackages: (unityPackages || []).map((p) => ({ platform: p.platform })),
  };
}

function addToWish(w) {
  if (Wish.get(w.id)) return;
  Wish.put(w.id, { world: snapshot(w), memo: "", rating: 0, visited: false, addedAt: Date.now() });
  toast("📝 行きたいリストに追加しました");
}

function renderWish() {
  const entries = Object.values(Wish.all()).filter((e) =>
    state.wishFilter === "todo" ? !e.visited : state.wishFilter === "done" ? e.visited : true
  );
  const sort = $("wish-sort").value;
  entries.sort((a, b) =>
    sort === "rating" ? b.rating - a.rating || b.addedAt - a.addedAt : sort === "name" ? a.world.name.localeCompare(b.world.name, "ja") : b.addedAt - a.addedAt
  );
  $("wish-results").innerHTML = "";
  entries.forEach((e) => {
    const stars = e.rating ? "★".repeat(e.rating) + "☆".repeat(5 - e.rating) : "";
    const extra = [stars, e.memo].filter(Boolean).join("  ");
    $("wish-results").appendChild(card(e.world, { extra: extra || undefined }));
  });
  $("wish-status").textContent = entries.length
    ? `${entries.length}件`
    : "まだありません。ワールドの詳細画面から「行きたいリストへ」で追加できます";
}

document.querySelectorAll("[data-wish]").forEach((b) =>
  b.addEventListener("click", () => {
    state.wishFilter = b.dataset.wish;
    document.querySelectorAll("[data-wish]").forEach((x) => x.classList.toggle("active", x === b));
    renderWish();
  })
);
$("wish-sort").addEventListener("change", renderWish);

// ---------- 詳細 ----------
async function openWorld(w) {
  state.current = w;
  $("d-img").src = w.imageUrl || w.thumbnailImageUrl || "";
  $("d-name").textContent = w.name;
  $("d-author").textContent = `作者: ${w.authorName}`;
  $("d-desc").textContent = "";
  $("d-tags").innerHTML = "";
  $("d-msg").textContent = "";
  $("d-youtube").hidden = true;
  $("d-instances").innerHTML = '<p class="note">読み込み中…</p>';
  renderStats(w);
  renderWishControls();
  renderFavControls();
  $("modal").hidden = false;
  $("modal").querySelector(".modal-body").scrollTop = 0;

  ensureFavorites()
    .then(() => state.current === w && renderFavControls())
    .catch(() => {});

  try {
    const full = await Vrc.getWorld(w.id, { fresh: true });
    if (state.current !== w) return;
    renderStats(full);
    $("d-desc").textContent = full.description || "";
    (full.tags || [])
      .filter((t) => t.startsWith("author_tag_"))
      .forEach((t) => $("d-tags").appendChild(el("span", null, t.replace("author_tag_", "#"))));
    if (full.previewYoutubeId) {
      $("d-youtube").href = `https://www.youtube.com/watch?v=${encodeURIComponent(full.previewYoutubeId)}`;
      $("d-youtube").hidden = false;
    }
    renderInstances(full);
  } catch (err) {
    $("d-instances").innerHTML = "";
    handleError(err, $("d-msg"));
  }
}

function renderStats(w) {
  $("d-stats").innerHTML = "";
  [
    `👥 今 ${fmt(w.occupants)}人`,
    `🚪 定員 ${w.capacity ?? "-"}`,
    `⭐ ${fmt(w.favorites)}`,
    w.visits != null ? `👣 訪問 ${fmt(w.visits)}` : null,
    `📅 公開 ${fmtDate(w.publicationDate)}`,
    w.updated_at ? `🔄 更新 ${fmtDate(w.updated_at)}` : null,
    supportsQuest(w) ? "✅ Quest対応" : "❌ PC専用",
    isVisited(w.id) ? "👣 行ったことある" : null,
  ]
    .filter(Boolean)
    .forEach((t) => $("d-stats").appendChild(el("span", null, t)));
}

function renderInstances(world) {
  const box = $("d-instances");
  box.innerHTML = "";
  const instances = (world.instances || []).slice().sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (!instances.length) {
    box.appendChild(el("p", "note", "今開いているパブリックインスタンスはありません"));
    return;
  }
  for (const [instanceId, count] of instances) {
    const location = `${world.id}:${instanceId}`;
    const info = instanceInfo(location);
    const row = el("div", "instance-row");
    row.appendChild(el("span", "count", `👥 ${count}`));
    row.appendChild(el("span", null, `#${info.name}`));
    row.appendChild(el("span", "note", `${info.type} ・ ${info.region}`));
    const join = el("button", null, "入る");
    join.addEventListener("click", async () => {
      join.disabled = true;
      try {
        await Vrc.inviteMe(location);
        $("d-msg").textContent = "✅ 招待を送りました！VRChatの通知から参加できます";
      } catch (err) {
        handleError(err, $("d-msg"));
      } finally {
        join.disabled = false;
      }
    });
    row.appendChild(join);
    box.appendChild(row);
  }
}

// 行きたいリストの操作
function renderWishControls() {
  const w = state.current;
  const entry = Wish.get(w.id);
  $("d-wish").textContent = entry ? "📝 リストから外す" : "📝 行きたいリストへ";
  $("d-wish-panel").hidden = !entry;
  if (!entry) return;
  $("d-visited").checked = !!entry.visited;
  $("d-memo").value = entry.memo || "";
  const stars = $("d-stars");
  stars.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const s = el("button", "star" + (i <= entry.rating ? " on" : ""), i <= entry.rating ? "★" : "☆");
    s.addEventListener("click", () => {
      Wish.put(w.id, { rating: entry.rating === i ? 0 : i });
      renderWishControls();
      refreshWishView();
    });
    stars.appendChild(s);
  }
}

function refreshWishView() {
  if (state.tab === "wish") renderWish();
}

$("d-wish").addEventListener("click", () => {
  const w = state.current;
  if (Wish.get(w.id)) {
    Wish.remove(w.id);
    toast("リストから外しました");
  } else {
    addToWish(w);
  }
  renderWishControls();
  refreshWishView();
});

$("d-visited").addEventListener("change", () => {
  Wish.put(state.current.id, { visited: $("d-visited").checked });
  renderStats(state.current);
  refreshWishView();
});

let memoTimer;
$("d-memo").addEventListener("input", () => {
  clearTimeout(memoTimer);
  const id = state.current.id;
  const memo = $("d-memo").value;
  memoTimer = setTimeout(() => {
    Wish.put(id, { memo });
    refreshWishView();
  }, 400);
});

// VRChatのお気に入り操作
function renderFavControls() {
  const fav = state.favorites && state.favorites.get(state.current.id);
  const select = $("d-fav-group");
  select.innerHTML = "";
  state.favGroups.forEach((g) => {
    const o = el("option", null, g.displayName);
    o.value = g.name;
    select.appendChild(o);
  });
  select.hidden = !!fav || !state.favorites;
  $("d-fav").disabled = !state.favorites;
  $("d-fav").textContent = !state.favorites ? "⭐ 確認中…" : fav ? "⭐ お気に入り解除" : "⭐ VRChatのお気に入りへ";
}

$("d-fav").addEventListener("click", async () => {
  const w = state.current;
  const fav = state.favorites.get(w.id);
  $("d-fav").disabled = true;
  try {
    if (fav) {
      await Vrc.removeFavorite(fav.favoriteId);
      state.favorites.delete(w.id);
      toast("お気に入りから外しました");
    } else {
      const group = $("d-fav-group").value;
      const res = await Vrc.addFavorite(w.id, group);
      state.favorites.set(w.id, { favoriteId: res.id, group, world: w });
      toast("⭐ VRChatのお気に入りに追加しました");
    }
  } catch (err) {
    handleError(err, $("d-msg"));
  } finally {
    renderFavControls();
  }
});

$("d-invite").addEventListener("click", async () => {
  const btn = $("d-invite");
  btn.disabled = true;
  $("d-msg").textContent = "招待を送信中…";
  try {
    await Vrc.createInstanceAndInvite(state.current.id, $("d-type").value, $("d-region").value);
    $("d-msg").textContent = "✅ 招待を送りました！VRChatの通知から参加できます";
  } catch (err) {
    handleError(err, $("d-msg"));
  } finally {
    btn.disabled = false;
  }
});

function closeModal() {
  $("modal").hidden = true;
  state.current = null;
}
$("modal-close").addEventListener("click", closeModal);
$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) closeModal();
});

// ---------- 起動 ----------
(async () => {
  try {
    const r = await Vrc.currentUser();
    if (r.user) showApp(r.user);
    else showLogin(r.twoFactor);
  } catch {
    showLogin();
  }
})();
