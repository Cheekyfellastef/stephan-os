# Music Discovery Spotlight Presenter V1

## Purpose

This bounded #1624 product slice converts the admitted Music Discovery Connections M1 evidence contract into a calm presentation model for the existing Music Intelligence Centre surfaces.

It does not create a new Music Tile, player, catalogue stack, memory store, AI router, worker or runtime lane.

## Existing surfaces only

The presenter targets exactly two existing product destinations:

- `DISCOVERY_SPOTLIGHT`
- `LISTENING_ROOM`

The returned objects are presentation view-models only. They do not mount DOM, replace the player, start playback, change the current track, change ratings or mutate Teach/Forget state.

## Evidence truth

Each card preserves the evidence class emitted by `musicDiscoveryConnections.js`:

- `VERIFIED_CATALOGUE_EVIDENCE` → **Verified catalogue evidence**
- `OPERATOR_TASTE_EVIDENCE` → **Your Music Tile evidence**
- `LOCAL_SEED_INFERENCE` → **Local discovery inference**

Inference is never presented as external verification. No label, collaboration, listening-history, Spotify-availability or playback claim is created by this presenter.

## Action boundary

Each card exposes one bounded action descriptor:

```text
type=SEARCH_EXISTING_CATALOGUE
query=<artist name>
```

This deliberately reuses the existing catalogue-search path. It is not a playback command and grants no source, account, credential, deployment or runtime authority.

## Continuity law

The upstream M1 continuity policy is retained:

```text
replacesPlayerDom=false
changesCurrentTrack=false
changesRatings=false
changesTeachingState=false
```

The presenter therefore gives the later UI wiring slice an explicit contract to preserve player identity and learned-state continuity.

## Defensive boundary

The public request is accepted only as a plain own-data object with a closed field set. Accessors, exotic prototypes, arrays, symbols, unexpected top-level fields and uninspectable proxies fail closed to `EVIDENCE_UNAVAILABLE`.

Card count is bounded to six. Display text is bounded and control-character rejected.

## Acceptance boundary

This source slice is not proof that Discovery Spotlight cards are rendered, deployed, installed or live. A later bounded UI wiring change must connect this presenter to the existing DOM, preserve the current player/rating/teaching identities, pass the Music regression suite and obtain real desktop/iPad plus Windows Edge acceptance before operator-visible live status is claimed.
