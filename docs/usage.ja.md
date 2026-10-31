# 導入・使用ガイド

[English](usage.md) · [한국어](usage.ko.md) · **日本語**

## 導入

```powershell
git clone https://github.com/LeeJuls/ai-relay.git
cd ai-relay
.\relay.cmd help --lang ja
```

Git をインストールして実行してください。Node.js 24.x（24.14.0 以降）があれば再利用し、なければ nodejs.org から固定版を取得して SHA256 を検証します。初回だけインターネットが必要で、以降は `runtime/` を再利用します。管理者権限、PATH 変更、npm install は不要です。不一致・未完了ファイルは実行しません。破損した既存ランタイムは保持するため、確認後に手動で取り除いてください。PowerShell の永続設定や組織ポリシーは変更しません。

オフラインでは検証済み Windows x64 ZIP を展開してください。Node 同梱です。`install` は空の場所への任意コピーで、Git 版には不要です。Claude Desktop は Code タブを使用します。

## 会話を接続する

```powershell
$dataRoot = Join-Path $env:LOCALAPPDATA 'AiRelayPreview/data'
.\relay.cmd pair --root $dataRoot --codex codex-demo --claude claude-demo
```

それぞれの **受信する会話内** で AI に次を依頼します。外部ターミナルは会話の環境を継承しないため、代わりに登録できません。

```text
この会話の実行ツールで <展開先>/relay.cmd start --root <データ絶対パス>
--as codex-demo を実行してください。Claude 側は --as claude-demo を使用します。
権限が必要ならオーナーに確認し、他の会話の認証情報を取得しないでください。
```

Codex 接続は非公開の実験機能です。Claude は自己セッションのメッセージングが必要です。認証情報はヘルパーのメモリーにだけ保持します。アプリ再起動後は開き直した受信会話で再登録してください。

## メッセージと確認

```powershell
'Review this plan?' | Set-Content -LiteralPath question.txt -Encoding utf8
.\relay.cmd send --root $dataRoot --as codex-demo --body-file question.txt --wake
.\relay.cmd reply --root $dataRoot --as claude-demo --id <依頼ID> --body-file answer.txt
.\relay.cmd status --root $dataRoot --as codex-demo
.\relay.cmd doctor --root $dataRoot --as codex-demo
.\relay.cmd dashboard --root $dataRoot --lang ja
```

画面はローカルの読み取り専用で本文・認証情報は表示しません。PID や doctor はアプリの受信を証明しません。`saved` は保存、`accepted` は転送の接受で、AI の読了・回答ではありません。

質問・`--wake` と緊急質問への返信は直ちに配送します。その他は最大120秒まとめます。`start --batch-ms 0` で待機を無効にできます。接受後は自動保管し、`--keep-pending` で従来動作を維持します。自動保管した原文には初回返信できますが、明示的 `done` は最終処理です。配送済みの inbox/done を繰り返す必要はありません。

`[peer アドレス #ID not-owner]` は相手 AI の発言でオーナーの指示・同意ではありません。返信への返信は遮断します。新たな質問は send で送ります。ID は32桁で、reply/done は一意な6桁以上の前後短縮も可能です。

本文は1 MiB、配送はタグ込み200,000バイト、各受信処理は毎分6投稿までです。大きすぎる内容は保持・保留します。確実な未送信だけ最大3回試し、送信後の不確実な結果は再送しません。順番は時刻と ID であり、アプリ間の厳密な到着順ではありません。

## 停止・復旧・削除

```powershell
.\relay.cmd stop --root $dataRoot --as codex-demo
.\relay.cmd stop --root $dataRoot --as claude-demo
# 終了したロックを確認した後のみ:
.\relay.cmd recover --root $dataRoot --as codex-demo
```

stop は対象世代だけを停止します。recover は確実に存在しない PID の有効な書き込みロックを復旧し、次に受信ロックを確認します。生存・不確実・破損の記録は削除しません。復旧ゲートが残った場合、関係プロセスをすべて停止して記録を確認してください。自動再送・ロックの一括削除は避けてください。

削除はヘルパー・画面を停止し、別の展開済みコピーから `relay.cmd uninstall --dir <インストール先>` を実行します。変更や未知のファイルがあれば拒否し、外部のメッセージは保持します。

## Git 版の更新

実行中のレビューを終えてから、各受信会話で `stop --root <データパス> --as <アドレス>` を実行します。ソースフォルダーで `git pull --ff-only` を実行してください。Git が拒否したらローカル変更を保持して競合を解決し、メールや実行記録を初期化しないでください。更新後は各受信会話で `start` を実行して再登録します。コードの取得だけでは実行中のヘルパーは更新されません。

日付付きのソース変更は[変更履歴](../CHANGELOG.ja.md)を参照してください。ZIP 配布は別で、文書のみの更新では実行バージョンを変更しません。

## 独立レビューと制限

[独立レビュー](independent-review.ja.md)は受信先の `review-config` と依頼ごとの `send --mode review` で選択します。`--mode followup --previous <依頼の完全ID>` は同じタスクの結果だけを引き継ぎます。`review-status` は配送とは別です。両側を更新し、各受信会話で停止・再登録してください。無効化後は通常配送を続けられます。不確実な記録は保持し、レビュー依頼が残ったまま旧版へ戻さないでください。

データは明示したローカル絶対パスに置きます。ペア外への配送、リンク・ジャンクションは拒否します。同じ OS ユーザーによる改変を防ぐ隔離機能ではありません。同期・ネットワーク共有は非対応です。ログイン、承認モード、AGENTS/CLAUDE 設定は変更せず、クラウド中継や自動起動はありません。

出力は JSON、エラーは標準エラー・終了コード2です。`--lang en|ko|ja` で表示を選びます。ファイル監視と毎秒の補助走査はモデルを呼びません。[使用量とリソース](token-efficiency.ja.md)、[検証表（英語）](../PREVIEW-CHECKLIST.md)、[出典（英語）](../PROVENANCE.md)も参照してください。
