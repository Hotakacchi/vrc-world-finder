# VRC World Finder

Meta Questのブラウザで使うVRChatワールド検索アプリです。

## 使い方

1. PCでサーバーを起動する
   ```
   npm start
   ```
2. 表示された `Quest: http://192.168.x.x:3939` のURLを、QuestのブラウザでPCと同じWi-Fiから開く
3. VRChatアカウントでログインする（2段階認証にも対応）
4. ワールドの「入る」「合流する」などを押すと、VRChat内に招待通知が届く

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
画面やロジックは `public/` を編集すれば、ブラウザ版とAPK版の両方に反映されます（VRChatとの通信は `public/vrc.js`）。

## 機能

### VRChatと同じ機能
- 🔍 **検索**: キーワード検索・並び替え（人気／話題／お気に入り数／新着／関連度）、Quest対応だけに絞り込み
- ⭐ **お気に入り**: VRChatのお気に入りをグループごとに表示、追加・解除
- 🕘 **最近**: 最近行ったワールドの履歴
- 👥 **フレンド**: オンラインのフレンドがいるワールドをまとめて表示し、ワンタップで合流
- 🚪 **インスタンス一覧**: 開いているパブリックインスタンスと人数を見て、そこに入る／新しく作って入る

### このアプリだけの機能
- 🎲 **ワールドガチャ**: 条件（キーワード・人気・行ったことがない・日本語）に合うワールドをランダムで1つ提案
- 📝 **行きたいリスト**: お気に入りとは別の、件数無制限の自分用リスト。★評価・メモ・「行った」チェック付き（端末内に保存）
- 🔥 **ランキング**: 独自集計の「📈 急上昇」（新作の1日あたりお気に入り増加数）と「💎 穴場」（お気に入りは多いのに今は空いている名作）
- 🎛 **詳細フィルター**: 定員・今いる人数・お気に入り数・公開時期・日本語ワールド・行ったことがないワールドで絞り込み

## 注意

- VRChatの非公式APIを使っています。短時間に大量のリクエストを送らないでください。
- ログイン情報（認証クッキー）は `.session.json` に保存されます。共有しないでください。
- 同じネットワーク上の端末からはログイン済みの状態で使えるため、自宅のネットワークでのみ使ってください。
