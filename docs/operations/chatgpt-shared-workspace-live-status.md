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

The response projects these truths separately:

- GitHub `main` observed by the canonical sync task;
- the canonical Windows checkout head;
- the exact-head-proven built UI head when a UI refresh occurred;
- the exact-head-proven served runtime head.

Matching head strings alone are insufficient. Evidence older than 35 minutes is `STALE`, missing sync evidence is blocked, source drift is `WINDOWS_CHECKOUT_NOT_AT_GITHUB_MAIN`, and served drift is `SERVED_RUNTIME_NOT_AT_WINDOWS_HEAD`. A stale or missing response must never be described as current or live.

The same projection exposes the updater observation separately as `HEALTHY`, `RUNNING_BLOCKED`, `STALE_OR_NOT_RUNNING`, or `UNPROVEN`, including its last observed timestamp and expected 15-minute interval. This distinguishes a watcher that is alive but safely blocked from one that has silently stopped producing evidence.

## Stephanos as the conversation surface

The Shared Workspace remains the one canonical conversation substrate. Participants address bounded messages to `stephanos`; Stephanos projects current status, proof, blockers and responses from those records. This contract does not create another mailbox, workspace, status database, execution authority or unrestricted chat transport. It makes the existing participant and relay paths converge on one evidence-backed Stephanos conversation.
