# Fewer turns, not shorter answers

**English** · [한국어](token-efficiency.ko.md) · [日本語](token-efficiency.ja.md)

Ordinary relay makes no model calls. Every post may start a receiving chat turn, which uses that chat's current context. Batching reduces posts, not review work; no fixed savings are promised. Optional [independent review](independent-review.md) runs a fresh subscription CLI task instead of waking the receiving working chat; its result may still wake the requester.

1. At the end of a work bundle, consider a short handoff and a fresh chat when context is large (roughly 400k+). Do not reset during work or repeatedly reset small chats.
2. Accepted inline mail is automatically archived. It is already delivered; **posted is not processed**. Do not re-read it with inbox or acknowledge it with done. Reply only if needed. `start --keep-pending` preserves the previous behavior.
3. When using agents, include complete tasks initially and group independent starts when your host supports it. These tools neither launch agents nor override host permissions.
4. For shared resources, use `slot` actions instead of handover mail/status polling. Each action returns a `now` all-slot snapshot, including timeout. The JSON field replaces a redundant status call.
5. Send verdicts with `--type result`, information with `--type fyi`, and blocking requests with `--type question`. The public CLI retains question as the default for compatibility. Questions/wake posts flush a batch; nonurgent mail waits up to 120 seconds from saved time (`--batch-ms 0` disables the delay). Replies to wake questions inherit wake.
6. Measure locally outside the working chat, for example once daily. Report cached and uncached context separately; tokens are not a price or proof of usage-limit effects.
7. For notes, prefer one bounded find-first query and one exact section read. If truncated or ambiguous, resolve the evidence rather than inventing a conclusion. A vault reader is not shipped with this transport tool.
8. Humans can inspect the read-only dashboard. No repeated “are you alive?” mail. Connection probes are machine-only; `start --probe-ms 30000` is the default (0 disables them).

## Slots

```powershell
.\relay.cmd slot --root C:\relay-data --as codex-work --action take --name unity
.\relay.cmd slot --root C:\relay-data --as claude-work --action wait --name unity --timeout-ms 60000
.\relay.cmd slot --root C:\relay-data --as codex-work --action give --name unity
.\relay.cmd slot --root C:\relay-data --as codex-work --action history --name unity
```

`give` chooses the first waiter or frees the slot; `--to` selects a registered receiver. A live waiter needs no mail. A nonwaiting/dead waiter gets one relay-generated FYI through its configured peer route. The notice names the actor and is not written by the peer model or owner. `notificationPending` means local publication is not yet confirmed; a later slot action retries the same stable ID, never a new ID. `historyWarning` means the state changed but the audit append failed; inspect locally. State and history are not a multi-file atomic transaction.

`take --force --reason "owner's actual words"` records the reason and notifies the old holder. This flag is not permission by itself: use only owner-authorized takeover. Signals/timeouts remove the waiting process's own queue entry. Forced process termination may leave a dead waiter, which is explicitly notified on give. A second live wait under the same address is refused. Slot state is guarded by the relay's writer lock; nobody acts under another address to take a resource.

## Send-only addresses

```powershell
.\relay.cmd send-only --root C:\relay-data --as claude-records
.\relay.cmd send-only --root C:\relay-data --as claude-records --off
```

The address must already be registered. Questions and wake mail to a send-only address are refused before writing. The refusal is final: ask the owner or the paired receiving session explicitly; do not retype as FYI, change routes or automatically retry. Ordinary result/answer/FYI is kept only as a record. No receiver may start for a send-only address.

## Local turn-cost report

```powershell
node tools/turn-cost/report.mjs C:\transcripts --since 2026-10-06T00:00:00Z --until 2026-10-07T00:00:00Z --provider claude --json
```

Use `--provider codex` for rollout JSONL. Both window bounds are required; until is exclusive. Claude calls deduplicate by message.id, Codex calls by cumulative token-count snapshot per file when available. Codex task_complete/task_aborted closes a task. Batches are charged as one turn, not one charge per tagged mail. Context input/cache-read/cache-write/output are separate; handovers are keyword **candidates**, not confirmed events. Missing/malformed rows are reported. No credentials or transcript bodies are included in output. Only ordinary local files are read; subfolders are not recursively scanned. This is accounting from available logs, not a guarantee that every platform emits complete usage.

## Product boundaries

Normal IDs, reply links and JSON mail format are unchanged. The tool still connects reciprocal configured Codex/Claude pairs; arbitrary other-session injection and private runtime imports are not included. Explicit reviews add optional metadata and require both sides to be upgraded; review jobs live under the configured external jobRoot. Oversized posts stay held and pending, never truncated or converted into a broken source-file link. Accepted-but-unarchived messages reconcile without another post. The dashboard reads public data-root state, never private app runtime files.

`reply` and `done` accept full IDs or unambiguous hexadecimal prefixes/suffixes of 6 or more characters. Ambiguity is an error; wire IDs and replyTo remain full 32-character values. New sends still require full IDs when an explicit ID is supplied.

Foreground CLI send/reply/done tolerates a brief pre-action writer lock collision with up to ten short retries. It never retries IO or uncertain app outcomes. Direct library users retain fail-fast WRITER_BUSY and can choose the exported bounded retry helper when appropriate.
