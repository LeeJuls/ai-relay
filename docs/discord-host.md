# Gateway, ACK and limited result host

These source APIs wire a Gateway driver, ephemeral interaction ACK, durable
single-route runtime, a task-scoped session callback and REST publication. There
is no automatic startup, dependency installation, account registration, credential
lookup, OS permission change or real session selection. All verification uses
fake sockets, fetch, clocks, timers and session capabilities. Real Discord/AI
traffic and enforced readonly remain unverified.

## Construction and transport

`openDiscordHostWithTransport({root,config,fetchImpl,socketFactory,authorization,
sessionBroker,timers,now,jitter,locale})` in tools/discord-adapter/host.mjs is the complete
protocol wiring factory. Pass the explicit adapter config from discord-adapter.md.
`fetchImpl` implements standard fetch/AbortSignal/streaming Response semantics;
`socketFactory(url)` implements the standard WebSocket addEventListener/send/close
interface with text JSON message events. Neither is defaulted. `authorization()`
returns a Bot authorization header from the host's approved credential source;
the library does not load, save or log it. Do not paste actual credentials into
examples, logs or documents. `timers` supplies set(callback,delayMs) and clear(id).

The factory wires `createGatewayDiscovery` (fixed HTTPS GET /api/v10/gateway/bot),
`createAcknowledger` (interaction callback POST), the fixed AI-channel message REST
request and `createGateway`. `openDiscordHost` accepts these boundaries separately
for tests or a reviewed SDK host. It requires a session broker; there is no
private-pipe or prompt-only session fallback.

The returned host exposes start/reconnect/stop/status/drain/close. Construction
only opens the private ledger. `start()` explicitly opens one injected socket;
no source module creates an actual WebSocket by itself. `reconnect()` is explicit
and limited to three connections per driver. Call it after reconnect_required;
there is no endless reconnect/IDENTIFY loop. `stop()` persists the runtime stop
for new dispatch, while previously accepted results can still publish. close
closes input and callback admission, waits for bounded current effects, and
releases the runtime. It does not cancel already-executing model work. Restart
does not clear a prior explicit stop or any uncertain/held claim.

READY/RESUMED wakes eligible persisted work. After each bounded pump, one injected
timer wakes the next queued task, definite-not-sent retry or hourly/daily quota
deadline from `runtime.nextActionAt()`. Waiting for a result, stopped or held
routes and an empty queue create no polling timer or idle model call. close
cancels the wake. A scheduled deadline never bypasses the runtime's durable
claim, single-inflight, ACK, stop, hold or quota checks.

## Gateway lifecycle

`createGateway({config,socketFactory,discover,authorization,timers,now,jitter,
onInteraction})` accepts only single-shard discovery metadata with a remaining
session start budget. Connections use validated `wss://gateway*.discord.gg/` URLs,
v10 JSON without compression, no URL credentials or arbitrary endpoints.
HELLO starts jittered heartbeat and sends IDENTIFY with **intents:0**. READY must
match application ID, version 10 and a bot user before command dispatch. Resume
uses the prior session ID, sequence and validated resume URL only in memory.
Heartbeat ACK, requested heartbeat, missed ACK, RECONNECT, INVALID_SESSION,
RESUMED and fatal auth/config close codes are handled. Fresh IDENTIFY has a
five-second minimum interval; invalid sessions have a five-second cooldown.
Handshake deadline is ten seconds, outbound events at most 90/minute, inbound
text frame at most 64KiB, pending frames16 and command callbacks8. Old socket
generations are ignored. MESSAGE_CREATE/other events never reach the host command
handler. Heartbeats and ignored messages cause no model invocation.

This protects code paths; effective bot-level denial of human-channel View still
needs real permission evidence. A malicious injected transport is outside the
trusted local host boundary. Session tokens are not emitted by status or written
to the runtime ledger. Discovery/auth providers must obey their own bounded
return contract; there is no account/session discovery by inspecting processes.

## ACK, persistence and deadline

Host command handling first checks the exact location/owner/command policy, then
strips the raw payload and token before `runtime.receiveForAck`. This commits an
ACK claim and generation on disk. No session dispatch is eligible until
`finishAcknowledgement` commits accepted for that generation. Duplicates never
retry ACK, create a new task or dispatch again. Not-sent, uncertain, late or
interrupted ACKs hold the route. Late generations cannot unlock a held admission.

`createAcknowledger({fetchImpl,now})` sends only a fixed ephemeral type4
localized queued receipt from the en/ko/ja catalogs (locale defaults to en), with
mentions disabled, using the transient interaction
token in its fixed callback URL. It receives no Bot credential. It uses a 2.5s
budget, redirect:error and no retry; only timely204 is accepted. Host independently
enforces the deadline with injected timers, conservatively bounded by the
interaction's snowflake time as well as local receipt time. A delayed ACK can
have reached Discord even if the host reports uncertainty; the host does not
dispatch or automatically resend in that case. The eventual channel result is
not used as a substitute for ACK.

