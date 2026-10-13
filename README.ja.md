# AI Relay

[English](README.md) · [한국어](README.ko.md) · **日本語**

**Claude Desktop（Code タブ）と Codex Desktop の会話**をつなぎ、メッセージをやり取りするツールです。
中継自体はモデルを呼び出しません。受信した AI の会話では通常どおりトークンを使用します。

## 最新の更新

**0.1.0-preview.2 · 2026-10-13** — メッセージのまとめ配送・自動保管、共有リソース、セッション接続確認、ローカルのトークン集計を追加しました。[変更履歴](CHANGELOG.md)。Git 版のバージョンです。ZIP は別途公開します。

## はじめに

Git がインストール済みの場合：

```powershell
git clone https://github.com/LeeJuls/ai-relay.git
cd ai-relay
.\relay.cmd help
```

`relay.cmd` は対応する Node.js を使用し、なければ初回に検証済みのファイルを自動ダウンロードします。システムへのインストールは不要です。オフラインでは Node.js 同梱の [Windows ZIP](https://github.com/LeeJuls/ai-relay/releases)を利用できます。

[設定ガイド（英語）](docs/usage.md)に従い、各受信側の会話内でヘルパーを登録してください。npm install は不要です。

Windows x64 向けの実験版です。アプリの互換性と外部ユーザーによる検証はまだ完了していません。

## ライセンス

[MIT](LICENSE)：使用・変更・再配布は自由です。著作権・ライセンス表示を保持し、出典として [LeeJuls](https://github.com/LeeJuls/ai-relay) を記載してください。

[使用ガイド（英語）](docs/usage.md) · [対応環境（英語）](SUPPORT.md) · [セキュリティ（英語）](SECURITY.md)

[トークン節約・共有リソース](docs/token-efficiency.md)
