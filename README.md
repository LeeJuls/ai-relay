# AI Relay

**English** · [한국어](README.ko.md) · [日本語](README.ja.md)

Connect **Claude Desktop (Code tab) and Codex Desktop** chats to exchange messages.
The relay makes no model calls; receiving chats use their normal token allowance.

## Latest update

**0.1.0-preview.2 · 2026-10-13** — batched delivery and automatic filing, shared-resource slots, session health checks, and local turn-cost reports. [Changes](CHANGELOG.md). This is the Git version; ZIP releases are published separately.

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
