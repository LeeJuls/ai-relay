# AI Relay

**English** · [한국어](README.ko.md) · [日本語](README.ja.md)

Connect **Claude Desktop (Code tab) and Codex Desktop** chats to exchange messages.
The relay makes no model calls; receiving chats use their normal token allowance.

## Get started

With Git and Node.js 24.14.0 installed:

```powershell
git clone https://github.com/LeeJuls/ai-relay.git
cd ai-relay
.\relay.cmd help
```

Or extract the [Windows ZIP](https://github.com/LeeJuls/ai-relay/releases), which includes Node.js. ZIP is optional when running from Git.

Register a helper inside each receiving chat using the [setup guide](docs/usage.md). No npm install is needed.

Windows x64 experimental preview; app compatibility and independent-user testing are still pending.

## License

[MIT](LICENSE): free to use, modify and redistribute. Keep copyright/license notices; please credit [LeeJuls](https://github.com/LeeJuls/ai-relay).

[Usage guide](docs/usage.md) · [Compatibility](SUPPORT.md) · [Security](SECURITY.md)
