# Compatibility and evidence boundary

| Component | Implementation / observed evidence | Limit |
| --- | --- | --- |
| Windows x64 / Node 24.14.0 | Local source tests, isolated child processes, fixed-runtime package verification | Independent account/PC acceptance pending |
| Codex Desktop | Experimental private framed pipe; new adapter read-only list_artifacts probe on the current host succeeded without starting a model | No official stable desktop integration API promised; new-product live round trip pending |
| Claude Desktop (Code tab) / Claude Code | Own-session messaging socket adapter; local native socket protocol tests | Requires messaging available in the receiving session; new-product live round trip pending |
| Prior internal tools | Actual two-way, busy/idle, supervised app-restart observations informed the design | These are not new-product acceptance results |
| macOS / Linux / WSL / remote hosts | Some portable core tests are suitable for CI | No packaged support claim |

Claude Code documentation lists native Windows messaging support from 2.1.234 and distinguishes delivered/held/refused under the receiver's own inbound controls. The installed feasibility samples used Claude Code 2.1.295 and Codex CLI 0.144.5; CLI versions alone do not identify desktop-pipe compatibility. [Official messaging documentation](https://code.claude.com/docs/en/cross-session-messaging)

Each receiver must be started by its own conversation's child process. App restart may invalidate that environment; stop, inspect, and re-register in the reopened receiving conversation. No unattended session discovery or credential scraping is implemented.

`start` proves a receiver registered and began watching files, not a live authenticated app connection. `doctor` intentionally does not start model turns. The dashboard's process/queue state is not a delivery receipt from a model.

Only app transport acceptance is recorded automatically. Inbound policy may hold or refuse mail even after a socket write completes. Confirm actual receipt and reply for each new app version before using it for production work.
