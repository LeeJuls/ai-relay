# 不要なターンを減らす

[English](token-efficiency.md) · [한국어](token-efficiency.ko.md) · **日本語**

通常の中継はモデルを呼びませんが、配送が受信会話の文脈を使うターンを起動する場合があります。[独立レビュー](independent-review.ja.md)は受信作業会話の代わりに短い CLI 文脈で実行します。結果を受ける依頼側では再びターンが発生し得ます。一定の削減率・速度は保証しません。

- 大きな文脈（目安40万トークン以上）は作業の区切りで引き継ぎをまとめ、新しい会話を検討します。作業途中や短い会話の繰り返しリセットは避けます。
- 結論は `--type result`、情報は `--type fyi`、回答なしに進めない場合のみ question を使います。互換性のため既定値は question です。質問・wake と緊急質問への返信は即時、その他は保存時刻から最大120秒まとめます。
- 接受済み本文は自動保管しますが **配送は処理完了ではありません**。投稿済みメールの inbox/done を繰り返さず、必要な返信だけ行います。`--keep-pending` は従来動作です。
- 独立作業には最初に十分な範囲を与え、ホストが許可する場合のみ並列化します。このツールはエージェントや権限を代行管理しません。
- ノートは絞った検索から必要な節へ進みます。省略・曖昧さがあれば根拠を追加確認します。vault 読み取りツールは含みません。

## リソースと記録専用

```powershell
.\relay.cmd slot --root C:\relay-data --as codex-work --action take --name unity
.\relay.cmd slot --root C:\relay-data --as claude-work --action wait --name unity --timeout-ms 60000
.\relay.cmd slot --root C:\relay-data --as codex-work --action give --name unity
.\relay.cmd slot --root C:\relay-data --as codex-work --action history --name unity
```

引き継ぎメールの代わりに slot を使い、結果の `now` から全体を確認します。give は最初の待機者に渡すか解放し、`--to` で指定もできます。待機していない相手には FYI を残します。死んだ待機者を自動で飛ばす準備確認方式ではありません。通知はオーナー承認ではありません。

`notificationPending` は通知保存の未確認で、後の操作が同じ ID を再利用します。`historyWarning` は状態変更後の履歴保存失敗です。状態と履歴は複数ファイルの原子的処理ではありません。`take --force --reason "オーナーの実際の指示"` は承認済みの引き継ぎにのみ使い、オプション自体は権限を与えません。シグナル・制限時間で自分の待機を除去しますが強制終了では死んだ待機が残る場合があります。

`send-only --root C:\relay-data --as claude-records` は登録先を記録専用にし、`--off` で戻します。質問・wake は保存前に拒否します。FYI への変更や別宛先への迂回で再送せず、オーナーか対応する作業会話に明示的に確認してください。

## ローカル測定

```powershell
node tools/turn-cost/report.mjs C:\transcripts --since 2026-10-06T00:00:00Z --until 2026-10-07T00:00:00Z --provider claude --json
```

Codex は `--provider codex` を使います。両時刻が必須で終了は含みません。Claude message.id・Codex 累積スナップショットで重複を除き、task_complete/task_aborted で作業を閉じます。まとめ投稿は一ターンとし、キャッシュ読み書き・非キャッシュ入力・出力を分けます。引き継ぎキーワードは候補扱いです。欠損・破損を報告し、本文・認証情報は出力せず下位フォルダーは再帰走査しません。ログの使用量は実際の請求・制限への影響を保証しません。

ローカル画面と既定の `start --probe-ms 30000` を使います。接続確認・ファイル監視はモデルを呼びません。reply/done は一意な6桁以上の ID の前後短縮も使用できます。CLI は書き込み前のロック拒否だけ最大10回短く待ち、IO・不確実な配送は再試行しません。詳しくは [使用ガイド](usage.ja.md)を参照してください。
