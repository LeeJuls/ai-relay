# Source provenance and distribution status

This directory contains a new implementation authored for the owner's local relay project. It does not copy or import the previous Claude relay, Codex helper, app binaries, or third-party dependencies. Design inputs were the owner's approved message contracts and recorded failure lessons: explicit roots, configured peers, durable publication, bounded Windows rename retries, and preserved reply IDs.

No license grant for the previous repositories was established by their source inventory. No code from those sources is included in this package. This statement records implementation provenance, not a legal determination about all future redistribution rights.

On 2026-10-09 the owner authorized free reuse with attribution. This tool's own implementation and documentation are licensed under MIT, copyright 2026 LeeJuls; see LICENSE. The license applies to this directory's own work, not the enclosing research repository, character assets, old private helpers, or third-party components.

The package retains `private: true` to prevent accidental npm publication while preview testing continues. This publication guard does not restrict the MIT reuse grant. On 2026-10-09 the owner also authorized publication of this tool alone in https://github.com/LeeJuls/ai-relay. The private research repository and its history are not included.

Dependencies: Node standard library only. Personal configuration, real mailbox contents, logs, session identifiers, tokens, and character assets are excluded by the package allowlist. New adapters implement the required framing independently; no old helper source is imported or shipped. Node runtime redistribution retains the complete upstream license notices in third-party/NODE-LICENSE.txt. The official Node 24.14.0 executable hash is pinned in the preview builder.

## 2026-10-13 behavior port

The owner selected ai-relay as the public product. Behavior requirements were supplied by the owner's private relay handover; source commits 03f17eb (following 5aa82a3/9b4e574) and prior cf64586/3772db5 were reviewed as references. New delivery, resource slots, metrics and token guidance are independent implementations using this product's storage, peer bindings and standard-library modules. No private relay code, runtime import, local path, live mail, token or transcript is distributed. Optional private vault and compact/review executors were not included.
