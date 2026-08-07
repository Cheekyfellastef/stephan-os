# ChatGPT Shared Workspace live-status contract

Status questions are evidence queries, not memory queries.

When the operator asks whether a Stephanos feature or repair is fixed, available, deployed, live, ready to test, or safe to use, the authorised ChatGPT participant must:

1. read GitHub for the exact PR and merge commit;
2. issue one bounded \`READ_DELIVERY_STATUS\` request through issue #1506's existing authenticated relay;
3. bind the request to repository, PR number, exact merge commit, deployment request ID and feature ID;
4. answer from the scoped delivery projection, never from the newest global workspace heartbeat;
5. report the complete matrix: GitHub merge, deployment acceptance, Battle Bridge source sync, built dist head, served browser head and feature-specific acceptance;
6. use \`LIVE\` only when the served exact head and all required feature proofs are current;
7. return \`UNKNOWN\`, \`BLOCKED\`, \`STALE_OR_REGRESSED\` or the exact incomplete stage when evidence is absent or stale.

For Music Tile URL/artwork delivery, live requires all three feature receipts:

- \`UPDATED_MUSIC_TILE_SERVED=true\`;
- \`PLAYBACK_CONTINUED_AFTER_RATING=true\`;
- \`AUTO_URL_AND_ARTWORK_RUNTIME_PROOF=true\`.

The bridge remains read-only for status queries and grants no arbitrary filesystem, command, source-mutation, merge, deployment or self-approval authority.
