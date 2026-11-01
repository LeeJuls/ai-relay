# One-shot bot identity and channel-permission diagnostic

Explicit entry point: `node tools/discord-summary/verify-bots.mjs --verify`.
Run only after the owner confirms both credential files are ready. No scheduler,
Gateway, model invocation or message endpoint is involved. Two bots run sequentially;
each has an independent result, so one failure does not suppress the other check.
Either failure or unsafe permissions makes the overall exit status nonzero. No automatic retry.

Credentials remain in the checkout root: existing `.env.discord.local` for Claude,
and separate `.env.discord.codex.local` for Codex. Each contains one
`DISCORD_BOT_TOKEN=` assignment. These files match `.env.*` in Git ignore rules;
they are plain text, not encrypted. Do not put their contents in chat, logs or Git.
The program loads each file directly; it does not copy credentials or persist them.

The pinned guild, AI channel and human channel are the owner-approved targets in
the ignored operator configuration. Per bot, the only four requests are official Discord API v10 GETs:
`/users/@me`, `/guilds/{guild}`, `/guilds/{guild}/members/{bot}`,
`/guilds/{guild}/channels`. No history fetch, POST or permission mutation is allowed.
Each request has a ten-second deadline, rejects redirects and caps the body at 1 MiB.
Raw server bodies/errors and Authorization headers never leave the diagnostic.
Safe failures expose only an allowlisted category and request stage, HTTP status,
numeric Discord error code, or known network error code. Credential file failures
distinguish missing file, read denial, missing key, empty value and invalid format.
Raw exception text and arbitrary error metadata are discarded.

The result contains fixed identifiers, permission booleans and counts only. It
checks actual bot identity, guild/member linkage, role inheritance, administrator
bypass, and channel overwrites in Discord order. The required human channel must
be present in the metadata. Missing/invalid data fails closed. Categories are not
counted as message/voice channels. Current child channels are checked individually.

`isolated: true` means the returned current channel metadata allows AI view/send
and denies viewing other child channels, with no administrator bypass. It does
not prove message delivery, future channel isolation, absence of other inherited
permissions, or thread coverage. `ai.history` explicitly reports inherited history
permission; the diagnostic never exercises it. API visibility rules can change or
omit channels; missing required human-channel metadata blocks this check instead
of being treated as proof of isolation. No live POST follows a diagnostic result:
final summary bodies and their hashes require separate owner approval.

## Linked-checkout layout

Use the isolated Discord linked checkout for this experiment, keeping the main
checkout and its user changes intact. Resolve paths relative to that checkout.

Bot credentials are separate files at the linked checkout root:
`.env.discord.local` (Claude) and `.env.discord.codex.local` (Codex). Both remain
ignored, plain-text local files and are loaded by relative URL. No credential copy
is needed. The diagnostic command is unchanged; run it from the linked checkout only
when another authentication check is required and authorized.

`runtimePaths('claude' | 'codex')` in `tools/discord-adapter/paths.mjs` binds worker,
relay-ledger and reserved summary-ledger paths beneath `runtime/bots/{provider}/`.
The existing Claude relay ledger was moved intact; no claims were reset or cleared.
The legacy Claude live entry point uses that preserved location. Codex paths are
reserved only: no Codex input worker or runtime was enabled by this move.
The summary batch store still requires its explicitly supplied, shared batch root;
reserved per-provider paths do not authorize recreating an existing batch ledger,
bypassing its provider quotas, or splitting one batch into fresh trials.

No runtime or API call is necessary to validate the filesystem move. Check Git
worktree linkage, ignored paths, file manifests, syntax and offline tests instead.

## Final-body review and explicit two-post entry point

Prepared preview files live in ignored `runtime/summary-review/`: `pending.json`,
`claude-final.txt`, and `codex-final.txt`. Text files have LF separators and no
trailing newline. Owner approval must name the SHA-256 of the exact UTF-8 text;
timestamps and provenance labels are already inside that text. The policy's
`content_digest` is a separate SHA-256 of its JSON-encoded canonical string. Do not
confuse the raw-text approval hash with that internal identifier.

`tools/discord-summary/publish-approved.mjs --publish` is an explicitly approved action,
not a preview command. It requires a separately created, unexpired
`runtime/summary-review/approved.json` containing bindings, summaries,
expectedManifest and the two `body_sha256` values. Create that artifact only after
the owner approves both exact final bodies and live posting. The manifest must
use the existing fixed trial/source/bot/guild/channel bindings and the policy's
15-minute maximum approval window. The program does not generate owner approval.

The shared durable publication root is fixed at `runtime/summary-sharing`.
Do not erase it, choose another root or change trial IDs to bypass a hold. Before
posting, each provider's credential is privately pinned across a four-GET identity
and permission diagnosis and the guarded client's identity GET and one POST.
A successful two-post run therefore uses ten GETs and two POSTs, no Gateway,
message-history fetch, model invocation or retry. Permission failure prevents all
POSTs. The posting window is at most three minutes, also bounded by approval expiry.
No credential is loaded before final-body and manifest validation. The completed
local trial has two accepted receipts and a finished ledger; it cannot be replayed.
Approval files, summaries and receipts stay local and are excluded from Git.
