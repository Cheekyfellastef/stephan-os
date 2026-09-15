# VR Discovery Teaching Loop V1

## Mission

Turn material, deduplicated #1596 discovery candidates into provenance-aware reusable VR knowledge so the existing VR agent, Capability Graph, Method Library, parity model and Shared Workspace compound rather than merely accumulate research comments.

Canonical owner remains #1596 for discovery and #1593 for extraction. This document creates no new controller, scheduler, monitor, agent or implementation lane.

## Pipeline

`#1596 candidate -> dedupe -> policy gate -> evidence-class preservation -> #1593 extraction -> Method Library -> Capability Graph -> #1591 parity when applicable -> Shared Workspace projection -> runtime/headset proof gate when required`

A discovery candidate is never itself proof that Stephanos possesses a trusted runtime capability.

## Promotion gate

A candidate may enter reusable knowledge when all non-runtime facts required for the claim are pinned: canonical source identity, exact revision/version/document/video identity, evidence plane, confidence/corroboration, licence/availability/reuse boundary, material claim and proof references.

Licence, provenance or availability uncertainty blocks promotion. Runtime-, game-build- or headset-dependent claims remain `proof-pending` until their existing Battle Bridge/operator acceptance gate is satisfied.

## Claim classes

- `normative`: standards/specification requirements. Never imply runtime support without capability discovery/proof.
- `vendor`: official product/runtime/tool statements. Never imply independent reproduction.
- `implementation`: public source/release behaviour at an exact identity. Never imply installed or headset success.
- `field-evidence`: creator/operator observations with exact context. Useful for hypotheses/failure modes, never implementation truth.
- `local-proof`: exact installed/runtime/headset evidence from the authorised Battle Bridge path.
- `stephanos-derived`: independently written method/constraint/fallback extracted from one or more above planes, retaining backlinks.

## Teaching record

Each promoted teaching unit must retain:

- `teachingKey`
- source `candidateKey` and #1596 comment ID
- canonical source ID and exact observed identity
- evidence plane and confidence
- licence/availability/reuse boundary
- reusable method or capability
- applicability and non-applicability
- constraints and known failure modes
- preferred fallback/rollback
- required proof level
- freshness/supersession identity
- #1593 Method Library / Capability Graph projection
- #1591 parity projection only when provider capability changes
- Shared Workspace projection state

## Backfill batch: external research findings already durable on #1596

These records must be re-read from their durable #1596 candidate comments and canonical upstream before extraction. Chat prose is not authority.

### OpenXR 1.1.63 spatial containers

Source candidate: #1596 comment `5525178010`.

Teach as normative architecture knowledge: capability-discover `XR_EXT_spatial_container` / self-rendering support; prefer the ratified multi-vendor bounded/immersive presentation path when exposed; preserve a reversible presentation fallback when absent. High relevance to Spatial Bridge, medium to the generic factory, indirect to Starfield. Do not infer Meta/SteamVR/Starfield runtime support from specification existence.

### PCVR Mods Installer Hub release findings

Source candidates include the durable #1596 v0.8.7.0, v0.8.7.1 and v0.8.7.2 candidate comments.

Teach orchestration patterns, not third-party mod implementation: transactional install/rollback, persistent recovery state, explicit current/working/legacy compatibility routes, canonical-upstream resolution, source/binary identity separation, durable game-location assignment, multi-mod lifecycle targeting and retirement of conversion routes when native VR supersedes them. Preserve each referenced mod/game's independent provenance and licence.

### Meta XR Operator simulator and physical-headset findings

Source candidates: durable #1596 Meta XR Operator candidate comments.

Teach a two-rung verification architecture: simulator preflight can provide repeatable automated UI/render/input checks; separately authorised physical-headset operation can extend automation to device-side observation/control. Neither rung substitutes for the existing operator Quest 3 acceptance verdict. Preserve Meta proprietary/experimental boundaries and never infer Starfield compatibility.

### REFramework current implementation finding

Source candidate: durable #1596 REFramework candidate comment.

Teach broadly reusable implementation principles only after exact upstream revalidation: layered native-function discovery, fail-closed unresolved hooks, artefact-derived loader state and explicit diagnostics to reduce shared-engine adapter brittleness. Keep RE Engine-specific hooks title/engine-specific and do not project them onto Creation Engine 2.

### Halo MCC VR continuation findings

Source candidates: durable #1596 Halo gesture/melee, accepted-state and source-continuity candidate comments.

Teach: separate physical contact from gesture-triggered actions; preserve per-hand ownership/tracking guards; use title-specific native action adapters behind shared interaction contracts; keep merged source identity distinct from headset-accepted identity; preserve immutable historical evidence when an upstream disappears; reconcile successor/fork lineage explicitly instead of silently changing canonical authority. Halo/MCC assets remain proprietary and outside permissive source grants.

## Future automatic behaviour

Every future material #1596 candidate must be evaluated for teaching in the same discovery cycle. If policy-valid, emit/update the existing #1593 extraction state and Shared Workspace projection. If blocked, retain the candidate with the exact blocking predicate. If it changes provider parity, also project to #1591. Do not create duplicate implementation work.

## Auditable verdict

The existing orchestration should expose counts and identities for:

- candidates seen
- duplicates suppressed
- policy blocked
- Method Library extractions
- Capability Graph projections
- #1591 parity updates
- Shared Workspace projections
- items awaiting Battle Bridge/operator proof

Only when this path is implemented and observable may the system emit:

`VR_DISCOVERY_TEACHING_LOOP_ACTIVE`
