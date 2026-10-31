# Bounded Discord/Claude experiment

This source-only Windows experiment supports one explicitly configured bot,
guild, owner and AI channel. It is not a daemon, a ZIP release or a connection
to an existing desktop working conversation. [Bot identity decisions](discord-bot-identities.md)
are separate from actual Discord account setup.

## Local settings and credentials

Copy `tools/discord-adapter/config.example.json` to `.discord.local.json` in the
checkout root, then supply the exact approved IDs and installed native Claude
executable. Example IDs are synthetic. Both this machine-specific file and
`.env.discord.local` are Git-ignored. Do not put a token in the JSON config.
The separately approved token file uses `DISCORD_BOT_TOKEN=<raw token>` and is
plain text, not encrypted storage. No source module searches for credentials or
copies authentication from another process.

Configuration is mandatory: there are no developer-specific IDs, account paths
or fallback bots in source. `createControlRequest({config,authorization,fetchImpl})`
permits only official Discord bot-identity and that configured guild's command
endpoints. The actual harness validates the already registered exact command;
it does not register another command, overwrite command sets or widen permissions.
Default command permission0 does not automatically grant the configured owner
access: verify server-owner/admin or explicit command permissions separately.

## Prepare before announcing the next window

```text
node tools/discord-adapter/live.mjs --prepare
```

This branch is local only: no token read, model/auth/Gateway/Discord request.
It requires a stopped, resolved ledger and keeps all task/event IDs, claims,
results and dispatch quotas. It records a one-use preparation ID valid15min.
Output contains the configured slash command, `text` option and maximum2
requests/180000ms. Preparation is not Gateway READY or human authorization.
Give the owner the input instructions and coordinate timing before starting.

Only after explicit authorization and the operator's start signal:

```text
node tools/discord-adapter/live.mjs --start --trial-id <prepared UUID>
```

Start checks the ID, expiry, stopped state, terminal-only work and unchanged
task/quota checkpoint before any credential/model use. It then verifies the
dedicated worker, authenticates the configured bot and validates the existing
command. Authenticated READY atomically consumes the preparation and starts
the persisted window. Runtime admission, dispatch and publication enforce the
window and two-request cap; previous completions do not count toward a new
trial, and old events remain duplicates. Held, uncertain, queued or unfinished
work cannot be cleared by preparation. Audit history is capped32 trials; the
cap refuses new preparation rather than deleting records.

A separate timer starts on READY. At expiry, the harness blocks broker admission,
aborts pending fetches and initiates host/Gateway shutdown before draining model
children. Late callbacks cannot publish; uncertain effects are held rather than
resent. Stop remains durable. A crashed active trial closes on normal recovery;
non-recovering prepare/inspection cannot interrupt an active trial.

Use exactly one operator-controlled launcher. Initial inspection is not a
reservation: simultaneous starts could duplicate preflight model/auth calls,
although the writer-atomic READY transition admits only one trial. Do not launch
the same preparation twice or extend/restart automatically.

## Worker input, context and usage

`worker.mjs` requires an explicit approved native executable. Each request uses
a fresh print child with safe/restricted mode, empty built-in tools, wildcard
tool deny, strict empty MCP, no Chrome and no session persistence. Every result
requires actual init tools=[]/mcp_servers=[], no tool/hook event and one valid
bounded final result. This is a model tool-capability boundary, not removal of
the CLI process's OS/config/auth access or proof about managed startup helpers.

Only the explicit `text` question and fixed short-answer system instruction go
to the model. Routing IDs stay in the broker. Discord history, existing Claude
sessions, files and mail records are not retrieved or appended. Local ledger
retention is not conversation context. The worker cannot remember prior turns;
include necessary context explicitly. Same subscription authentication does not
mean the old working conversation is resumed. CLI/system overhead still exists.

The opaque broker proof binds executable, arguments and environment; a caller
boolean cannot authorize it. Final text returns through the current task's
closure, with no model-controlled channel/task override. Native stdout is parsed
in memory, stderr is not printed, and local logs allow fixed events, safe
counts and the validated command ID. Never commit these runtime outputs.
Process-tree termination is bounded; uncertainty is never reported as
confirmed cleanup.

The CLI can return input/output/cache usage. The worker extracts those fields,
but current safe logs do not persist aggregate usage; runtime reports unmeasured.
Startup capability verification is one separate model invocation per start.
Idle waiting does not poll the model. No exact token saving or subscription
quota improvement is claimed. The short-answer instruction is not a hard model
token limit.

## Evidence and remaining limits

Offline tests use synthetic IDs, fake sockets/fetch/processes and temporary
ledgers. They cover policy, ACK, replay, claims, uncertain outcomes, publication,
restart/stop, preparation, deadlines, worker output and fake-secret redaction.
One controlled owner→Discord→dedicated Claude→Discord exchange was also observed:
one ACK, one model result, one public result post, no retry, clean timed shutdown.
Deployment IDs, local paths, raw payloads and private operational logs are not
published with this source. Earlier idle windows are not counted as exchanges.

Codex is not connected: a complete enforced empty model-tool surface has not
been established. A single Claude exchange does not certify multi-agent routing,
existing desktop-session isolation, continuous operation or future channel ACLs.
Human-channel visibility must be denied through effective server permissions;
initial installation permission0 alone is insufficient. Future channels require
the same access review. No bots are installed or renamed by these source changes.
