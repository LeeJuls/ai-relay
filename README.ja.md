# AI Relay

[English](README.md) · [한국어](README.ko.md) · **日本語**

**Claude Desktop（Code タブ）と Codex Desktop の会話**をつなぎ、メッセージをやり取りするツールです。
通常の中継はモデルを呼び出しません。任意の独立レビューはログイン済み CLI のサブスクリプションを使用し、別の API キーは不要です。

## 最新の更新

**0.1.0-preview.3 · 2026-10-25** — [独立レビュー・絞った再レビュー](docs/independent-review.ja.md)、結果保存と重複実行防止を追加しました。通常のメッセージはそのまま使えます。[変更履歴](CHANGELOG.ja.md)。Git 版です。ZIP は別途公開します。

| 以前 | 改善後（任意） |
|---|---|
| レビューのたびに長い作業会話を起動 | 依頼と指定した根拠だけで新たなレビューを実行 |
| 再レビューに以前の文脈が必要 | 直前の結論・根拠・次の行動だけを引き継ぐ |
| アプリの接受だけでは完了が不明 | レビュー結果と関連返信の状態を別々に記録 |

レビューにはトークンを使用します。応答速度や一定の削減率は保証しません。

## はじめに

Git がインストール済みの場合：

```powershell
git clone https://github.com/LeeJuls/ai-relay.git
cd ai-relay
.\relay.cmd help --lang ja
```

`relay.cmd` は対応する Node.js を使用し、なければ初回に検証済みのファイルを自動ダウンロードします。システムへのインストールは不要です。オフラインでは Node.js 同梱の [Windows ZIP](https://github.com/LeeJuls/ai-relay/releases)を利用できます。

[設定ガイド](docs/usage.ja.md)に従い、各受信側の会話内でヘルパーを登録してください。npm install は不要です。

Windows x64 向けの実験版です。アプリの互換性と外部ユーザーによる検証はまだ完了していません。

## ライセンス

[MIT](LICENSE)：使用・変更・再配布は自由です。著作権・ライセンス表示を保持し、出典として [LeeJuls](https://github.com/LeeJuls/ai-relay) を記載してください。

[使用ガイド](docs/usage.ja.md) · [対応環境（英語）](SUPPORT.md) · [セキュリティ（英語）](SECURITY.md)

[トークン節約・共有リソース](docs/token-efficiency.ja.md)
