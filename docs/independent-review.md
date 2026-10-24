# Independent review

**English** · [한국어](independent-review.ko.md) · [日本語](independent-review.ja.md)

Normal mail still goes to the paired working chat. `send --mode review` instead runs one fresh, read-only CLI review without waking that receiving chat. Its linked `result` returns through normal mail, so the requester may still start a chat turn. This is useful for small, self-contained questions, not work needing the full conversation.

## Enable once per receiving address

Install the provider's CLI separately and sign in with your ChatGPT or Claude subscription. The relay does not install a CLI, change login or use an API-key fallback. Use a current native executable (`.exe` on Windows, not `.ps1`/`.cmd`). Older CLIs without the required flags fail closed. Subscription limits still apply.

Create a UTF-8 `review.json`, replacing the example paths and model with your own. The model must be available on your account; there is no automatic substitution.

```json
{
  "cli": "C:/Tools/provider/cli.exe",
  "model": "YOUR-AVAILABLE-MODEL",
  "jobRoot": "C:/relay-review-jobs",
  "evidenceDirs": ["C:/review-evidence"],
  "deadlineMs": 180000
}
```

`jobRoot` must be outside projects and their AGENTS.md/CLAUDE.md/.git ancestors. Use at most eight specific evidence directories, separate from mail data and review jobs; avoid credentials and broad home folders. User-level mandatory instructions may still apply. The designated scope is an instruction to the reviewer, **not an OS-enforced read allowlist**. Do not submit untrusted secrets; the provider's own read-only controls remain the security boundary.

```powershell
.\relay.cmd review-config --root C:\relay-data --as claude-demo --config-file review.json
# Run in that receiving conversation, as with normal mail:
.\relay.cmd start --root C:\relay-data --as claude-demo
.\relay.cmd send --root C:\relay-data --as codex-demo --mode review --task R1 --body-file question.txt --wake
```

Enable `codex-demo` separately to review in the opposite direction, using its own Codex executable/model. An already-running helper must be stopped and re-registered from its receiving chat after upgrading the program. No other installation or private helper is automatically changed.

## Follow up and inspect

```powershell
.\relay.cmd send --root C:\relay-data --as codex-demo --mode followup --previous <original-review-full-id> --task R1 --body-file followup.txt --wake
.\relay.cmd review-status --root C:\relay-data --as claude-demo
.\relay.cmd review-config --root C:\relay-data --as claude-demo --off
```

Followup must use the same pair/task and the full ID of the previous **request**, not its answer. It carries only conclusion, evidence and nextAction, capped at 6,000 serialized characters with an explicit truncation marker. No session resume or conversation dump. Requests are capped at 64 KiB UTF-8; results are validated and bounded.

## Reliability and costs

- The execution claim binds the full request content, data root, receiver and ID. A partial or uncertain run is held, never automatically repeated. `running` with a dead owner appears as held in `review-status`; a live PID is not proof of progress.
- A saved result can finish its reply after restart without another model call. A publication claim without a matching exact reply is held. A saved exact reply reconciles after archive movement. No claim of exactly-once external model effects is made.
- Process/auth/timeout/output failures normally produce one linked blocked result. A crash or storage/publication failure can leave a hold instead: inspect `review-status`, the job directory and logs before recovery. No automatic replay or bulk completion.
- `replied` proves a linked reply file was saved and the original archived; it does not prove the requesting chat received or acted on it. Ordinary `accepted` remains transport evidence only. Reviews are excluded from ordinary delivery counts and shown separately as `reviewPending`.
- One review per address runs at a time, outside the ordinary delivery queue. Stopping waits for the active bounded run; queued reviews stay pending. Timeout requests process-tree termination but does not certify termination. Disabled reviews stay pending and never fall back to a working-chat post.
- Ordinary delivery still makes no model calls. Opt-in reviews use the signed-in provider CLI, save local usage and elapsed time, and consume subscription allowance. API/provider environment overrides are refused; do not bypass that refusal. No extra API bill is requested by this feature. No guaranteed speed, quota or token savings; compare complete tasks, cached/uncached input and output.

Local job folders contain prompts, logs, result and usage; protect them like project data and remove them manually when no longer needed. There is no automatic history deletion. The public tests use isolated fixtures; provider/app versions and external-user deployment remain experimental.

The address-wide execution claim is `reviews/<address>/execution.json` under your data root. `review-status` includes an `execution` entry, even if a crash preceded the per-ID record. Unconfirmed child termination retains this claim and blocks subsequent reviews, including after restart; normal mail continues. After stopping the receiver, the owner must inspect the job and prove its processes ended before manually clearing that claim. Do not remove it based on age or a failed parent PID check alone. Successfully saved results/replies reconcile and clear their matching safe claim automatically.

Official CLI background: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Claude CLI reference](https://code.claude.com/docs/en/cli-reference). No external API SDK dependency is added.
