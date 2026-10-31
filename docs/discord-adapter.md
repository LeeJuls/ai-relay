# Discord adapter boundaries (source-only, no running client)

This adds Discord command normalization, a durable single-route coordinator, and
a REST message publisher. The subsequent source-only Gateway/ACK/host wiring is
documented in discord-host.md. No real Gateway has been connected, bot installed,
credential loaded, session registered, readonly enforced or daemon started.
No model call occurs unless an explicitly injected session dispatch is called by
an explicit `tick()`. Idle ticks never call a model. Actual token use is unknown.

The existing 98-test mock suite and the additional 23 offline preparation tests
remain separate, unchanged. This directory imports no mock modules and is not
wired into the existing private pipe, peer registry, relay CLI or release package.
Do not attach a real effect to `openMockBridge` to enable live operation.

## Interfaces

`adapterConfig(config)` in `tools/discord-adapter/interaction.mjs` requires all
of `application_id`, `command_id`, `guild_id`, `channel_id`, `owner_id`,
`human_channel_ids` (nonempty, disjoint), `command`, `session_address`, `route_id`.
IDs must be bounded decimal snowflakes; route and session names are explicit.
The configuration is copied/frozen. There are no real/default target IDs.

`parseCommand(dispatch, config, nowMs)` accepts only an authenticated Gateway
client's `op:0, t:INTERACTION_CREATE` envelope, guild text channel type 0,
interaction type 2, slash command type 1, and exactly one string option named
`text`. It checks application/registered command/guild/channel/owner IDs, rejects
DMs/threads/bots/webhooks/resolved attachments or extra options, bounds UTF8 text
to 4096 bytes, and refuses mention syntax. The location gate precedes text
inspection. The snowflake timestamp must be at most five minutes old and thirty
seconds in the future. Original interaction tokens/payloads are not persisted or
returned. Identity authentication must come from the host's Gateway connection;
calling this parser on arbitrary JSON is **not** authentication.

The accepted item contains event_key, deterministic discord-task ID, digest,
pinned target and a provider-neutral relay question envelope. `createIngress`
is a standalone wrapper around an injected durable `admit(item)` contract; it
does not dispatch. Its `stop()` blocks new admission. Production coordination
uses `openAdapterRuntime.receive()` instead, not both wrappers simultaneously.

`openAdapterRuntime({root,config,session,publisher,now})` requires an absolute,
dedicated root and injected `session.dispatch(request)` and
`publisher.publish(claimedTask)` methods. It reuses only generic storage and
message helpers. Never use a mail root, mock ledger root or shared root between
routes. `discord-adapter.json` stores the config fingerprint, event/task mapping,
claims, state, limited bodies and counters. It has no interaction tokens.

- `receive(dispatch)` durably admits/deduplicates the parsed question. Conflicting
  content for an existing event is rejected. Queue 8, records 1000.
- `tick()` performs at most one effect, serialized in process and claimed on disk
  under the storage writer lock before invocation. A single inflight task retains
  its slot through dispatch/result/publication/retries. Dispatch attempts are
  limited to 6/hour and 20/UTC day; two attempts/effect, minimum 1 second apart.
- `submitResult({task_id,result_text})` only accepts an explicit result for a
  transport-accepted task. It cannot change the destination. Identical repeats
  are harmless; conflicts are rejected. Transport acceptance is not proof of
  reading or task completion. Publish success requires a message receipt.
- Only a definite `not_sent` permits bounded retry. Exceptions, malformed
  outcomes, interrupted claims or failed post-effect bookkeeping hold the route.
  Remaining claims become held at reopen. Late completions cannot overwrite a
  different state/generation. No automatic recovery/resume/force-unlock exists.
- `stop()` durably blocks **new dispatch only**. It does not cancel work; queued
  admission and prior result/publication may still complete. `close()` waits for
  current work; it is not an emergency cancellation mechanism.
- Completed bodies are pruned after 24 hours, dedup tombstones after 7 days.
  Nonterminal/held records stay for inspection and eventually hit the record cap.
  Counts only are returned by `status()`, with actual_tokens:null and
  usage_measured:false. Ledger bodies contain explicit questions/results only.