## Real session interface still required

The library's required broker contract is:

```js
sessionBroker.authorize({route_id, session_address,
  scope: 'readonly-question-result'})
// returns a trusted platform-issued binding, or refuses:
// {route_id, session_address, dispatch(request, {submitResult})}
```

The broker must verify exact session identity and authoritative platform/tool
restrictions before returning a capability. It receives no question text before
authorization. A returned object is an injected trust boundary, **not evidence
that this library inspected or enforced readonly**. The status deliberately says
external-broker-unverified. An application must not implement this broker as a
boolean/prompt/self-report check. Missing, timed-out or mismatched authorization
cannot call dispatch. Authorize is bounded to5s; dispatch transport acceptance
to10s. Uncertainty holds the existing task rather than creating new work.

`dispatch` must return its transport state without waiting for the result callback
to finish. `submitResult({result_text})` is an in-process capability pinned to one
task and one dispatch attempt; it accepts no task/channel/route override. Before
transport acceptance, one early result is buffered and its promise stays pending.
The promise resolves RESULT_SAVED only after durable result storage. Identical
callbacks are idempotent, conflicting or oversized results are refused. Delayed
results cause publication without another model dispatch. Failed/stale/closed
callbacks do not publish or resume a held task. This is an explicit result
channel, not transcript collection. No HTTP callback listener or shared bearer
endpoint is created.

ACK and dispatch outcomes are reduced to primitive state snapshots at their first
direct provider await, before the deadline wrapper's promise hops. Broker identity
and dispatch function are detached similarly. Later changes to a provider-owned
object cannot turn uncertainty into accepted ACK or retry permission.

The repository's lib/transport.mjs can post to an already-registered session but
does not lower its permissions or expose an authenticated task-scoped readonly
result API. It is intentionally not wired here. Public Codex sandbox/app-server
and Claude SDK/Managed Agent APIs are separate integration possibilities, not
proof about the user's existing desktop sessions. No actual authoritative broker
implementation for those existing sessions has been verified, and no session has
been resumed, created, registered or given new tools in this work.

The precise missing real interface is a platform-approved adapter that (1)
attests the selected existing session's immutable readonly scope including
external-write tools, (2) issues the limited dispatch capability, and (3) binds
the explicit result callback to that task with authenticated origin, durable
acknowledgement and restart handling. If the installed platform cannot provide
that, live existing-session integration must stay blocked. Fakes are not a
replacement for this evidence.

## Needed for actual setup

Collect once: guild/AI-channel/human-channel-list/owner/application/command IDs;
PC and exact session plus the authoritative broker/restricted callback mechanism.
Confirm the concrete bot creation/OAuth installation/credential registration/
persistent session access operations before doing them. General connection
permission already exists; target selection and readonly enforcement are still
required. Never send a bot token in chat. One route/PC first; a shared scheduler
is still required before two simultaneous session runtimes are used.

The two prior Minor findings are now fixed by failing regressions: config uses
canonical field order and sorted human-channel set, and known publication replay
latches the publisher hold. Provisional ledgers made by older source versions
are not migrated or force-unlocked by these APIs.

Official protocol references:
[Gateway lifecycle](https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway.mdx),
[interaction callback/deadline](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/receiving-and-responding.mdx),
[Codex app server](https://developers.openai.com/codex/app-server),
[Claude permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies).
They describe capabilities to investigate; no installed-session compatibility
or real account security conclusion was drawn from the documentation alone.

## Offline verification result

Final related regression: **189/189 PASS**, failures/cancellations/skips0
(original mock/core98 + offline preparation23 + adapter/host68). Compared with
the preceding154 baseline this phase adds35 checks. Syntax errors0, modules35,
locale keys94. Existing Claude reproduction remains a user-relayed98-test report;
it is not evidence that Claude reran the later91 tests.

One independent read-only review found two Important defects: missing wake for
queued/retry/restarted work, and mutable provider outcomes surviving promise hops.
Both have failing reproductions and a passing fix. ACK localization was also
fixed to comply with the repository's mandatory catalog rule. There are no
deferred findings from this review. Provider mutation regressions cover ACK,
direct dispatch and broker capability function; scheduler tests cover delayed
results, dispatch/429 retries, READY recovery, quota deadline and close.

At that earlier host-only milestone, full npm test, packaging, installation, real sockets/fetch, bot/session setup,
effective channel denial, real enforced readonly/callback recovery and token
measurement were not executed. Actual usage stays null. Logs are the isolated
workspace parent's discord-host-final-regression.log and discord-host-progress.md.

Later dedicated-worker/bounded-trial work is described in [discord-live.md](discord-live.md).
The earlier189-test result is historical, not the final publication check or a
claim that every deployment/provider boundary was certified. Private operational
IDs, workstation paths and logs are not part of the source deliverable.
