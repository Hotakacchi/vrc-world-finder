// アプリの自動アップデート (APK版のみ)
// 1. 画面とロジック (public/) の更新 → web.zip をダウンロードして差し替え (再インストール不要)
// 2. Android側 (APK) の更新が必要なとき → 新しいAPKをダウンロードしてインストール画面を開く
// 更新情報は GitHub の最新リリースにある update.json から読む (scripts/release.js が作る)
const Updater = (() => {
  const MANIFEST_URL = "https://github.com/Hotakacchi/vrc-world-finder/releases/latest/download/update.json";
  const RELEASES_PAGE = "https://github.com/Hotakacchi/vrc-world-finder/releases/latest";
  const plugin = (name) => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  let checking = false;

  function compare(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  // ---- 上部のお知らせバー ----
  function banner(text, actions = []) {
    const box = document.getElementById("update-banner");
    document.getElementById("update-text").textContent = text;
    const row = document.getElementById("update-actions");
    row.innerHTML = "";
    for (const [label, fn, cls] of actions) {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener("click", fn);
      row.appendChild(b);
    }
    box.hidden = false;
  }

  function hideBanner() {
    document.getElementById("update-banner").hidden = true;
  }

  async function fetchManifest() {
    const res = await plugin("CapacitorHttp").request({
      url: MANIFEST_URL,
      method: "GET",
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (res.status !== 200) throw new Error(`更新情報を取得できません (${res.status})`);
    return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  }

  // ---- 1. 画面・ロジックの更新 ----
  async function applyWebUpdate(m) {
    const CU = plugin("CapacitorUpdater");
    banner(`新しいバージョン v${m.version} をダウンロード中…`);
    const bundle = await CU.download({ url: m.web, version: m.version, checksum: m.webSha256 });
    await CU.next({ id: bundle.id });
    banner(`v${m.version} の準備ができました${m.notes ? `：${m.notes}` : ""}`, [
      ["今すぐ再起動", () => CU.set({ id: bundle.id })],
      ["次回の起動時に", hideBanner, "ghost"],
    ]);
  }

  // ---- 2. APKの更新 ----
  function offerApkUpdate(m) {
    banner(`アプリ本体の更新があります (v${m.native})${m.notes ? `：${m.notes}` : ""}`, [
      ["ダウンロードしてインストール", () => installApk(m)],
      ["あとで", hideBanner, "ghost"],
    ]);
  }

  async function installApk(m) {
    const Apk = plugin("ApkUpdater");
    try {
      const { allowed } = await Apk.canInstall();
      if (!allowed) {
        banner("先に「このアプリからのインストール」を許可してください。許可したら戻ってもう一度押してください", [
          ["設定を開く", () => Apk.openInstallSettings().catch(() => showManualInstall())],
          ["もう一度", () => installApk(m)],
          ["あとで", hideBanner, "ghost"],
        ]);
        return;
      }
      const listener = await Apk.addListener("progress", ({ percent }) => banner(`ダウンロード中… ${percent}%`));
      banner("ダウンロード中…");
      try {
        await Apk.downloadAndInstall({ url: m.apk });
      } finally {
        listener.remove();
      }
      banner("インストール画面で「インストール」（または「更新」）を押してください", [["閉じる", hideBanner, "ghost"]]);
    } catch (err) {
      showManualInstall(err);
    }
  }

  // Questでアプリ内インストールが使えないときはPCから入れてもらう
  function showManualInstall(err) {
    banner(
      `${err ? err.message + "。" : ""}アプリ内から更新できませんでした。PCで最新のAPKをダウンロードして、SideQuestかadbで入れてください`,
      [
        ["リリースページを開く", () => window.open(RELEASES_PAGE, "_blank")],
        ["閉じる", hideBanner, "ghost"],
      ]
    );
  }

  async function check({ manual = false } = {}) {
    if (!isNative() || !plugin("CapacitorUpdater")) {
      if (manual) banner("自動アップデートはAPK版だけの機能です。ブラウザ版はPCで最新のコードを取得してください", [["閉じる", hideBanner, "ghost"]]);
      return;
    }
    if (checking) return;
    checking = true;
    try {
      if (manual) banner("更新を確認しています…");
      const m = await fetchManifest();
      const { version: nativeVersion } = await plugin("CapacitorUpdater").getBuiltinVersion();
      if (compare(m.native, nativeVersion) > 0) offerApkUpdate(m);
      else if (compare(m.version, APP_VERSION) > 0) await applyWebUpdate(m);
      else if (manual) banner(`最新版です (v${APP_VERSION})`, [["閉じる", hideBanner, "ghost"]]);
    } catch (err) {
      if (manual) banner("⚠ " + err.message, [["閉じる", hideBanner, "ghost"]]);
      else console.warn("update check failed", err);
    } finally {
      checking = false;
    }
  }

  // この版が正常に起動したことを知らせる。呼ばれないまま時間切れになると前の版に自動で戻る
  function markReady() {
    if (isNative() && plugin("CapacitorUpdater")) plugin("CapacitorUpdater").notifyAppReady().catch(() => {});
  }

  return { check, markReady };
})();
