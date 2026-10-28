# Changelog

**English** · [한국어](CHANGELOG.ko.md) · [日本語](CHANGELOG.ja.md)

## 0.1.0-preview.4 — 2026-10-29

- Independent reviews receive the existing field bounds before generation, with provider-compatible schemas. Oversized results remain rejected; findings are never automatically truncated.
- Available CLI usage is saved before output rejection, including nonzero exits. Raw logs and held state remain inspectable.
- Claude OAuth-refresh contention has a distinct diagnostic; no automatic retry or authentication change.
- Send JSON already includes actual message `type` and `wake`; ordinary delivery, batching and duplicate-execution safeguards are retained.

Local regression checks do not establish model compliance, token savings or a new live-app certification. No new ZIP release.

## 0.1.0-preview.3 — 2026-10-25

Git source update; no new ZIP release is implied.

- Opt-in Claude/Codex independent CLI reviews using subscription login, explicit models and designated evidence. Normal mail remains compatible; no API-key fallback.
- Same-task followup carries bounded conclusion/evidence/nextAction rather than resuming a conversation.
- Content-bound execution claims, saved results, deterministic linked replies and separate review status. Interrupted/uncertain jobs hold instead of automatically running again.
- Reviews run separately from ordinary mail. Failures normally send a blocked result; crash/storage uncertainty stays held for inspection.
- EN/KO/JA before-and-after guidance and review instructions; Japanese help, errors, dashboard and launcher messages.
- Batching, automatic archival, shared slots, send-only policy and turn-cost reports were **already covered** in preview.2 and are retained.

Reviews consume subscription allowance. No fixed token savings, response-time improvement or production-readiness claim.

## 0.1.0-preview.2 — 2026-10-13

Git source update. Versioned ZIP release assets are published separately.

- Batch deadlines use saved message time; accepted inline mail auto-archives with --keep-pending compatibility.
- Auto-archived originals retain safe first replies; manual done and deterministic reply conflict rules remain final.
- Zero-write Claude socket probes and explicit send-only policy.
- Writer-guarded shared slots, stable notification outbox, FIFO wait and audit history; dashboard age/slot visibility.
- Standalone deduplicated Claude/Codex turn-cost report and concise token-efficiency guidance.

- Add first-run Node.js detection and verified local download for Git checkouts, with failure cleanup and concurrent-download protection.
- Share pinned runtime metadata between the launcher and ZIP builder; update the English, Korean and Japanese setup instructions.

- Prevent delivery of questions archived by concurrent done/reply before claiming; keep the app transport outside the writer lock.
- Add conservative dead-global-writer recovery through the existing recover command, with concurrent recovery/acquisition protection.
- Preserve live/malformed locks and uncertain mail; localize writer-ownership errors.
- Add real killed-writer and deterministic archival/acquisition race regressions.

## 0.1.0-preview.1 — public experimental preview

- Portable address pairs, verbatim UTF-8 mail, stable send/reply IDs and explicit archival.
- Separate own-session Codex experimental pipe and Claude Code socket adapters.
- Address-exclusive event receivers, durable pre-send claims, bounded not-sent retries, uncertain restart holds, urgent batching and reply-loop guard.
- Localized help/errors and read-only local status dashboard; no model polling.
- Verified-runtime Windows portable packaging, installation/removal safeguards, and preview acceptance instructions.

Owner selected MIT licensing with attribution on 2026-10-09. Pending release gates: new-product live two-way/restart tests, independent Windows installation, and multiple-user preview results. The MIT experimental preview is published at https://github.com/LeeJuls/ai-relay. No stable support claim or production-helper migration has occurred.
