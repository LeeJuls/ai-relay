# Usage guide

[English](../README.md) · [한국어](../README.ko.md) · [日本語](../README.ja.md)

## From Git

Install Git, then run `git clone https://github.com/LeeJuls/ai-relay.git`, enter `ai-relay`, and run `relay.cmd help`. The launcher reuses installed Node.js 24.14.0 or later in the 24.x series. If unavailable, it downloads the pinned 24.14.0 executable from nodejs.org, checks SHA256 before execution, and stores it in the checkout's ignored `runtime/` folder. The first download needs internet; subsequent runs reuse it. No administrator rights, PATH change or npm install is required. Failed or mismatched downloads are not executed. A corrupt existing runtime is preserved and rejected; inspect it before manually removing it and trying again.

Continue below with address pairing and own-chat registration. The optional `install`/`uninstall` commands are for packaged ZIP copies. Claude Desktop uses its Code tab (Claude Code). The launcher uses Windows PowerShell with a process-only execution-policy flag; it does not persist a policy change or override Group Policy restrictions.

## From ZIP

Extract the verified Windows x64 ZIP. Its pinned Node runtime is included; no administrator rights, global npm installation, app login change or PowerShell policy change is needed. From the extracted directory:

```powershell
.\relay.cmd help
# Optional per-user copy; refuses an existing destination:
.\relay.cmd install
$dataRoot = Join-Path $env:LOCALAPPDATA 'AiRelayPreview/data'
.\relay.cmd pair --root $dataRoot --codex codex-demo --claude claude-demo
```

Ask each receiving conversation to launch its helper with its own execution tool:

```text
Run <extracted-package>/relay.cmd start --root <absolute-data-directory> --as codex-demo
from this Codex conversation. In the Claude Code receiver use --as claude-demo instead.
Preserve the application's permission controls; ask the owner if its own execution tool needs permission.
Do not copy a token or read another conversation's process environment.
```

Launching in an unrelated terminal cannot register the intended conversation. Credentials/endpoints stay in the receiving child process's memory. Codex uses an experimental private desktop pipe, with no official compatibility guarantee. Claude Code must have its own-session messaging feature available. See [support](../SUPPORT.md).

```powershell
'Review this plan?' | Set-Content -LiteralPath question.txt -Encoding utf8
.\relay.cmd send --root $dataRoot --as codex-demo --body-file question.txt --wake
.\relay.cmd reply --root $dataRoot --as claude-demo --id <original-full-id> --body-file answer.txt
.\relay.cmd done --root $dataRoot --as codex-demo --id <answer-full-id>
.\relay.cmd inbox --root $dataRoot --as codex-demo
.\relay.cmd status --root $dataRoot --as codex-demo
.\relay.cmd doctor --root $dataRoot --as codex-demo
.\relay.cmd dashboard --root $dataRoot --lang ko
```

Open the dashboard's returned loopback URL. It displays only receiver state and counts, never bodies/credentials. It is read-only. Doctor checks local registration requirements without waking a model. A live PID or registration is not proof that an app accepted a message.

## Delivery and usage

- Questions and --wake flush ready messages immediately. Ordinary fyi/result/answer messages batch up to 120 seconds. Replies to urgent questions inherit wake; other answers do not. Receiver --batch-ms 0 disables batching.
- Each delivered group has explicit `[peer <address> #<full-id> not-owner]` origin tags. Peer text is never an owner instruction, consent or permission grant. Provider inbound/approval controls remain in force.
- Saved is local storage. Accepted is transport acceptance, not proof of model receipt/read/answer. For Claude, a clean socket write/close is recorded as SOCKET_WRITE_ACCEPTED, not a confirmed inbound-policy decision.
- Claims are flushed before any post. Only proven not_sent retries, at most three attempts. Post-write failures and leftover claims on restart hold the original IDs. No blind resend or exactly-once model-effects claim.
- Accepted inline posts archive automatically; --keep-pending opts out. Posted is not processed. A first reply to an automatically archived original still works. Explicit manual done remains final. Done archives without generating an acknowledgement. One reply per original; reply-to-reply is blocked. Use a new substantive question for further work. Per receiver instance, at most six posts/minute; excess is held to avoid runaway waking.
- Body storage limit: 1 MiB UTF-8. Delivery group limit including tags: 200,000 bytes. Oversized mail is retained/held. Sort order is timestamp then full ID, not a cross-app global arrival-order guarantee.

