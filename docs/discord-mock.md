# Discord bridge: offline simulation only

This source-only tool exercises one bot/AI channel/PC/session route with fake inputs and effects. It does not connect to Discord, register a session, read transcripts, install anything, or invoke the existing app transport. No tokens or app environment are needed. It is not part of the portable product release.

Use the existing Node 24.14.0 runtime, with no npm install or relay launcher:

```powershell
node --test test/discord-mock-policy.test.mjs test/discord-mock-store.test.mjs test/discord-mock-bridge.test.mjs test/discord-mock-scenario.test.mjs
node scripts/check.mjs
```

The store test creates an isolated temporary Windows junction to verify path refusal; this may require execution permission. Existing test fixture cleanup is scoped to its own temporary container. No real mailbox is used.

For a one-shot counts-only demo, give a new absolute private scratch directory (never your real mail root):

```powershell
node tools/discord-mock/scenario.mjs --root C:\your-private-scratch\new-discord-mock-run
```

The command exits after the scenario. It has no listener or background process. Keep the directory if inspecting its durable claims; do not delete uncertain records to force a retry. Reusing a directory preserves its existing IDs and state, so counts reflect only effects performed in that invocation.

The public bridge API is `openMockBridge({store,config,session,publisher,now})` with `ingest(event)`, `tick()`, `submitResult({task_id,result_text})`, `stop()` and `status()`. Session/publisher are mandatory injected effects; there is no live fallback. `stop()` is persistent and blocks new dispatch, while an already dispatched task can still provide its explicit result and publish. There is no resume or forced recovery command.

Input is a normalized mock slash-text event. Exact owner/guild/channel/command allowlists, non-bot/non-webhook origins, no threads/attachments/mentions, timestamp and UTF-8 limits are enforced before storing input. The envelope uses provider-neutral relay message validation, not reciprocal Codex/Claude peer impersonation.

Results contain exactly task_id and result_text. The target is restored from the saved task, not chosen by the result. Publishing disables allowed mentions and inserts a zero-width character after @, then rechecks size. A fake accepted dispatch means transport acceptance only. Completion means the fake publisher accepted a designated result, not real Discord receipt or correct game code.

Mock defaults: one inflight task, eight waiting, 1,000 records; 4,096 input/output UTF-8 bytes and 1,800 output UTF-16 units; two attempts per effect with 1,000ms retry delay; six dispatch attempts/hour and twenty/UTC day. Claims consume quota even if the effect is proven not sent. Events older than five minutes or over thirty seconds in the future are refused. Completed bodies expire after one day, ID/digest tombstones after seven days; incomplete and held bodies are retained for inspection, bounded by the record cap. These are simulation proposals, not adopted live settings.

Each effect is preceded by an atomic durable claim. Only proven not_sent outcomes retry under the same ID. Uncertain/invalid/exception outcomes, interrupted claims and exhausted attempts hold the entire route. Reopening never blindly replays a claimed effect. A second bridge opened during an outstanding effect conservatively holds it; the old generation's late return cannot clear that hold. A stale writer lock or corrupt ledger is refused; no automatic lock takeover is added. Resolve unknown real effects with the operator before considering any recovery. Exactly-once external effects and power-loss guarantees are not claimed.

Status contains counts and `mode: mock`, `actual_tokens: null`, `usage_measured: false`. `inspection_required` counts incomplete tasks whose last state update is at least one body-retention interval old; it does not expose their bodies or clear the hold. Dispatch claims are not necessarily completed calls. Idle/blocked fake effects are zero in the tested scenario; actual model tokens, session read-only capabilities, Discord channel permissions, network reconnect behavior, and actual AI round trips remain untested.

Safe related regression:

```powershell
node --test test/discord-mock-policy.test.mjs test/discord-mock-store.test.mjs test/discord-mock-bridge.test.mjs test/discord-mock-scenario.test.mjs test/core.test.mjs test/storage.test.mjs test/reply.test.mjs test/receiver.test.mjs
```

The full npm test suite also contains portable install/remove and local-server/socket tests, so it is not run under this strict offline/no-install scope. ZIP builds, package publishing and live acceptance are separate work. A future Discord adapter still needs explicit setup/authorization, effective denial of human-channel View access, a user-designated actually read-only session, and a narrowly authorized result callback. This mock API is not such a callback service.
