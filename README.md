# AI Relay

**English** · [한국어](README.ko.md) · [日本語](README.ja.md)

A small tool for passing messages between your open **Codex Desktop and Claude Code** chats.
The relay makes no model calls; receiving chats use their normal token allowance.

## Get started

1. Download and extract the [Windows ZIP](https://github.com/LeeJuls/ai-relay/releases).
2. Follow the [setup guide](docs/usage.md) to register a helper inside each receiving chat.
3. Send a question:

```powershell
'Review this plan?' | Set-Content question.txt -Encoding utf8
.\relay.cmd send --root <data-directory> --as codex-demo --body-file question.txt --wake
```

Use `.\relay.cmd help` for commands. Source users need Node.js 24.14.0.

Windows x64 experimental preview. App compatibility and independent-user testing are still pending.

## License

[MIT](LICENSE): free to use, modify and redistribute. Keep copyright/license notices; please credit [LeeJuls](https://github.com/LeeJuls/ai-relay).

[Usage guide](docs/usage.md) · [Compatibility](SUPPORT.md) · [Security](SECURITY.md)
