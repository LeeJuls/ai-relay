# Output-only session summary experiment

Two selected working conversations author short summaries. The owner reviews the exact rendered messages, including provenance and authored time. `준영-claude` then `준영-codex` publish one approved message each to one pinned AI channel and stop. Publication itself calls no model and does not resume either conversation.

This is source-only experimental code, not a live deployment or a new ZIP release. Existing question/answer demos, the previous Claude roundtrip and old test counts do not establish success of this feature. Posting a Codex-authored summary is not proof of Codex input integration or a Claude↔Codex conversation.

## Offline example

Use Node 24.14.0 in the source checkout:

```powershell
node --test test/discord-summary-*.test.mjs
node tools/discord-summary/scenario.mjs --root "<absolute path to a new disposable summary folder>"
```

The example only constructs synthetic summaries and fake bot clients. It has no live mode, environment/token lookup, Gateway, session access, history query or AI invocation. It prints safe state/count metadata. Reusing its root refuses another run; do not delete an uncertain live ledger to bypass deduplication. The CLI catches failures using a fixed safe code.

## Inputs and authority

- Trusted operator bindings pin trial, owner, guild, AI channel, denied human channel and each source→provider→actual bot ID. The two bot IDs must differ. A display name is not authentication.
- Source drafts contain only slot, revision, authored timestamp and `completed/verified/unverified/next` text. They cannot supply credentials, destination, approval, history or attachments.
- Claude provenance is `user_forwarded`; the owner relays the selected conversation's summary. This is not direct or cryptographic source-session attestation. Codex provenance is `current_task_authored` for the selected implementation conversation.
- Human confirmation applies to the final text, including labels, locale, provenance and authored timestamp. That timestamp limits claims such as “bot stopped” to the observation time; publication does not refresh those facts.
- Final text is limited to 1,800 UTF-16 units and 4,096 UTF-8 bytes. Overflow, known secret/private-path patterns and Discord mention syntax cause rejection without splitting, truncating or rewriting. `allowed_mentions` remains empty. Known-pattern screening is incomplete; human review is required.
- The expected manifest must come from the trusted operator after preview. The library verifies consistency and expiry; a manifest or `approval_ref` does not itself prove human consent. Text or binding changes require fresh review. Timestamp/provenance are included before hashing, never appended afterward.

## State and transport boundaries

`policy.mjs` validates immutable snapshots; `store.mjs` owns a separate summary ledger; `publisher.mjs` owns injected bot-specific clients; `batch.mjs` coordinates one bounded sequential run. No ordinary mailbox, private pipe or question-task runtime is changed.

The ledger is bound to one immutable trial/manifest and has separate per-provider rows. Each provider can consume one durable quota. A bot/channel/final-body hash dedup key is stored independently of summary ID. Changing revision, timestamp, summary ID or batch ID cannot overwrite the existing trial. Interrupted claims and accepted/held entries remain. A different root is not an approved recovery method.

Claim is saved before identity verification or POST. Each publisher checks the client-reported identity against the trusted pinned bot ID. This is a fake interface during offline tests, not real Discord identity verification. Clients are explicitly supplied capabilities; there is no default network client or credential loader here. Each bot has its own client/outcome tracking; the shared ledger coordinates only safe per-provider state and quotas, not credentials or summary bodies.

The request is pinned to the AI channel, with one stable nonce, `enforce_nonce`, redirects disabled, bounded timeout/response size and zero automatic retries. The explicit host must wire the guarded client to an explicitly approved credential source and supported abort-aware official Node fetch. Do not connect a transport that ignores cancellation and claim it is safely stopped.

`client.mjs` now provides that guarded client boundary for an explicitly injected host: official `/users/@me` identity verification, pinned channel POST through the existing REST validator, an external abort signal, injected ten-second timer and a fixed trial deadline. It checks cancellation/deadline before and after credential acquisition and immediately before fetch. Response reads are bounded to 64KB. Only identity/receipt allowlist fields leave the client. The guarded library has no ambient fetch or credential source. The explicit
`publish-approved.mjs` host separately wires official fetch and private local loaders.

The old `discord-adapter/rest.mjs` has its own ten-second `AbortSignal.timeout` but no external cancellation argument. It remains unchanged; the summary client combines its signals and races the entire credential/fetch/body operation against cancellation. Timer setup must finish before any credential or network work is scheduled. Cancellation before POST is proven unsent using a private error provenance marker; cancellation/error after fetch is invoked stays unknown. Generic transport exceptions cannot forge a definite-unsent result. An uncertain POST consumes that client's one-use send allowance.

Each operation also pins `min(start+10000, trial deadline)` and checks it before/after awaits, so a delayed timer callback cannot permit an overdue POST or accept an overdue receipt. Identity verification and POST share the same credential captured privately within that client; a changing authorization callback cannot switch the publishing bot after identity verification. The credential is never hashed or returned and its retained reference is cleared on abort/close.

An injected fake fetch that ignores abort is used to prove prompt settlement, no second dispatch and a late receipt remaining held. This does **not** prove that an arbitrary underlying transport stopped sending or released an OS resource. The explicit live host must use a supported abort-aware fetch; abort cannot retract a request already delivered to Discord. The store therefore preserves uncertainty and does not automatically retry, even with a changed ID. The source tests are entirely synthetic and do not authenticate either bot. A
separately approved local trial posted one summary per bot and finished; that
manual live result is separate from the source-test evidence.

Receipt ID, channel and nonce must match before acceptance. Definite validation/identity/rejected 4xx failures are `not_sent`; transport throws, 5xx, malformed receipts and cancellation after a possible effect are `held`. Either failure stops the other provider. Unattempted entries are reported separately, not as definite transmission failures.

Two accepted receipts finish immediately. A stop or maximum three-minute deadline blocks new dispatch and aborts owned transport capabilities. Late callbacks cannot trigger a second publication. Startup never automatically resumes an active/interrupted trial; an operator must inspect and reconcile it. No retry/reset/recovery command is supplied. The publisher requires a one-use process-local capability issued by the store only after durable claim save. Fabricated, cloned, consumed and restart-lost capabilities cannot authorize a new POST. A new process cannot resume the interrupted claim.

## Before any live trial

Obtain the owner's forwarded Claude summary and review both exact final previews. Decide whether to reuse/rename aibot and separately authorize the second bot. Verify the actual two identities and effective AI-channel-only access, including inherited roles and denial of human/other channels. Zero installation permissions alone are insufficient.

Bot creation/rename/install/ACL changes, credential file preparation, token issuance and program authentication are distinct steps requiring their concrete approval. Secrets remain local to explicitly approved publishers and are never read into a model, argv, logs or documentation. This is not an OS isolation guarantee against the same Windows user.

Then confirm the exact destination, manifest and bounded two-post start. Live actions require the separate explicit host and owner approval. The initial
two-message trial is complete; recurring new-summary publication is not implemented. Codex tool0 input execution remains unproven and excluded. The existing Claude conversation is not accessed or resumed. No additional Claude action is needed for offline tests; the owner can later relay its four-section draft.

See [design](superpowers/specs/2026-10-31-discord-session-summary-sharing-design.md) and [implementation plan](superpowers/plans/2026-10-31-discord-session-summary-sharing.md).


See the [Korean operating guide](discord-summary-usage.ko.md) for per-session
requests, supported commands, final-body approval, and the finished-trial limit.
Private target/session bindings live in ignored `.discord.summary.local.json`,
not in source or in the approval artifact alone.
