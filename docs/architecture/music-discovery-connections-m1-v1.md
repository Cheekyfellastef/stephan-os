# Music Discovery Connections M1 V1

## Purpose

Advance #1624 and umbrella product programme #1776 with one bounded Music Intelligence slice that turns the existing `relatedArtists` seed knowledge into an evidence-labelled discovery-card contract without rebuilding search, playback, ratings, conversation, Taste DNA, memory, provider routing or the Music Tile itself.

M1 is deliberately source-only. It does **not** claim the cards are rendered or accepted on Windows Edge/iPad. The next product slice may wire this contract into the existing Discovery Spotlight/Listening Room only after exact-head source review is clean.

## Evidence classes

Every surfaced connection is explicit about how strongly it is known:

- `VERIFIED_CATALOGUE_EVIDENCE`: only when a caller supplies a matching catalogue record with `verified: true`.
- `OPERATOR_TASTE_EVIDENCE`: operator-owned Music Tile evidence, such as a rating/teaching record. It is useful personalization evidence, not external verification.
- `LOCAL_SEED_INFERENCE`: the existing local artist-intelligence seed suggests the branch. This must never be presented as an externally verified relationship.

Unresolved artists or artists with no governed connection evidence return `EVIDENCE_UNAVAILABLE` rather than invented recommendations.

## Truth boundary

The M1 contract never authorizes or asserts:

- collaboration or label relationships;
- listening history beyond explicit Music Tile evidence;
- Spotify playback/history truth;
- provider availability or account connection;
- external verification merely because a local seed mentions an artist.

The wording on local-seed cards explicitly tells the UI that the relationship is inference until stronger evidence exists.

## Continuity boundary

Generating discovery connections is read-only with respect to the current Music experience:

```text
replacesPlayerDom=false
changesCurrentTrack=false
changesRatings=false
changesTeachingState=false
```

Rendering/acting on a future card must reuse existing catalogue-search and player actions rather than replacing the player DOM or resetting current track/rating state.

## Security boundary

The complete public request is captured as one closed-world plain-data descriptor snapshot before any request field is read. Top-level accessors, symbols, unexpected fields, arrays, exotic prototypes and revoked or uninspectable proxies fail closed as `EVIDENCE_UNAVAILABLE` rather than executing caller code or escaping an exception.

Catalogue and taste evidence accept at most 128 records through dense, plain-array descriptor snapshots. Sparse, accessor-bearing, custom-property, custom-prototype, oversized and uninspectable arrays are ignored as unusable evidence. Each accepted record is separately restricted to the four data fields `artistName`, `verified`, `sourceRef` and `reason`; accessors and exotic records are never promoted. Repeated normalized artist identities are treated as conflicting evidence and cannot upgrade a local inference.

## Focused proof

```bash
node --check apps/music-tile/engine/musicDiscoveryConnections.js
node --test tests/music-discovery-connections.test.mjs
```

The focused suite proves labelled seed inference, verified-catalogue upgrade rules, separate operator-taste evidence, provider/unverified fallback, no fabricated unknown-artist connections, playback/rating/teaching non-authority, hostile record and top-level accessor rejection, accessor-bearing array rejection, revoked-proxy exception safety, aggregate evidence bounds and duplicate-identity fail-closed behavior.

## Acceptance sequence

1. M1 source/test/doc exact-head review.
2. Existing protected source admission only after the operator-approved merge boundary.
3. A later bounded UI slice may render calm discovery cards inside the existing Music Intelligence Centre without creating another tile or provider stack.
4. Windows Edge/iPad runtime acceptance remains separate and must preserve the existing player identity, current track, ratings and Teach/Forget semantics.
