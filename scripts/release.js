// リリース用のファイルを dist/ に作る
//   node scripts/release.js "更新内容のひとこと"
//
// 作るもの:
//   dist/VRCWorldFinder.apk  … APK本体
//   dist/web.zip             … 画面とロジック (public/) 。APK版はこれを自動で差し替える
//   dist/update.json         … アプリが見に行く更新情報
//
// バージョンの決め方:
//   package.json の version          … 画面とロジックのバージョン。毎リリース上げる
//   android/app/build.gradle の versionName … APK本体のバージョン。Android側を変えたときだけ上げる
//     (上げるとアプリは「APKの更新があります」と表示し、上げなければweb.zipだけで自動更新される)
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REPO = "Hotakacchi/vrc-world-finder";
const JAVA_HOME = process.env.JAVA_HOME_ANDROID || "C:\\Android\\jdk-21.0.12.1+1";
const notes = process.argv[2] || "";

const version = require(path.join(ROOT, "package.json")).version;
const gradle = fs.readFileSync(path.join(ROOT, "android/app/build.gradle"), "utf8");
const nativeVersion = gradle.match(/versionName "([^"]+)"/)[1];
const tag = `v${version}`;
const download = (file) => `https://github.com/${REPO}/releases/download/${tag}/${file}`;

function run(cmd, args, opts = {}) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
}

// 1. アプリに埋め込むバージョンを書き込む
fs.writeFileSync(
  path.join(ROOT, "public/version.js"),
  `// scripts/release.js が package.json の version から自動生成する\nconst APP_VERSION = "${version}";\n`
);

// 2. APKをビルド
run("npx", ["cap", "sync", "android"], { cwd: ROOT });
run(path.join(ROOT, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew"), ["assembleDebug", "--console=plain"], {
  cwd: path.join(ROOT, "android"),
  env: { ...process.env, JAVA_HOME, ANDROID_HOME: process.env.ANDROID_HOME || "C:\\Android\\sdk" },
});

// 3. dist/ にまとめる
const dist = path.join(ROOT, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
fs.copyFileSync(path.join(ROOT, "android/app/build/outputs/apk/debug/app-debug.apk"), path.join(dist, "VRCWorldFinder.apk"));
fs.copyFileSync(path.join(dist, "VRCWorldFinder.apk"), path.join(ROOT, "VRCWorldFinder.apk"));

// zipの直下に index.html が来るようにする (Windows標準の tar.exe はzipを作れる)
const tar = process.platform === "win32" ? path.join(process.env.SystemRoot, "System32", "tar.exe") : "zip";
const files = fs.readdirSync(path.join(ROOT, "public"));
if (process.platform === "win32") {
  execFileSync(tar, ["-a", "-c", "-f", path.join(dist, "web.zip"), ...files], { cwd: path.join(ROOT, "public") });
} else {
  execFileSync(tar, ["-r", path.join(dist, "web.zip"), ...files], { cwd: path.join(ROOT, "public") });
}
const webSha256 = crypto.createHash("sha256").update(fs.readFileSync(path.join(dist, "web.zip"))).digest("hex");

const manifest = {
  version,
  native: nativeVersion,
  notes,
  web: download("web.zip"),
  webSha256,
  apk: download("VRCWorldFinder.apk"),
};
fs.writeFileSync(path.join(dist, "update.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("\n準備できました:", manifest);
console.log(`\n公開するには:\n  gh release create ${tag} dist/VRCWorldFinder.apk dist/web.zip dist/update.json --title ${tag} --notes "..."`);
