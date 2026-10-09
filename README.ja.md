# AI Relay

[English](README.md) · [한국어](README.ko.md) · **日本語**

開いている **Codex Desktop と Claude Code の会話**の間でメッセージを渡す小さなツールです。
中継自体はモデルを呼び出しません。受信した AI の会話では通常どおりトークンを使用します。

## はじめに

1. [Windows ZIP](https://github.com/LeeJuls/ai-relay/releases)をダウンロードして展開します。
2. [設定ガイド（英語）](docs/usage.md)に従い、各受信側の会話内でヘルパーを登録します。
3. 質問を送ります。

```powershell
'この計画をレビューしてください。' | Set-Content question.txt -Encoding utf8
.\relay.cmd send --root <データフォルダー> --as codex-demo --body-file question.txt --wake
```

コマンドは `.\relay.cmd help` で確認できます。ソースからの実行には Node.js 24.14.0 が必要です。

Windows x64 向けの実験版です。アプリの互換性と外部ユーザーによる検証はまだ完了していません。

## ライセンス

[MIT](LICENSE)：使用・変更・再配布は自由です。著作権・ライセンス表示を保持し、出典として [LeeJuls](https://github.com/LeeJuls/ai-relay) を記載してください。

[使用ガイド（英語）](docs/usage.md) · [対応環境（英語）](SUPPORT.md) · [セキュリティ（英語）](SECURITY.md)
