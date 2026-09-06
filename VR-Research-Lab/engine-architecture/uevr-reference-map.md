# UEVR reference map

## Role in the Flat-to-VR Research Lab

UEVR is the primary architectural reference for broad, reusable flat-to-VR conversion across Unreal Engine 4 and Unreal Engine 5 titles. It should be studied as a systems platform rather than treated as one uniformly reusable open-source codebase.

## Evidence-classified upstreams

Evidence was re-verified on 2026-08-17. Public readability is not reuse permission, and every permitted action remains bound to the exact evidence below.

- `praydog/UEVR` — backend, rendering integration, OpenXR/OpenVR support, UObjectHook, camera, UI, input and plugin surfaces. Exact observed head `74b76bc9428a906cbdc69de3ebc1905fd0e9cc57`; `LICENSE` blob `9fe814da6591bf98ab8f1f90ece0f6dcc8ca9604` states all rights reserved. Classification: `PUBLIC_READABLE_RESTRICTED`. Permitted treatment: repository URL/head/licence metadata plus non-expressive architectural observations only. Do not clone, vendor, inventory implementation files, or copy source into the durable Stephanos corpus.
- `praydog/UESDK` — Unreal object/reflection and engine-integration upstream referenced by UEVR. Anonymous GitHub repository resolution returned 404 on 2026-08-17. Classification: `UPSTREAM_UNAVAILABLE_OR_RESTRICTED`. Permitted treatment: metadata/link-only. Do not require a clone and do not infer a reuse licence from UEVR references.
- `praydog/uevr-frontend` — injector and process-selection frontend. Exact observed head `dd6d372813097668a67e107c543f513d3170dc7a`; `LICENSE` blob `566b2a33fcdae086c79da6fc2ec089b96707d8cc` is MIT. Classification: `PUBLIC_MIT_PINNED`. This is the only UEVR code repository currently eligible for exact-pin ingestion, and only after the evidence is revalidated immediately before ingestion.
- Official UEVR documentation and release notes — link/index/reference material only unless an item has separately proven redistribution terms.

If any upstream head, licence blob, access status, repository identity or permitted-action classification differs from the pinned evidence, fail closed as `EVIDENCE_DRIFT` and do not ingest code. Never substitute a moved head or a similarly named repository silently.

## Architecture topics to extract

The topics below describe research questions. For restricted or unavailable upstreams, derive only non-expressive observations from permitted public evidence; do not copy implementation source.

### Rendering

- Native Unreal stereo rendering
- Synchronized sequential eye rendering
- AFR as a last-resort fallback
- D3D11 and D3D12 interception boundaries
- Swapchain and render-target discovery
- Temporal effects, TAA, DLSS and FSR behaviour
- Depth-buffer submission and latency implications

### Engine discovery

- Unreal version detection
- UObject and reflection traversal
- Camera and scene-component discovery
- Runtime property and function access
- Engine-version compatibility strategy

### Camera and embodiment

- 6DOF head pose integration
- Camera detachment and attachment
- First-person conversion of third-person games
- World-scale and near-clip handling
- Room-scale movement and collision-safe sweep movement

### Input and interaction

- OpenXR action mapping
- Motion-controller emulation
- Head aiming and controller aiming
- UObjectHook-based component attachment
- Per-game bindings and controller profiles

### User interface

- Automatic projection of flat UI into VR space
- UI depth, scale and distance controls
- Toggleable 2D screen mode
- Cutscene and menu comfort strategies

### Extension model

- C/C++ plugin API
- Lua API
- Blueprint support
- Per-game configuration and profile packaging
- Stable hooks versus game-specific overrides

## What should enter the corpus

For the UEVR family specifically:

- the exact MIT-pinned `uevr-frontend` repository may enter the source corpus after pre-ingestion evidence validation;
- UEVR backend and UESDK remain external evidence references, with only URL/head/access/licence metadata and non-expressive derived architectural observations retained;
- official documentation may be indexed or linked subject to its own terms;
- derived architecture notes, diagrams, tests and reusable patterns must not reproduce restricted implementation expression.

More generally, a public source repository may enter only when its exact revision, access status and reuse licence have been positively proven and the permitted action explicitly allows ingestion.

## What should remain external or private

- restricted public repositories whose source is readable but not licensed for reuse
- unavailable or access-restricted upstreams
- game files and proprietary Unreal assets
- profiles or plugins without clear redistribution permission
- Discord-only material unless the author has made redistribution terms explicit
- user-downloaded binaries where licence or provenance is uncertain

## Relationship to Starfield

Starfield is not an Unreal game, so UEVR cannot be dropped into it directly. Its value is architectural:

- how reusable conversion systems separate engine discovery, rendering, camera, UI and controller concerns
- how stereo-rendering approaches can be compared without copying restricted implementation
- how plugin/profile boundaries can inform a Creation Engine 2-specific architecture
- how evidence and per-game adaptation should remain separate from universal machinery

The Starfield project should use licence-compatible patterns and independently derived design knowledge while implementing Creation Engine 2-specific hooks through its own authorised stack.

## Initial extraction deliverables

1. Evidence manifest recording each upstream's exact repository identity, observed SHA/access state, licence classification, licence blob where available, permitted action and observation date.
2. Exact-pin manifest and source inventory for the MIT `uevr-frontend` only.
3. Rendering-mode comparison note based on permitted public evidence.
4. UObject/reflection architecture map expressed as non-expressive derived observations where the underlying source is restricted or unavailable.
5. OpenXR input and motion-control conceptual map.
6. UI projection and cutscene-comfort conceptual map.
7. Plugin/API capability catalogue that distinguishes documented capabilities from source-derived evidence.
8. Reusable design patterns applicable outside Unreal Engine, with provenance and licence boundaries.
9. A list of UEVR-specific assumptions that must not leak into the Starfield architecture.

No acceptance criterion may require cloning the restricted UEVR backend or unavailable/restricted UESDK upstream.