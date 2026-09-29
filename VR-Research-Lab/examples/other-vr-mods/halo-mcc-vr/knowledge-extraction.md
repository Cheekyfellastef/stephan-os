# Halo MCC VR: Stephanos knowledge extraction

## Source identity

- Upstream repository: `pancreations/Halo-MCC-VR`
- Pinned accepted release snapshot: `c37dd3c8596343c4dc8fbe4d4d5d4440b8acee98`
- Upstream licence: MIT
- Snapshot recorded: 2026-07-30
- Known-good upstream release at capture: `MCC_VR_ALPHA_0.3.1`
- Supported titles: Halo 3, Halo 3: ODST and Halo: Reach
- Announced next title: Halo 4, with Halo: Combat Evolved and Halo 2 intended later

This document is a Stephanos extraction, not a replacement for upstream evidence. Re-check the pinned source and current upstream state before implementation.

## 0.3.1 material change

The previous Lab snapshot covered Alpha 0.3.0. Alpha 0.3.1 confirms that the shared runtime now supports a third materially distinct title, **Halo: Reach**, alongside Halo 3 and ODST.

The accepted release records:

- Quest 3 testing through Meta Link at 120 Hz;
- Reach stereo, head tracking, weapon aim, hands, HUD, haptics and native vehicle controls;
- a Reach sniper-triggered black-world repair;
- a shared room-fixed stereoscopic cutscene theatre across all three games;
- Microsoft Store / Xbox app support from the same package;
- ALVR, Virtual Desktop and Meta Link double-image repairs;
- exact release ZIP, DLL and launcher hashes.

Reach still has known defects, including misplaced character tags and navpoints, incomplete HUD controls and broader vehicle, weapon, co-op and long-session coverage. It is playable evidence, not completion evidence.

## Why this is a priority source

Halo MCC VR is unusually valuable because it combines several research dimensions in one public project:

1. Native OpenXR injection into games that were not designed for VR.
2. Reuse of one runtime across several related but materially different titles.
3. Per-title reverse-engineering evidence rather than assumed engine parity.
4. Motion-controller aiming, stereo rendering, 6DOF tracking, HUD work, arm/weapon presentation, cutscene handling and comfort controls.
5. Exact source, package and binary identity linked to real headset validation.
6. AI-assisted implementation directed by a human who retained product decisions, reverse-engineering judgement and physical headset testing.
7. Preserved failed candidates and explanations of why they failed.
8. Direct evidence that a working shared conversion framework can make each additional title substantially cheaper than the first.

It is therefore relevant to flat-game conversion, the VR Capability Graph, the Learning Flywheel and selected Spatial Bridge engineering methods.

## Verified engineering patterns

### 1. Shared runtime, title-specific evidence

The project reuses shared runtime machinery, but treats each title adapter as independently evidenced. Related engines do not justify copied offsets, signatures, tags, bone indices or runtime assumptions.

The arrival of Reach strengthens this pattern. Shared stereo, OpenXR, controller, configuration and proof machinery transferred, while Reach-specific cameras, HUD tags, vehicles, weapon behaviour and defects still required independent work.

**Method candidate:**

> Reuse architecture, not unverified identities. Every target must independently prove its bindings and behaviours.

### 2. Runtime ownership is a state machine

Loaded-module presence is not sufficient to establish the active title. The project models title generations, complete module-set epochs, fresh camera heartbeats, zero/one/multiple-owner states and bounded transition windows.

**Method candidate:**

> For multi-module hosts, separate availability, ownership, readiness and capability publication. Reject stale generations and ambiguous ownership.

### 3. Capabilities are independently gated

Controller transport, stereo, aim, HUD, arm IK, haptics and other features are not represented by one coarse supported flag. Unarmed states can expose only capabilities that are safe without the active camera transaction.

**Method candidate:**

> Publish the smallest proven capability set. A new lifecycle must not accidentally enable every downstream feature.

### 4. Fail-soft frame handling

The current-state evidence records timing-dependent cases where a transient frame condition caused permanent teardown. The repaired pattern skips the affected frame, preserves the valid runtime core and records a bounded diagnostic reason.

**Method candidate:**

> Distinguish transient frame failure from invalid system state. Do not convert a recoverable observation into permanent teardown.

### 5. Accepted evidence has an explicit pointer

Upstream maintains a current accepted-build pointer with source revision, build preset, package identity, hashes and headset result. Older experiments remain evidence but are not instructions.

**Method candidate:**

> Maintain one active accepted-state record. Preserve historical evidence without allowing stale narratives to outrank the accepted pointer.

### 6. Comments are hypotheses, not proof

The project explicitly records costly cases where stale comments were trusted over code and runtime evidence.

**Method candidate:**

> A comment may guide search, but implementation decisions must be checked against current code, artefact identity and observed behaviour.

### 7. Exact artefact lineage matters

A clean rebuild can produce a new, unaccepted binary even from accepted source. The project links headset acceptance to exact packaged hashes and requires regression before a rebuilt candidate becomes accepted.

**Method candidate:**

> Acceptance attaches to the tested artefact lineage, not merely to a source branch name or a successful compile.

### 8. Tuned configuration is part of the product

The shipped configuration contains tested values that differ from internal defaults. Missing migration can silently reintroduce performance or presentation defects.

**Method candidate:**

> Treat validated configuration, migration and defaults as versioned implementation assets with their own proof requirements.

### 9. Headset testing closes the proof loop

Desk tests and deterministic matrices narrow risk but do not accept perceptual VR behaviour. Exact candidates require physical headset results and relevant regression coverage.

