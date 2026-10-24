# Independent review port — preview.3

Owner-approved scope: port the proven local review workflow into the public architecture, update EN/KO/JA documentation, verify, commit and push. Do not change any running private installation.

1. Add an optional explicit review/followup message mode and per-address opt-in configuration. Normal mail keeps its current format and transport.
2. Run subscription-authenticated native Claude/Codex CLIs with read-only settings, a neutral working directory, designated evidence and a bounded deadline. No API-key fallback, history resume, editing or permission bypass.
3. Persist a content-bound execution claim before running. Save results before the deterministic linked reply. On restart, finish publication from saved results; hold incomplete executions without rerunning. Keep ordinary delivery independent of the review queue.
4. Limit followup input to the same task's conclusion, evidence and next action. Expose review status separately from app acceptance. Disabled reviews never fall through to the production chat.
5. Test opt-in/legacy compatibility, exact replies, archive lookup, content changes, concurrent/restarted execution, failure replies, followup bounds, CLI arguments/auth/timeouts and nonblocking mail delivery. Run the full suite and packaging checks; obtain a final fresh code review.
6. Bump preview version and provide concise before/after notes and usage in English, Korean and Japanese. Document limitations and lack of guaranteed token/speed savings. Push the verified commit, without publishing a new binary release or changing live routes.
