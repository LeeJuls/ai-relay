# Claude relay behavior port — implementation plan

> For implementation: execute each approved bundle with red/green tests, preserving ai-relay's public contracts. No push without owner confirmation.

## Goal and boundaries

Owner choice B, 2026-10-13: keep ai-relay as the public product and implement the private relay improvements in its own architecture. Source requirements: the owner-provided private `relay/docs/ai-relay-handover.md` (development input only). That private path is a development reference, never a runtime dependency or packaged setting.

Preserve schemaVersion=1 JSON mail, 32-hex IDs, deterministic reply IDs, reciprocal configured peer binding, read-only app context, not-owner origin, explicit roots, durable writer locks and uncertain-delivery holds. No model calls for transport, resource coordination or metrics. Use localized EN/KO CLI/UI keys, and keep concise English/Korean/Japanese entry READMEs. No new server: extend the existing optional loopback dashboard. No credentials, transcripts or real mailbox contents in Git/package output.

Current checkout: main at 8ae0168; clean before this plan. Existing behavior was inspected in lib/core.mjs, receiver.mjs, transport.mjs, service.mjs, dashboard.mjs and tests. Do not copy private implementation code. If a later decision copies any source, update PROVENANCE with path and fixed commit before distribution.

## Item coverage / proposed disposition

| Handover | Status before changes | Plan |
|---|---|---|
| 1 batching | Partially covered: bounded batches, urgent flush, createdAt order and per-ID receipts already exist. Wait starts at first receiver scan. | Fix deadline to saved createdAt; test delayed startup, zero window, date-vs-name ordering and split batches. |
| 2 urgent reply | **already covered**: core reply inherits wake from a wake question, ordinary answers stay nonurgent; reply.test.mjs covers both. | Preserve the narrower question-only propagation. |
| 3 no uncertain resend | **already covered**: claims before post, claim-save failure prevents post, accepted/claimed/uncertain suppress replay, bounded proven-not-sent retries. receiver/transport/recovery tests cover these. | Keep public validated receipt states. Do not import private legacy receipt formats; unknown public receipts fail closed. Expand backpressure/restart test only for missing acceptance evidence. |
| 4 archive accepted mail | Missing. Explicit done currently prevents a first reply; oversized posts are held without posting a file pointer. | Auto-archive inline accepted posts; --keep-pending opt-out; archived accepted originals may receive first deterministic reply. Preserve explicit manual done finality and idempotent/conflicting-reply checks. Oversized holds remain pending with stable source; no pointer posting needed. |
| 5 dead socket probe | Partial: Codex probe exists; Claude has registration-only probe, service has no periodic liveness check. | Add connect-only Claude probe and periodic configurable 30s check (0 off). Distinguish proven missing/refused endpoint from transient errors. Release own receiver lock and record disconnected stop reason. |
| 6 shared slots | Missing. | New lib/slots.mjs using existing ownedPath/withWriter/atomicJson, public root slots state + append-only history. CLI slot take/wait/give/leave/history/status with --as binding. Only registered addresses, no acting under another identity. |
| 7 send-only | Missing. | Public per-address sendOnly config flag and send-only CLI on/off, validated under writer. Reject question or wake before publication; localize final refusal to ask owner/paired session. Never retry under a new type/route. Show flag in status. |
| 8 other Claude sender | **skipped (security boundary)**: current public product routes only reciprocal configured Codex/Claude peers. | Keep generic named addresses and existing not-owner tags, do not introduce arbitrary cross-session senders/multiparty routing in this port. A new peer topology requires an explicit design decision. |
| 9 turn metrics | Missing. | Standalone local Node reader under tools/turn-cost with explicit since/until, stream transcript lines, message.id dedup, cached/uncached split, turn-based batch accounting, keyword-only handover candidates. No transcript contents in report. |
| 10 dashboard | Partial: counts, helper process state and held counts already exist. | Add oldest pending age, sendOnly and slot summaries. Read only ai-relay-owned root; never private Codex files/process environments. Label slot inactivity as inferred from recorded slot activity, not proof that an AI session is idle. |
| 11 vault | **skipped (optional)**: handover explicitly allows transport-only product. | Keep separate shared vault tool private; do not ship Python dependency or personal vault paths. |
| 12 compact | **skipped (conditional)**: ai-relay has no compact/review executor. | Keep existing public send/reply CLI. Do not add model execution or a private compact syntax. |
| 13 token rules | Missing consolidated guide. | Add concise docs/token-efficiency.md; link usage guides. Rules are guidance, not automatic resets/agent orchestration. No claimed savings from unmeasured transcript percentages. |

## Bundle 1 — delivery, fewer turns, send-only

Files: lib/receiver.mjs, core.mjs, transport.mjs, service.mjs, bin/relay.mjs, bin/receiver.mjs; locales/en.json and ko.json; existing test files.