## Stop, restart, remove

```powershell
.\relay.cmd stop --root $dataRoot --as codex-demo
.\relay.cmd stop --root $dataRoot --as claude-demo
# Only after inspecting a dead receiver's retained lock:
.\relay.cmd recover --root $dataRoot --as codex-demo
```

Stop addresses one exact running generation; it never kills all Node/app processes. Recover first releases a retained global writer lock only when its recorded PID is definitively absent, then handles the selected receiver lock. It refuses live or malformed ownership and preserves all mail and delivery claims. Concurrent recovery blocks new writers until it finishes. If an interrupted recovery leaves `.writer-recovery.lock`, stop all processes using that data root and inspect the gate before manually reconciling it; never delete a gate owned by a live or uncertain process. App restarts require new registration from the reopened receiving conversation. Unknown/uncertain IDs stay held across re-registration. The status dashboard stops with Ctrl+C.

After stopping the installed helpers/dashboard, use the preserved external portable copy to run `relay.cmd uninstall --dir <installed-directory>`. Windows cannot remove the installed runtime while that same executable runs the uninstaller; removal from inside the target is refused. Removal verifies the installation marker, file hashes and absence of unknown files; changed installations are refused for manual inspection. Message data outside the install directory is always retained.

## Data and trust boundary

Core commands require an explicit absolute local data root (never a drive root) and --as bound address. Pairs are reciprocal; non-peer destinations and payload sender overrides are rejected. Internal symlinks/junctions are refused. Local --as is routing binding, not OS authentication: other programs with this user's data-folder access can tamper with files. Use a private, local user-data directory; cloud/network shares are unsupported.

The install location defaults to the current user's LocalAppData. It is distinct from the mail root. Auto-start, unattended credential discovery, app-policy changes, cloud relays and /review model execution are not part of this preview.

JSON stdout; stable localized error codes on stderr, exit 2. --lang en|ko changes human help/errors. Native file watches and a one-second missed-event/batch-deadline rescan make no AI calls. This is not an AI timer or a five-minute polling conversation.

## Development and release

Development commands run from the source checkout. The portable ZIP includes runtime code and its isolated self-test, not the source test suite or release builder.

```powershell
npm.cmd test
npm.cmd run check
npm.cmd pack --dry-run --json --ignore-scripts
node scripts/build-preview.mjs <absolute-output-directory> <official-Node-24.14.0-x64-node.exe>
```

Runtime code is newly implemented with Node built-ins only. The ZIP builder pins the official Node binary/license hashes and excludes tests, personal mail/config/logs, app credentials, character assets and old helper code. Build twice into different empty output directories to verify reproducibility. The owner selected MIT for this tool; this tool is published at https://github.com/LeeJuls/ai-relay. Source updates and release uploads require the owner’s authorization. Research workspaces and their Git histories are excluded.

API: registerPair, createClient (send/reply/inbox/done), createAdapter, openReceiver, deliveryStatus. Stable send --id returns an identical saved message on retries, even after archival; changed content conflicts. Partial reply-save/archive failure can be explicitly retried without another answer.

## Fewer turns and shared resources

See [token efficiency, slot actions, send-only and local measurements](token-efficiency.md). `start --probe-ms 30000` detects a missing session socket without model calls; 0 disables probes. Sender defaults and existing JSON envelopes/IDs are unchanged. A send-only refusal is final; do not retype or reroute the request.
