# Goal #1290: Shared Workspace Proof Index V1 (source-only)

## Why
Shared Workspace already stores proof and receipt records and its existing dashboard feed exposes structured records. This does not establish independent trust, current exact-head GitHub review, protected merge, or Windows custody. A single green CI pulse must never be interpreted as the later execution gates.

## What this slice adds
- A deterministic bounded read-only exact goal/PR/head filter over existing validated Shared Workspace proof/receipt metadata, with no independent store, credential, signer, queue, publisher, worker, controller or mutation plane.
- GET /api/shared-workspace/proof-index: bounded safe metadata for existing authorised backend clients, using the current workspace resolver and feed reader. No raw file/ref/path/secret contents; no-store, invalid filter and missing root handled.
- Agents Tile / Shared Workspace surface: compact cards with goal, PR, stage, reported status, source SHA, age, first missing trust gate and allowlisted GitHub link. Records remain **UNVERIFIED** even if they report PASS.

Original records remain immutable. Historical record deduplication considers source SHA, attempt, stage and reported outcome, preserving distinct lineage and superseded entries. Only fixed GitHub URL shapes are created from vetted numeric IDs; caller-provided URLs and local paths are never returned.

## Scope and acceptance
Pure source projector tests cover untrusted metadata, unknown classes, failed/stale/superseded states, invalid filters, source-head movement, malicious URL/paths, duplicate attempts, missing backend and no-authority invariants. Backend endpoint tests must verify no-store, invalid filters, missing root and bounded safe JSON. Source acceptance does not establish live Battle Bridge installation, independent exact-head security proof, real cross-device browser availability or a valid Windows custody witness.

Later existing-owner stages: bind authentic reviewed GitHub run/artifact receipts to exact head/base through an independent verifier; separately bind private native Windows attestation; repair #1506 ten-minute relay pickup without allowing expired requests; prove served PC/iPad UI over existing secure bridge. Continue original #2315 mailbox cutover and #1574 specialist reviewer qualification independently. The proof index will not self-qualify any such stage.
