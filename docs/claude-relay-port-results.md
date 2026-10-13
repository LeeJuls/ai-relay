# Claude relay behavior port — local candidate

Owner-approved scope, 2026-10-13. Implemented in ai-relay's own architecture. The private relay is a behavior reference, not a dependency. No production chats or receiver registrations were changed; no model calls were made for transport/locks/measurement. One ASTRA whole-branch code review was used for implementation QA.

| Handover item | Result | Evidence / disposition |
|---|---|---|
| 1 Batch nonurgent mail | done | Saved-time deadlines, createdAt ordering, urgent flush, zero-delay option, per-ID receipts; port-delivery/receiver tests. |
| 2 Urgent reply propagation | **already covered** | Existing question-only wake inheritance preserved; reply tests. |
| 3 No uncertain resend | **already covered** | Durable claims, accepted/uncertain restart suppression, bounded proven-not-sent retry and claim-save failure tests retained. Unknown private legacy formats are not imported. |
| 4 Archive posted mail | done | Inline accepted posts auto-archive, keep-pending opt-out, stable oversized holds, first archived reply, unique short references, manual-intent and archive-failure regression tests. |
| 5 Dead socket probe | done | Zero-byte Claude probe; configurable 30s interval and 0 off; disconnected stop reason, generation lock cleanup tested on a fake disappearing socket. |
| 6 Shared slots | done | Exclusive writer, six-process race, FIFO, live/dead waiter notification, exact wait tokens, grant/deadline reconciliation, force reason/history/displaced holder, abort and CLI timeout now snapshot. |
| 7 Send-only | done | Registered address flag, final localized refusal before publication, record mail, off option, existing receiver recheck and status display. |
| 8 Other-Claude injection | skipped | Preserve reciprocal configured peer security. Arbitrary additional senders need a separate topology decision. |
| 9 Turn-cost reader | done | Local streaming JSONL CLI, explicit time window, keyed usage dedup, cache/input/output separation, batched-turn accounting, tool-result continuation and Codex task closure. Synthetic fixtures only. |
| 10 Dashboard signals | done | Oldest mail age, send-only, helper/held status, slot holder/queue/age and inferred inactivity. Reads public data root only, never private app files; no bodies or credentials. |
| 11 Vault reader | skipped | Optional transport-only exclusion approved in the plan; no Python or personal vault dependency shipped. |
| 12 Compact review notation | skipped | Conditional item: public ai-relay has no compact/model review executor. Existing CLI/wire format retained. |
| 13 Token guidance | done | Concise token-efficiency guide linked from English/Korean/Japanese entry docs. Guidance does not grant authorization or reset sessions automatically. |

## Validation

- Baseline: 82 tests before changes, syntax errors 0.
- Candidate: 105 tests passed, failures 0. Includes the Windows checksum-bound portable ZIP test, install/uninstall preservation, and two-way fake-native-pipe acceptance with own helpers stopped.
- Syntax: 17 modules checked, errors 0. English/Korean locale sets match (80 keys).
- Package allowlist includes the standalone turn reader and token guide, excludes execution plan, tests, runtime logs, mail and personal settings. No release upload was performed.
- ASTRA's manual-done race, competing-wait cleanup, timeout/grant race, running send-only transition and tool-result turn accounting findings were resolved with regressions. Final self-test also reproduced foreground/archive lock contention: only proven pre-action WRITER_BUSY retries briefly in CLI/self-test; core fail-fast and uncertain-send holds remain.

All 10 in-scope items are covered (8 implemented, 2 already covered); 3 optional/security-boundary items are explicitly skipped. This proves synthetic transport and packaging, not compatibility with every live desktop app/version, exactly-once model effects, real editor integration, or measured token savings.

Implementation lives on a local feature branch; commits use the owner's `[C]` prefix. A single private result record is sent after commit. Public push, release publication and switching production helpers require separate owner confirmation.
