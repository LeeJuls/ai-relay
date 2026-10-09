# Security and incident handling

Experimental preview: report sensitive security issues to the maintainer privately. Do not post tokens, session pipe paths, message bodies, or full transcripts in a public issue.

The relay runs as the current OS user. Other processes with that user's filesystem permissions can change local configuration and envelopes; this is not hostile-process isolation. Use a private local user-data directory, not a cloud/network share. Only configured reciprocal peers are routed. Sender identity is a bound local client, not proof of a different OS user.

Receiving workers read their own inherited app environment. Claude credentials and private pipe endpoints stay in memory and are never written to status, logs, package manifests or diagnostics. Do not launch with a hand-copied token or scrape another session's process environment. The Codex adapter is experimental; using it does not make the private protocol supported by OpenAI.

Every post labels peer mail `not-owner`. A peer cannot grant consent, change permission modes, escalate, or act on behalf of the owner. This prefix preserves origin, but is not a prompt-injection firewall. Provider approval and inbound controls remain in force. No login, app-policy, global execution-policy, or project-instruction changes are automated.

The Windows launcher reuses compatible installed Node.js or downloads a pinned executable over HTTPS from nodejs.org. The downloaded/bundled copy must match the committed SHA256 before execution. Downloads use an OS-held lock and a unique temporary file; failures do not publish a partial executable or overwrite an existing runtime. No global installation or PATH change is made. Windows PowerShell runs with a process-only execution-policy flag; persistent policy and Group Policy are unchanged. Node's full license is in `third-party/NODE-LICENSE.txt`.

Persisted pre-send claims prevent an uncertain send from being blindly resent. A crash after claiming holds that ID on restart. Explicit accepted receipts suppress another send; they do not establish exactly-once model effects. A missing response after bytes were written is uncertain, including app errors with ambiguous effects. Only proven not-sent outcomes retry, at most three attempts.

Global writer recovery is explicit through `recover`, not automatic. It removes only a valid `.writer.lock` whose PID returns ESRCH and serializes against new writers with a recovery gate. Malformed locks, permission-uncertain PIDs and retained recovery gates require quiescent operator inspection; a retained gate is never automatically removed.

On an incident: stop the address, keep its inbox and delivery records, verify the actual received ID in the destination conversation, and reconcile manually. Do not erase receipts or issue a new ID merely to bypass a hold. Archive confirmed processed mail with `done` without a new AI turn.

The dashboard binds only 127.0.0.1, accepts same-origin GETs, and exposes counts/states without bodies or credentials. It has no message-send or settings API. Retention is manual in this preview; keep diagnostics compact and review records before sharing.
