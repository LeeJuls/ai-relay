# Offline assignment contracts and preparation report

These source-only helpers add no live transport. No tokens, credentials, account lookup, session discovery, sockets, model calls or persistent access are used. Existing bridge/ledger behavior remains unchanged.

`planAssignment(snapshot, routes, nowMs)` in `tools/discord-mock/connection-contract.mjs` consumes exactly `{mode:'offline',agent:'claude'|'codex',event:MockEvent}`. The event is the normalized fixture contract from discord-mock.md, not raw Discord interaction or Gateway JSON. Credentials, endpoints, extra actions and inferred/default targets are refused. Every allowed human assignment must explicitly select an installed alias in the supplied route map.

Routes are one or two named `MockConfig` values with explicit own route_id and session_address fields; missing targets are never filled from defaults. Distinct route IDs and session addresses share the same PC, guild, channel, owner, command and limits. A route mismatch fails closed. Output is a draft containing a copied event and a pinned session request, with no dispatcher or publisher. Passing the draft config/event to the existing mock bridge exercises only the selected fake session. Planning two aliases does not implement a shared runtime scheduler, register either real session or automatically send one agent's output to the other. Event timestamps must be primitive strings; attachment/mention arrays must be empty data arrays without extra fields or getters.

`inspectOfflineSetup(input)` in `tools/discord-mock/preflight.mjs` consumes exactly:

```json
{
  "mode": "offline",
  "server_id": null,
  "ai_channel_id": null,
  "human_channel_ids": [],
  "owner_id": null,
  "pc_label": null,
  "session_labels": {},
  "readonly_plan": {}
}
```

Fill labels/readonly_plan only for the explicitly chosen `claude` and/or `codex` alias. Readonly plans are bounded operator notes, not authority. IDs are only checked for presence, string size and logical collisions; no real server, channel or identity is checked. Human channels must form a dense plain data array without custom methods/getters/extra fields; they cannot duplicate or overlap the AI channel. Do not put credentials in any field, even text notes. These data-shape checks are not an isolation boundary against hostile JavaScript proxies or global-runtime tampering; the helpers are for trusted local offline fixtures and future token-free normalized snapshots.

The report contains missing field names, fixed unverified checks and separate required approvals. It never echoes IDs/labels/notes. **live_ready is always false**, even if input_complete is true. No `verified`, token, approval-grant or endpoint fields are accepted. The function cannot attest actual enforced readonly, effective channel permissions, identity ownership or actual delivery. A prompt-only restriction or auto-permission session is not proof of readonly.

Run the contract/preflight checks with installed Node 24.14.0, without npm install:

```powershell
node --test test/discord-mock-contract.test.mjs test/discord-mock-preflight.test.mjs
```

The two integration cases use new private temporary roots and the existing fake session/publisher. They show that explicit Claude or Codex selection produces one matching fake dispatch and one explicit result publish, with no automatic follow-up. They are not live agent conversations.

Combined related regression (the junction-path tests may need execution permission):

```powershell
node --test test/discord-mock-policy.test.mjs test/discord-mock-store.test.mjs test/discord-mock-bridge.test.mjs test/discord-mock-scenario.test.mjs test/discord-mock-contract.test.mjs test/discord-mock-preflight.test.mjs test/core.test.mjs test/storage.test.mjs test/reply.test.mjs test/receiver.test.mjs
node scripts/check.mjs
```

Full npm test, portable installation/packaging, local-server/socket tests and all actual Discord/AI activity remain outside this scope. Actual tokens are unmeasured. A future live stage needs user-selected IDs and sessions, actual enforcement/limited output evidence, and explicit approval for bot creation, OAuth install, credential configuration, persistent session registration, live adapter execution and test sending. There is no live enable action in these helpers.
