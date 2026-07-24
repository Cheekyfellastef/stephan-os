# UEVR reference map

## Role in the Flat-to-VR Research Lab

UEVR is the primary reference architecture for broad, reusable flat-to-VR conversion across Unreal Engine 4 and Unreal Engine 5 titles. It should be studied as a systems platform rather than as a single game mod.

## Canonical public sources

- `praydog/UEVR` — backend, rendering integration, OpenXR/OpenVR support, UObjectHook, camera, UI, input and plugin surfaces.
- `praydog/UESDK` — Unreal object, reflection and engine integration layer used by UEVR.
- `praydog/uevr-frontend` — injector and process-selection frontend. The repository is MIT licensed.
- Official UEVR documentation and release notes.

Pin every imported repository to a commit SHA and preserve its upstream licence files. Do not flatten upstream repositories into Stephanos source or remove attribution.

## Architecture topics to extract

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

- Public source repositories with intact history, licence and attribution
- Official documentation snapshots or indexed links
- Release notes and API-change summaries
- Public example plugins and Lua scripts
- Public game profiles whose redistribution terms allow it
- Derived architecture notes, diagrams, tests and reusable patterns

## What should remain external or private

- Game files and proprietary Unreal assets
- Profiles or plugins without clear redistribution permission
- Discord-only material unless the author has made redistribution terms explicit
- User-downloaded binaries where licence or provenance is uncertain

## Relationship to Starfield

Starfield is not an Unreal game, so UEVR cannot be dropped into it directly. Its value is architectural:

- how to discover engine objects at runtime
- how to inject stereo rendering without source access
- how to expose reusable camera, UI and controller layers
- how to separate universal machinery from per-game profiles
- how to build a plugin ecosystem instead of one monolithic conversion

The Starfield project should borrow these patterns while implementing Creation Engine 2-specific hooks through SFSE and the game's D3D12 renderer.

## Initial extraction deliverables

1. Repository and licence manifest pinned to exact commits.
2. Rendering-mode comparison note.
3. UObjectHook and reflection architecture map.
4. OpenXR input and motion-control map.
5. UI projection and cutscene-comfort map.
6. Plugin API catalogue for C++, Lua and Blueprint.
7. Reusable design patterns applicable outside Unreal Engine.
8. A list of UEVR-specific assumptions that must not leak into the Starfield architecture.
