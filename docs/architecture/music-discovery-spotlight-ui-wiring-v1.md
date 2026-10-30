# Music Discovery Spotlight UI Wiring V1

## Purpose

This bounded #1624 M2 slice connects the already-merged Music Discovery Spotlight presenter to the existing Music Intelligence Centre. It does not create another tile, player, catalogue provider, AI router, memory store, worker, scheduler, API route or runtime lane.

## Existing surface and action canon

The implementation renders presenter output inside the existing `#discovery-spotlight` surface. The existing doorway-track card remains the primary recommendation; a bounded Discovery Connections section is composed below it in the same surface.

Every discovery connection retains the presenter's explicit evidence class and reason. `LOCAL_SEED_INFERENCE` remains visibly inference, `OPERATOR_TASTE_EVIDENCE` remains distinct from external verification, and `EVIDENCE_UNAVAILABLE` is rendered honestly. This slice supplies no new catalogue relationship evidence, so it cannot upgrade local hints into external facts.

`SEARCH_EXISTING_CATALOGUE` buttons delegate to the existing `performNativeCatalogSearch()` path. The existing native catalogue adapters, result rendering, stable identity check and `insertListeningDeckCardWithoutPlaybackReset()` path remain the only way those search results enter the Listening Room.

## Continuity boundary

Rendering discovery connections mutates no Music state. Searching is ephemeral and does not change Taste DNA, ratings, Teach/Forget state, conversation state, the current track or the mounted player. Selecting an actual catalogue result continues through the existing duplicate check and no-playback-reset insertion path.

The presenter continuity contract remains:

```text
replacesPlayerDom=false
changesCurrentTrack=false
changesRatings=false
changesTeachingState=false
```

Spotify/provider catalogue payloads are not sent to AI by this slice. No account, credential, autoplay, provider-write, deployment, merge or runtime authority is added.

## Source proof

The bounded constructor requires the exact protected base and exact pre-change Music host/presenter blobs. The final PR estate is exactly:

1. `apps/music-tile/main.js`
2. `tests/music-discovery-spotlight-ui-wiring.test.mjs`
3. `docs/architecture/music-discovery-spotlight-ui-wiring-v1.md`

Focused proof covers presenter/connection contracts, existing native catalogue UI, conversational continuity, Music Intelligence Centre regressions and the new wiring contract.

## Acceptance boundary

This is standard-risk browser-visible source work. Independent exact-head review and separate operator merge approval remain required. Source merge alone is not live acceptance. The existing #1507/#1622 Battle Bridge lane must subsequently prove exact merged-main sync/build/served head plus desktop/iPad and real Windows Edge search, card insertion, playback/rating continuity, conversation, Teach, Forget and Reset before #1624 may be called complete/live.
