# VRC World Finder

Meta Questのブラウザで使うVRChatワールド検索アプリです。

## 使い方

1. PCでサーバーを起動する
   ```
   npm start
   ```
2. 表示された `Quest: http://192.168.x.x:3939` のURLを、QuestのブラウザでPCと同じWi-Fiから開く
3. VRChatアカウントでログインする（2段階認証にも対応）
4. ワールドを検索して「自分に招待を送る」を押すと、VRChat内に招待通知が届く

## APK版（PC不要）

APK版はアプリから直接VRChatに通信するので、PCサーバーは不要です。

### インストール
APKは [Releases](https://github.com/Hotakacchi/vrc-world-finder/releases/latest) からダウンロードできます。

1. Meta Horizonアプリ（スマホ）でQuestの開発者モードをオンにする
2. QuestをUSBでPCにつなぎ、Quest内で「USBデバッグを許可」する
3. `C:\Android\sdk\platform-tools\adb.exe install -r VRCWorldFinder.apk`（またはSideQuestにドラッグ＆ドロップ）
4. Questのアプリ一覧 →「提供元不明」から起動

### ビルド方法
```
npx cap sync android
cd android
set JAVA_HOME=C:\Android\jdk-21.0.12.1+1
gradlew.bat assembleDebug
```
APKは `android/app/build/outputs/apk/debug/app-debug.apk` に出力されます。
画面やロジックは `public/` を編集すれば、ブラウザ版とAPK版の両方に反映されます（APK版のVRChat通信は `public/vrc-native.js`）。

## 機能

- キーワード検索・並び替え（人気／話題／お気に入り数／新着／関連度）
- Quest対応ワールドだけに絞り込み
- ワールド詳細（説明・定員・訪問数・タグ）
- インスタンスを作成して自分に招待（パブリック／フレンド+／フレンド／招待のみ、地域選択）

## 注意

- VRChatの非公式APIを使っています。短時間に大量のリクエストを送らないでください。
- ログイン情報（認証クッキー）は `.session.json` に保存されます。共有しないでください。
- 同じネットワーク上の端末からはログイン済みの状態で使えるため、自宅のネットワークでのみ使ってください。
