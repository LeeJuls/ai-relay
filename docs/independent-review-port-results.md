# Preview.3 verification — 2026-10-25

The owner authorized the public behavior port and push. Work was confined to the public checkout; no running private helper, real route, live mailbox or app registration was changed.

## Implemented / already covered

- **Added:** explicit opt-in independent review and bounded same-task followup; subscription-only native Claude/Codex CLI adapters; content-bound per-ID and address-wide claims; result-before-reply persistence; archive-aware deterministic reply recovery; separate review/execution status.
- **Added:** an independent review queue, retaining normal mail processing and conservative process-termination holds.
- **Already covered and retained:** ordinary mail batching, automatic delivery archival, first replies to auto-archived mail, slots/history, send-only refusal, app connection probes, uncertain app-delivery holds and local turn-cost accounting.
- **Added:** EN/KO/JA README comparisons, review instructions and changelogs; Japanese usage, token guidance, help/errors, launcher and dashboard locale support. No private model/path defaults.

## Evidence

- Full source suite: **125 passed, 0 failed, 0 skipped**, including native socket transport, two-way isolated acceptance, worker restart, writer races and deterministic verified-runtime ZIP build/install/removal tests.
- Static check: **21 runtime/tool modules, 0 syntax errors**, matching **91 locale keys** in English, Korean and Japanese.
- Package dry-run: **0.1.0-preview.3**, 48 allowlisted files. Review modules and translated docs are included; test jobs, prompts, credentials and private paths are excluded. Documentation relative links were checked with no missing targets.
- Real subscription CLI smoke, one isolated evidence file per provider: Claude Code **2.1.299**, model `claude-opus-5-5`, about **7.7 seconds**; Codex CLI **0.162.1**, model `gpt-6.1-sol`, about **8.9 seconds**. Both read the fixture setting `ALLOW_DEPLOY=false`, returned a scoped rejection, and saved exactly one linked result. These are local smoke observations, **not a speed/token benchmark**. Personal paths, raw transcripts and usage records are not published.
- One fresh ASTRA code review identified three P2 conditions: archived requests missed on restart, disabled queued IDs stranded on re-enable, and unconfirmed child termination allowing a successor. All three were corrected with dedicated regressions. The final suite above was run after those fixes. The CLI smoke preceded the queue/termination fixes; actual provider arguments are unchanged and the fixed lifecycle paths are covered by deterministic fixtures.

## Limits / rollback

This is a Git source update, not a new ZIP release. The real smoke exercised the public core and provider CLIs; it did **not** establish live desktop delivery, app-restart compatibility, or independent-user/PC acceptance. Normal transport remains experimental and version-sensitive.

Upgrade and re-register each chosen receiving helper before enabling reviews. To stop using reviews, disable that address's review configuration and keep normal mail. Preserve interrupted claims; do not replay or bulk-complete them. Do not run older receivers over pending review metadata. An uncertain child retains its address-wide execution claim until the owner proves termination and explicitly reconciles it. See [review instructions](independent-review.md).