The 0.3.1 release is particularly relevant to Stephanos because its accepted evidence includes Quest 3 and Meta Link, matching our primary Starfield transport target.

**Method candidate:**

> Separate static proof, deterministic test proof and embodied runtime proof. Do not substitute one for another.

### 10. Human direction plus AI implementation can compound

The maintainer reports that Claude and Codex wrote the code under human direction, while the human retained design decisions, reverse-engineering choices and headset verification.

**Method candidate:**

> Keep the human at intent, judgement and embodied-proof layers while AI performs bounded investigation, implementation and repair against explicit evidence contracts.

### 11. New-title marginal cost can fall sharply

Halo 3 established the main runtime. ODST and Reach then reused substantial portions of the OpenXR, stereo, controller, UI, configuration, launcher and evidence machinery while adding bounded title-specific adapters.

This does not make each later title automatic, but it changes the work from complete invention to evidence-led adaptation.

**Method candidate:**

> Measure conversion progress as reusable shared capability plus shrinking title-specific residue.

### 12. Cutscenes can use a shared comfort abstraction

Alpha 0.3.1 adds a room-fixed stereoscopic theatre that preserves authored cinematic framing while preventing the image from riding the user's head. The same abstraction works across all three supported titles.

**Method candidate:**

> When native cinematic cameras are unsuitable for direct embodiment, preserve authored presentation inside a stable stereoscopic spatial surface rather than forcing one universal first-person camera rule.

## VR Capability Graph candidates

Create or enrich nodes for:

- native OpenXR injection
- stereo swapchain and per-eye rendering
- 6DOF head tracking
- controller-driven weapon aim
- virtual-controller transport
- arm and weapon IK
- authored floating crosshair
- native HUD and world-anchored HUD defects
- room-fixed stereoscopic cutscene theatre
- multi-title runtime ownership
- lifecycle generation and heartbeat freshness
- per-capability gating
- transient-frame fail-soft handling
- title-specific signature evidence
- official editing-kit evidence
- artefact hash acceptance
- headset regression proof
- tuned configuration migration
- title module teardown and ownership handoff
- platform-edition detection and launch
- transport-specific stereo compatibility
- new-title marginal adaptation cost

Each node should retain the upstream path, pinned commit, licence, evidence status and whether the technique is accepted, experimental, rejected or historical.

## Starfield relevance

The new Reach result strengthens several parts of the Starfield plan:

- one shared native runtime can cover several related games without pretending their title-specific bindings are identical;
- Quest 3 Meta Link can be an accepted release target, not merely informal operator testimony;
- room-fixed stereoscopic cutscene theatre is a strong candidate for Starfield dialogue and cinematic transitions;
- platform and launcher differences belong in a shared launch layer rather than title rendering code;
- vehicle support can be added as a bounded title capability after core stereo and input work;
- known defects can remain explicitly capability-scoped while the wider title is playable.

Halo code is not directly portable to Creation Engine 2. The reusable value is architecture, evidence discipline and proof sequencing.

## Learning Flywheel candidates

The project should feed the Method Library with at least these candidate methods:

1. Accepted-state pointer and supersession method.
2. Per-title evidence isolation method.
3. Shared-runtime ownership state-machine method.
4. Capability-granular publication method.
5. Exact-hash embodied acceptance method.
6. Failed-candidate preservation and rejection-reason method.
7. Stale-comment verification method.
8. Configuration-as-tested-artefact method.
9. AI implementation with human judgement and physical proof method.
10. Shared runtime plus shrinking title-residue method.
11. Shared stereoscopic cutscene-theatre method.
12. Transport- and edition-specific compatibility method.

Method candidates are not promoted automatically. They require comparison with other projects and validation against Stephanos' own architecture.

## Spatial Bridge relevance

The following are reasonable architectural inferences, not direct upstream claims:

- Capability-granular publication could inform how a Quest client exposes only currently available Stephanos functions.
- Generation and freshness boundaries could inform reconnect, stale-projection and ownership handling.
- Zero-owner and ambiguous-owner behaviour supports fail-closed state projection.
- Fail-soft handling could prevent a transient render or network frame from collapsing a valid spatial session.
- Exact artefact and configuration lineage could strengthen Quest client release proof.
- The shared cutscene-theatre abstraction resembles a reusable spatial presentation surface for legacy 2D content.

The Halo runtime must not be copied as a spatial architecture wholesale. Only independently validated patterns should move into the Spatial Bridge readiness dossier.

## Safety and legal boundaries

- Do not ingest or redistribute Halo game files, editing-kit files or proprietary binaries.
- Do not execute upstream code or downloaded binaries during passive research ingestion.
- Preserve the upstream MIT notice with copied material.
- Treat unsigned injection code as untrusted until isolated, inspected and explicitly approved for runtime testing.
- Launch and anti-cheat constraints are installation concerns, not general Stephanos implementation authority.

## Refresh and next analysis

The Continuous VR Discovery goal should periodically compare upstream `master` and releases against the pinned snapshot. A change becomes a candidate when it affects:

- supported titles or runtimes
- shared runtime ownership
- rendering, camera, input, HUD, IK, vehicles or cutscene techniques
- evidence and acceptance policy
- build, configuration or release lineage
- AI-assisted development method
- licence or redistribution conditions

Halo 4 is now the next announced title. Its arrival should be treated as a particularly valuable test of whether the shared runtime continues reducing marginal conversion cost as engine and gameplay differences increase.

Useful next source-level analysis should be performed by a bounded worker on an isolated clone pinned to the recorded commit. The worker should produce a file map, dependency graph, technique map, per-title residue comparison and evidence lineage without executing the mod.
