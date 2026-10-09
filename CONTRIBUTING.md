# Contribution guide

This tool's own code and documentation are MIT licensed. It is a development preview awaiting public repository/release decisions. Work in the source checkout; the portable ZIP intentionally omits source tests and the release builder. Do not publish the containing research workspace or its history.

Use Node 24.14.0. Run `npm test` and `npm run check`; tests use temporary roots and stub native sockets, never production mailboxes or actual AI sessions. Keep app adapters separate from storage and delivery claims. Add a regression before changing failure classification, routing, identity, or receipt recovery.

Human UI/help/error strings belong in both `locales/en.json` and `locales/ko.json`. Machine protocol keys and peer-origin tags are stable. Runtime code must use standard Node modules only unless a dependency is explicitly reviewed. Tests/scripts must not acquire app credentials from another process.

Provide failure evidence without message bodies/tokens. Distinguish source tests, mocked transports, actual conversation receipt, and external installation results. Do not count the previous internal relay's success as proof of a new adapter.

Build a Windows experimental preview with `node scripts/build-preview.mjs <absolute output directory> <official Node 24.14.0 x64 executable>`. The builder verifies pinned runtime/license hashes and uses fixed ZIP timestamps. Run it twice into different empty output directories and compare SHA256; no global npm install is needed. CI verifies source tests; local packaging and live app acceptance are separate gates.
