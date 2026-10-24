# AI Relay

**English** · [한국어](README.ko.md) · [日本語](README.ja.md)

Connect **Claude Desktop (Code tab) and Codex Desktop** chats to exchange messages.
Ordinary relay makes no model calls. Optional independent reviews use your signed-in CLI subscription; no API key is required.

## Latest update

**0.1.0-preview.3 · 2026-10-25** — [independent review and focused followup](docs/independent-review.md), with saved results and duplicate-run protection. Existing mail still works. [Changes](CHANGELOG.md). Git version; ZIP releases are separate.

| Before | Now (opt-in) |
|---|---|
| Review wakes a long working chat | Review starts with just the request and designated evidence |
| Re-review needs earlier context | Followup carries only the previous conclusion, evidence and next action |
| App acceptance does not prove completion | Review result and linked reply have separate durable status |

Reviews still use tokens; faster replies or fixed savings are not guaranteed.

## Get started

With Git installed:

```powershell
git clone https://github.com/LeeJuls/ai-relay.git
cd ai-relay
.\relay.cmd help
```

`relay.cmd` uses compatible Node.js if available; otherwise it downloads a verified copy on first run. No system installation is needed. The [Windows ZIP](https://github.com/LeeJuls/ai-relay/releases) includes Node.js for offline use.

Register a helper inside each receiving chat using the [setup guide](docs/usage.md). No npm install is needed.

Windows x64 experimental preview; app compatibility and independent-user testing are still pending.

## License

[MIT](LICENSE): free to use, modify and redistribute. Keep copyright/license notices; please credit [LeeJuls](https://github.com/LeeJuls/ai-relay).

[Usage guide](docs/usage.md) · [Fewer turns & resource slots](docs/token-efficiency.md) · [Compatibility](SUPPORT.md) · [Security](SECURITY.md)
