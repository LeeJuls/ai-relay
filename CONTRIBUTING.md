# Contribution guide

This tool's own code and documentation are MIT licensed and published as an experimental preview. Work in the source checkout; the portable ZIP intentionally omits source tests and the release builder. Do not publish the containing research workspace or its history.

Use Node 24.14.0. Run `npm test` and `npm run check`; tests use temporary roots and stub native sockets, never production mailboxes or actual AI sessions. Keep app adapters separate from storage and delivery claims. Add a regression before changing failure classification, routing, identity, or receipt recovery.

Human UI/help/error strings belong in `locales/en.json`, `locales/ko.json` and `locales/ja.json`. Machine protocol keys and peer-origin tags are stable. Runtime code must use standard Node modules only unless a dependency is explicitly reviewed. Tests/scripts must not acquire app credentials from another process.

For user-visible updates, maintain the English, Korean and Japanese changelogs together. On a source version bump, keep package.json and all three README latest-update entries aligned; distinguish Git source updates from separately published ZIP releases.

Before each owner-authorized push, record the date, user-visible changes and verification scope in all three changelogs. Mark documentation-only updates separately without implying a new runtime version or ZIP release. Describe only changes present in this public checkout; private relay changes are not public features until ported and verified here. Keep the README summary short and link to the changelog for details.

Provide failure evidence without message bodies/tokens. Distinguish source tests, mocked transports, actual conversation receipt, and external installation results. Do not count the previous internal relay's success as proof of a new adapter.

Build a Windows experimental preview with `node scripts/build-preview.mjs <absolute output directory> <official Node 24.14.0 x64 executable>`. The builder verifies pinned runtime/license hashes and uses fixed ZIP timestamps. Run it twice into different empty output directories and compare SHA256; no global npm install is needed. CI verifies source tests; local packaging and live app acceptance are separate gates.
