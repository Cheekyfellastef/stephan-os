# Full VR source sweep — 2026-10-03

Status: registry-wide provenance and freshness sweep.

## Outcome

The VR Research Lab now has one licence-aware reference lock covering the main public source estate. It distinguishes stable registered snapshots from newer observed heads and separates permissive, copyleft and analysis-only sources.

### Permissive source now available for local research cache

- Mutar `starfield2vr`, `anvilengine2vr`, Alex7722 Starfield fork and gsaw0 stability pair.
- REFramework current head `d1461375aee4ec3f313170f8eaad12064eb542d9` (19 commits beyond the registered snapshot).
- OpenXR SDK Source current head `3ed64d0f9bb680f24b80a085091e5c8fab38f7b7` (Apache-2.0; five commits beyond the registered snapshot).
- Quad-Views-Foveated remains exactly on the registered MIT pin.
- PCVR Mods Installer Hub current head `d6310d87208b38ec5453769356d8a256aa5a4f60` (40 commits beyond the registered snapshot).
- BetterVR current head `2e06b31f062408d3293a392df418da0ab37b1f23` (46 commits beyond the registered snapshot).
- CyberpunkVR Port exact MIT pin `a0c23fe110530bb74a73b3adf1ffa7d83050c43d`.
- Cyberpunk Universal Hands exact MIT repository `natpoh/cp2077-universal-hands` @ `9960fd4bc663a717fca98a821f49517d53fabc88`.
- Meta Quest Agentic Tools @ `3a8553d10a5a1bd1bf9beaaa950243fbbed3b9ea` (Apache-2.0).
- Halo MCC VR accessible MIT lineage and two MIT continuations/forks.

### Copyleft source admitted behind a separate-component boundary

- HIGGS remains on the registered GPL-3.0 pin and is still current.
- Rai Pal current head `a5e8104287061bef461ba162819b1be6c42b4613` is 121 commits beyond the registered snapshot.

These may be cloned into the research cache, but are not copied into Stephanos core without deliberately accepting the applicable GPL boundary.

### Public source / documentation that remains analysis-only

- UEVR current observed head `4ee5c6b6162dee2291fc75f9dfc57667f6d45a2d` — all rights reserved.
- UEVR Deluxe current head `20b0a47b8a2f0078ccc31e200c9786b147531662` and docs head `3c506fa127bc57f77f7235d75e6c70dc336d1759`.
- SKSE64 current observed head `25b72352adb6543fa6d0bd3795780672b2e238e0` — root reuse licence not established.
- OpenXR Docs current observed head `5a82d45bc9e0adbaa24b6c4a3e5b6d50e08c887d` — normative/mixed per-file terms.
- Luke Ross public historical repositories and current R.E.A.L. VR material remain method-only.
- Virtual Desktop, vorpX, Meta Quest Link, Bethesda tooling and creator video/profile sources remain metadata, documentation and operator-evidence lanes.

## High-value deltas found

### REFramework
The newer head adds substantial work around hook/integrity handling, script runner, SDK context/memory safety and callback/state utilities. These are useful framework-hardening references for native conversion plugins.

### OpenXR
The newer SDK/spec estate contains spatial-container, image-tracking and Android-trackables registry work plus loader/API-layer test changes. It is useful primarily for standards correctness and future Spatial Workspace work, not as a direct Starfield fix.

### PCVR Mods Installer Hub
The 40-commit delta expands and rewrites multiple title routes, including Cyberpunk plus many additional flat-to-VR targets. This is valuable for route discovery, prerequisites, install/rollback patterns and identifying external VR projects that the Flywheel has not yet registered individually.

### Rai Pal
The 121-commit delta touches multi-store/manual game discovery, game/mod databases, URL mod providers, engine detection and operational progress UI. The architecture is highly relevant to Stephanos' game inventory and route-selection machinery, but GPL separation must remain explicit.

### BetterVR
The 46-commit delta contains major UI/debugging, camera, OpenXR renderer, weapon/skeleton and performance/profiling work. Its fully stereo emulator-layer architecture remains one of the strongest counterexamples to alternate-eye conversion.

### Cyberpunk pair
The main Cyberpunk VR port is now an exact MIT source pin, and Universal Hands is now resolved to a separate MIT source repository. Together they provide concrete examples of native stereo + embodiment and transport-neutral shared-memory hand tracking.

### Meta VR agentic tools
The Apache-2.0 source demonstrates how a vendor exposes device management, diagnostics, performance tracing and agent skills. Stephanos should learn the capability decomposition while preserving its own fixed-operation authority model.

### Halo continuations
The broader MIT family contains multi-title conversion, transport-specific stereo fixes, rollback-aware launchers and explicit experimental/accepted separation. Newer is not automatically accepted; mine the evidence and failures without replacing the accepted headset-proven pointer.

## Flywheel instructions

1. Diff newer heads against their registered trusted snapshots.
2. Extract capability and method candidates with exact source path + commit.
3. Prioritize deltas that match current operator-observed defects or missing Stephanos capabilities.
4. Never promote based on recency alone.
5. Keep GPL candidates in a separate-component lane.
6. Keep NOASSERTION/proprietary sources method-only.
7. Require Battle Bridge and Quest 3 proof before runtime promotion.

## Hydration

`scripts/sync-vr-reference-sources.ps1` now understands the v2 source lock and can hydrate permissive plus explicitly separated copyleft sources into the ignored local cache while refusing analysis-only sources.

The generated local receipts record exact commit, licence, reuse class and core-reuse policy for each hydrated source.