- [ ] Write red tests for saved-time batching (including old pending mail), no early batch, urgent flush, ordering/split and per-ID evidence.
- [ ] Fix batching without relaxing claim/writer invariants or silently dropping messages.
- [ ] Write red tests for accepted auto-archive, keep-pending, first reply after automatic archive, manual done still final, repeated/conflicting deterministic replies and archive failure after accepted receipt.
- [ ] Implement archive using accepted transport evidence, no new automatic model turn. On restart reconcile accepted-but-unarchived mail without posting again.
- [ ] Write fake pipe tests: Claude probe writes zero bytes; service exits within interval after endpoint disappears; disabled interval, transient failure, no concurrent probe during post.
- [ ] Add probe interval and archive opt-out to start/worker options; cleanly stop/release own lock while retaining receipts and original mail.
- [ ] Test send-only question/wake rejects with no file, result/answer/fyi retained, off restores routing, same-id retry rules still hold. Do not wake a send-only receiver.
- [ ] Run targeted then full existing regression and syntax/localization checks. Commit with `[C]` prefix after green.

## Bundle 2 — slots and dashboard

Files: new lib/slots.mjs and test/slots.test.mjs; bin/relay.mjs, lib/dashboard.mjs, locale keys, CLI/dashboard tests.

- [ ] Red tests: six separate-process takers yield exactly one winner; repeat own take idempotent; FIFO wait; live wait PID avoids mail; dead/nonwait receiver gets one notification; force requires reason and records old holder; signal/timeout leaves queue; all command results include all-slot status.
- [ ] Design slot schema local to public root (slots/), explicitly validated; use existing writer lock, no new background server. Commands bind --as to a registered address and use actual process PID for wait.
- [ ] Publish notifications under existing writer in the same transaction path. Handle failed notification without claiming successful notification or retrying uncertain app delivery. Keep state/history writes auditable; history is append-only, not a commit of multi-file atomicity.
- [ ] Implement machine-only wait and explicit give, no polling by AI. Named receiver validation, no forced takeover without owner-supplied reason.
- [ ] Test dashboard privacy, optional slots, oldest mail age, send-only, held mail and inferred stale holder warning >=15m. UI uses localizable strings and existing loopback/read-only origin controls.
- [ ] Full regression, syntax, locale consistency, package privacy/installation checks; commit after green.

## Bundle 3 — local measurement and documentation

Files: new tools/turn-cost/*.mjs and test/turn-cost.test.mjs; docs/token-efficiency.md, usage.md/usage.ko.md, brief README links, PROVENANCE.md, SECURITY.md, CHANGELOG.md, package/build allowlists if tool is shipped.

- [ ] Red tests for explicit window bounds, message.id duplicate rows, turns with multiple calls, cached/uncached split, batches counted once, trigger classification and keyword candidate wording; invalid input/output never includes transcript bodies.
- [ ] Implement standalone reader with synthetic transcripts only; support JSON and text summaries. Keep provider semantics explicit; do not guess missing usage or equate context tokens with billed cost.
- [ ] Document transport accepted != read/processed, result vs blocking question, batch/probe options, slots and send-only refusal finality, situational handoff at work-bundle boundary and ambiguity exceptions for lookup guidance.
- [ ] Reconcile provenance with implementation history: behavior inspired by private owner sources, no code copied unless explicitly recorded. Preserve Node license and package excludes.
- [ ] Run npm test/check, portable package test and two-way fake endpoint acceptance; no real app sends or production restart unless separately authorized. Commit green changes locally.
- [ ] Update this coverage table/results with done/already covered/skipped per item, test evidence and local commit.
- [ ] Send exactly one private `--type result` to claude-relay summarizing completed port, skipped items, tests and commit. No question/progress/ack mail.
- [ ] Stop for owner push confirmation. Do not upload a release or modify public remote without confirmation.

## Approval and review

This is a substantial public feature port. Owner's common workflow requires a written plan and approval before implementation. The proposed scope intentionally excludes optional vault shipping and absent compact syntax; preserves reciprocal peers instead of adopting private multiparty injection. Review/approve these dispositions before starting product code. Bundle 1 is first so transport remains usable independently before slots/metrics land.

## Execution ledger — owner approved 2026-10-13

Implementation completed inline on feature/relay-behavior-port. Ruling: use this clean dedicated checkout and a local feature branch, rather than create another worktree; the approved plan specified this checkout. Ruling: one integration commit after the whole branch is green, since receiver/CLI/locale/slot imports cross the bundle boundary and an intermediate commit would be incomplete. No production receiver was restarted.

ASTRA whole-branch review found manual-done/in-flight acceptance intent loss, duplicate-wait cleanup, deadline/grant race, running send-only transition, and tool-result turn miscount. Each has a synthetic regression; fixes preserve manual intent in separate completion metadata, exact wait-registration tokens and atomic finalization, send-only rechecks, and user/tool-result distinction. Abort interrupts machine wait promptly. Result notifications retain stable IDs and displaced holders in history.

Public product exclusions remain optional vault, absent compact syntax and arbitrary non-peer injection. Fresh public tests are synthetic; private transcript percentages or token savings were not remeasured. Final coverage and test results are recorded in claude-relay-port-results.md.

Ruling: add unambiguous short references only to reply/done to satisfy handover item 4; envelope IDs stay full and stable. Prefix/suffix ambiguity refuses without sending.

Ruling: the final native-pipe self-test reproduced temporary writer contention between accepted archive and foreground reply. Keep core lock acquisition fail-fast; foreground CLI and self-test retry only proven pre-action WRITER_BUSY, bounded to ten attempts. IO, failed publication and uncertain app transport are never automatically retried.
