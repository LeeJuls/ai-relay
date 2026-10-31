# Confirmed bot identities

The owner confirmed these display names for the person/AI separation direction:

| Planned identity | Status |
| --- | --- |
| `준영-claude` | Intended Claude bot name; the existing tested bot still has its previous Discord display name. No rename was executed. |
| `준영-codex` | Intended separate Codex bot; no second bot or credential was created, and Codex is not connected. |

The direction is separate identities per person and AI, rather than representing
both providers with one shared identity. The current implementation and controlled
trial still use one bot and one dedicated Claude worker. This naming decision
does not authorize additional installation, permissions, credentials or startup.
No multi-bot routing feature is introduced in this commit.

Keep actual application/guild/channel/owner IDs in the ignored local config,
not in source, examples, screenshots or public operational logs. Continue using
the existing configured identity until a separately authorized Discord rename
or second-bot setup occurs. See [bounded live experiment](discord-live.md).
