# ChatGPT Shared Workspace live-status contract

Status questions are evidence queries, not memory queries.

When the operator asks whether a Stephanos feature or repair is fixed, available, deployed, live, ready to test, or safe to use, the authorised ChatGPT participant must:

1. read GitHub for the exact PR and merge commit;
2. issue one bounded `READ_DELIVERY_STATUS` request through issue #1506's existing authenticated relay;
3. bind the request to repository, PR number, exact feature merge commit, exact deployment head, deployment request ID and feature ID;
4. keep feature merge identity separate from the deployment head: the deployment head may equal the feature merge or be a later reviewed descendant, but neither identity may be omitted, inferred from the other, or replaced by an unrelated latest head;
5. answer from the scoped delivery projection, never from the newest global workspace heartbeat;
6. report the complete matrix: GitHub merge, deployment acceptance, Battle Bridge source sync, built dist head, served browser head and feature-specific acceptance;
7. use `LIVE` only when the served exact deployment head and all required feature proofs are current and every evidence record carries the complete scoped identity tuple;
8. return `UNKNOWN`, `BLOCKED`, `STALE_OR_REGRESSED` or the exact incomplete stage when evidence is absent or stale.

For Music Tile URL/artwork delivery, live requires all three feature receipts:

- `UPDATED_MUSIC_TILE_SERVED=true`;
- `PLAYBACK_CONTINUED_AFTER_RATING=true`;
- `AUTO_URL_AND_ARTWORK_RUNTIME_PROOF=true`.

The bridge remains read-only for status queries and grants no arbitrary filesystem, command, source-mutation, merge, deployment or self-approval authority.

## Canonical commit truth

`READ_CURRENT_STATUS` is the shared source-head question for Stephanos, ChatGPT, Codex, OpenClaw and future workspace participants. It reads only the existing fixed Shared Workspace records:

- `status/battle-bridge-github-sync-current.json`
- `status/post-sync-runtime-refresh-current.json`
- `status/battle-bridge-ignition-supervisor-current.json`
- `status/battle-bridge-current.json`
- `status/battle-bridge-recovery-mesh-current.json`
- `status/battle-bridge-mailbox-receipt-index.json`
- `status/mission-orchestrator-worker-heartbeat.json`
- `codex-dispatch/surface-attachment-latest.json`

The response projects these truths separately:

- GitHub `main` observed by the canonical sync task;
- the canonical Windows checkout head;
- the exact-head-proven built UI head when a UI refresh occurred;
- the exact-head-proven served runtime head.

Matching head strings alone are insufficient. Evidence older than its surface-specific freshness window is `STALE`; a newer unrelated runtime record cannot refresh an old sync observation. Missing sync evidence is blocked, source drift is `WINDOWS_CHECKOUT_NOT_AT_GITHUB_MAIN`, missing built proof is `BUILT_RUNTIME_HEAD_UNPROVEN`, and absent or mismatched served proof is `SERVED_RUNTIME_NOT_AT_WINDOWS_HEAD`. A stale or missing response must never be described as current or live.

The same projection exposes the updater observation separately as `HEALTHY`, `RUNNING_BLOCKED`, `STALE_OR_NOT_RUNNING`, or `UNPROVEN`, including its last observed timestamp and expected 15-minute interval. This distinguishes a watcher that is alive but safely blocked from one that has silently stopped producing evidence.

The response also contains `windowsProofCoverage`. Each of source, built runtime, served runtime, UI 4173, backend 8787, OpenClaw 18789, Shared Workspace, Recovery Mesh, GitHub Command Mailbox, Mission Worker and the Windows execution surface is independently labelled `PROVEN`, `BLOCKED`, `STALE` or `UNPROVEN`, with its original observation timestamp and age. The aggregate may report `WINDOWS_PROOF_COVERAGE_COMPLETE` only when every required surface is currently proven. Regenerating the response never changes an evidence source timestamp.

Authorised chats obtain read-only Windows diagnostics through the existing #1507 `RUN_BATTLE_BRIDGE_DIAGNOSTICS` mailbox operation and read the correlated terminal receipt. Stephan is not a PowerShell, screenshot or copy/paste courier. A dormant mailbox is itself a typed control-plane blocker; it is not an instruction to ask the operator to relay the proof manually.

## Stephanos as the conversation surface

The Shared Workspace remains the one canonical conversation substrate. Participants address bounded messages to `stephanos`; Stephanos projects current status, proof, blockers and responses from those records. This contract does not create another mailbox, workspace, status database, execution authority or unrestricted chat transport. It makes the existing participant and relay paths converge on one evidence-backed Stephanos conversation.