`createPublisher({config,request,now})` in `publisher.mjs` accepts an already
durable `discord_publish_claimed` snapshot. It validates route/session/target,
bounds escaped output to 1800 UTF16 units/4096 UTF8 bytes, supplies empty
allowed_mentions, a stable 24-character nonce and enforce_nonce. It only requests
POST `/api/v10/channels/<configured AI channel>/messages` and checks returned
message ID/channel/nonce. No channel history/listing/reading endpoint exists.
An uncertain result holds its instance; 401/403 blocks it. 429 supplies bounded
retry_after/cooldown, without an internal retry loop. A new instance does not
replace durable ledger recovery. Discord nonce uniqueness covers recent minutes,
so it is supplementary, not permanent exactly-once delivery.

`createRestRequest({channel_id,fetchImpl,authorization})` in `rest.mjs` binds the
fixed HTTPS Discord host and channel POST route, with a 10-second AbortSignal,
redirect:error, zero adapter retries, 64KiB streamed JSON response cap and
suppressed mentions. Both fetch and a credential callback are required; neither
is discovered from the environment. Errors are sanitized without raw causes or
response body. Tests use fake fetch/Response and `Bot OFFLINE_ONLY` only.
The injected fetch must honor standard fetch/AbortSignal behavior and must not
independently retry or redirect. A caller deliberately injecting another transport
or hostile JavaScript proxies is outside this local trusted-code boundary.

## Initial boundary and subsequent host implementation

There is no runnable live CLI or default fetch binding. Gateway, ACK and limited
callback host source wiring has now been implemented with fake tests; see
discord-host.md for its interfaces and remaining real session broker requirement.
No public HTTP listener is added. The standalone runtime still requires a host
to perform ACK; its eventual channel result is not a substitute. A missed ACK
must not lead to new task IDs or automatic reruns. HTTP interaction signatures
would be required if a future design chooses a public interactions endpoint.

Enforced readonly/limited result callback and exact session identity are still
unverified. Injected callbacks do not establish those properties. The host must
separately demonstrate platform restrictions on file/command/browser/external
write capabilities and provide an authenticated limited result submission path.
The current Claude auto-permission session is not established as suitable.

Use one runtime route/root/PC first. Two runtimes do not share inflight/quotas;
multi-session Claude/Codex selection needs a PC-wide scheduler before live use.
Neither AI auto-reads another bot output. Human assigns each short question.
Human-channel access denial also needs effective Discord permission inspection;
code filters alone do not establish account-level access denial.

Needed once from the user: guild/AI channel/all human channel/owner/application/
command IDs; PC and exact session plus enforced readonly and constrained result
callback. Bot creation, OAuth install, credential registration and persistent
session access still require concrete separate confirmation. Do not paste tokens
into chat, Git, Obsidian or logs. General live permission does not select targets
or weaken readonly. No actual Discord/AI traffic has been tested in this phase.

## Offline verification

```powershell
node --test test/discord-adapter-interaction.test.mjs test/discord-adapter-publisher.test.mjs test/discord-adapter-runtime.test.mjs test/discord-adapter-rest.test.mjs
node scripts/check.mjs
```

The related regression additionally runs the existing ten discord-mock/core/
storage/reply/receiver files documented in discord-preflight.md. Full npm test,
packaging/install and server/socket suites are not run for this phase.

Official references checked for this implementation:
[Gateway events](https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway-events.mdx),
[interaction responses](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/receiving-and-responding.mdx),
[message creation/nonce/mentions](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx),
[rate limits](https://github.com/discord/discord-api-docs/blob/main/developers/topics/rate-limits.mdx).

## Verification and recorded limitations

Final offline related suite: **154/154 PASS** (existing 121 + adapter 33), no
failures/cancellations/skips. Syntax: 0 errors, 32 modules, 93 locale keys.
Independent read-only review found two Important issues: mutable callback
outcomes could change uncertainty into retry permission, and structurally
inconsistent saved state could replay completed work. Both were reproduced by
failing tests and fixed: outcomes are detached before asynchronous bookkeeping,
and per-effect outcome/claim/attempt/result/receipt invariants are checked before
recovery or effects. This is corruption detection, not protection against a
hostile actor coherently rewriting the entire local ledger.

The two Minor findings recorded at that review were subsequently fixed with
failing regressions: config field/channel-set ordering is canonical, and
standalone publisher `ALREADY_PUBLISHED` latches its instance hold.
The integrated runtime also holds the route on that outcome. Do not use a fresh
publisher or bypass the ledger to recover. The publisher's in-memory receipt set
is supplementary; it is not a durable recovery tool or an independent service.
No production startup/readiness or actual token-savings claim follows from these
offline results. The final log is `../discord-adapter-final-regression.log`
relative to this isolated checkout; it is not a tracked release artifact.
