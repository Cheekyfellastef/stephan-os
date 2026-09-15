# VR Discovery Teaching Loop V1

## Mission

Turn material, deduplicated #1596 discovery candidates into provenance-aware reusable VR knowledge so the existing VR agent, Capability Graph, Method Library, parity model and Shared Workspace compound rather than merely accumulate research comments.

Canonical owner remains #1596 for discovery and #1593 for extraction. This document creates no new controller, scheduler, monitor, agent or implementation lane.

## Pipeline

`#1596 candidate -> dedupe -> policy gate -> canonical evidence-plane preservation -> #1593 extraction -> Method Library -> Capability Graph -> #1591 parity when applicable -> Shared Workspace projection -> runtime/headset proof gate when required`

A discovery candidate is never itself proof that Stephanos possesses a trusted runtime capability.

## Promotion gate

A candidate may enter reusable knowledge when all non-runtime facts required for the claim are pinned: canonical source identity, exact revision/version/document/video identity, canonical evidence plane, confidence/corroboration, licence/availability/reuse boundary, material claim and proof references.

Licence, provenance or availability uncertainty blocks promotion. Runtime-, game-build- or headset-dependent claims remain `proof-pending` until their existing Battle Bridge/operator acceptance gate is satisfied.

## Canonical evidence planes

Teaching records MUST persist the existing canonical evidence-plane values exactly. Do not introduce aliases that would become invisible to current consumers:

- `NORMATIVE_OR_OFFICIAL_SPECIFICATION`: standards/specification requirements. Never imply runtime support without capability discovery/proof.
- `OFFICIAL_AUTHORING_EVIDENCE`: official authoring/developer engineering evidence. Never imply independent reproduction.
- `DIRECT_PUBLIC_SOURCE_EVIDENCE`: public source/release behaviour at an exact identity. Never imply installed or headset success.
- `PUBLIC_PRODUCT_OR_CREATOR_CLAIM`: vendor/product/creator field claims with exact context. Useful for hypotheses/failure modes; never upgrade a creator claim to implementation truth.
- `APPROVED_LOCAL_PACKAGE_EVIDENCE`: an explicitly approved local package identity; do not equate package approval with observed runtime success.
- `OBSERVED_RUNTIME_OR_HEADSET_PROOF`: exact installed/runtime/headset observation from the authorised proof path.
- `STEPHANOS_INFERENCE_OR_PROPOSAL`: independently written Stephanos method/constraint/fallback/inference derived from evidence, retaining backlinks and never masquerading as its source plane.

If one teaching unit depends on more than one plane, retain separate evidence records/backlinks for each plane rather than collapsing them into a synthetic class. This is the lossless mapping contract for #1593 and Shared Workspace consumers.

## Teaching record

Each promoted teaching unit must retain:

- `teachingKey`
- source `candidateKey` and #1596 comment ID
- canonical source ID and exact observed identity
- canonical evidence plane(s) and confidence
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

Teach with `NORMATIVE_OR_OFFICIAL_SPECIFICATION`: capability-discover `XR_EXT_spatial_container` / self-rendering support; prefer the ratified multi-vendor bounded/immersive presentation path when exposed; preserve a reversible presentation fallback when absent. High relevance to Spatial Bridge, medium to the generic factory, indirect to Starfield. Do not infer Meta/SteamVR/Starfield runtime support from specification existence.

### PCVR Mods Installer Hub release findings

Source candidates include the durable #1596 v0.8.7.0, v0.8.7.1 and v0.8.7.2 candidate comments.

Teach orchestration patterns from exact public source/release evidence as `DIRECT_PUBLIC_SOURCE_EVIDENCE`, then record independently derived reusable patterns as `STEPHANOS_INFERENCE_OR_PROPOSAL`: transactional install/rollback, persistent recovery state, explicit current/working/legacy compatibility routes, canonical-upstream resolution, source/binary identity separation, durable game-location assignment, multi-mod lifecycle targeting and retirement of conversion routes when native VR supersedes them. Preserve each referenced mod/game's independent provenance and licence.

### Meta XR Operator simulator and physical-headset findings

Source candidates: durable #1596 Meta XR Operator candidate comments.

Preserve official/vendor documentation in its applicable existing canonical plane, normally `OFFICIAL_AUTHORING_EVIDENCE` for developer engineering guidance or `PUBLIC_PRODUCT_OR_CREATOR_CLAIM` for product claims. Teach a derived two-rung verification architecture as `STEPHANOS_INFERENCE_OR_PROPOSAL`: simulator preflight can provide repeatable automated UI/render/input checks; separately authorised physical-headset operation can extend automation to device-side observation/control. Neither rung becomes `OBSERVED_RUNTIME_OR_HEADSET_PROOF` until the existing local proof path actually observes it. Preserve Meta proprietary/experimental boundaries and never infer Starfield compatibility.

### REFramework current implementation finding

Source candidate: durable #1596 REFramework candidate comment.

Retain exact upstream source as `DIRECT_PUBLIC_SOURCE_EVIDENCE`; teach broadly reusable derived principles as `STEPHANOS_INFERENCE_OR_PROPOSAL` only after exact upstream revalidation: layered native-function discovery, fail-closed unresolved hooks, artefact-derived loader state and explicit diagnostics to reduce shared-engine adapter brittleness. Keep RE Engine-specific hooks title/engine-specific and do not project them onto Creation Engine 2.

### Halo MCC VR continuation findings

Source candidates: durable #1596 Halo gesture/melee, accepted-state and source-continuity candidate comments.

Preserve public implementation facts as `DIRECT_PUBLIC_SOURCE_EVIDENCE`, headset observations only as `OBSERVED_RUNTIME_OR_HEADSET_PROOF`, and reusable cross-title lessons as `STEPHANOS_INFERENCE_OR_PROPOSAL`. Teach: separate physical contact from gesture-triggered actions; preserve per-hand ownership/tracking guards; use title-specific native action adapters behind shared interaction contracts; keep merged source identity distinct from headset-accepted identity; preserve immutable historical evidence when an upstream disappears; reconcile successor/fork lineage explicitly instead of silently changing canonical authority. Halo/MCC assets remain proprietary and outside permissive source grants.

## Future automatic behaviour

Every future material #1596 candidate must be evaluated for teaching in the same discovery cycle. If policy-valid, emit/update the existing #1593 extraction state and Shared Workspace projection using canonical evidence-plane values. If blocked, retain the candidate with the exact blocking predicate. If it changes provider parity, also project to #1591. Do not create duplicate implementation work.

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
