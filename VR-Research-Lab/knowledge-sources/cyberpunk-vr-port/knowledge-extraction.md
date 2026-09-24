# CyberpunkVR Port

Status date: 2026-08-05
Priority: P0
Evidence class: direct public implementation source with separate package and dependency boundaries

## Why this source matters

CyberpunkVR Port is a rare title-specific flat-to-VR conversion that combines engine-level stereo, OpenXR transport, embodiment, physical aiming, interaction and diagnostics in one inspectable architecture. It is useful to Stephanos as a method source, not as proof that the same hooks exist in Starfield.

## Reusable engineering patterns

### Genuine per-eye engine rendering

The current project documentation describes a second REDengine view with its own camera position, projection and render path. This is materially different from depth-only conversion or alternating a single rendered image. The method candidate is:

```text
identify or create second engine view
→ bind independent eye camera and projection
→ execute the engine render path for each eye
→ capture both outputs
→ submit through OpenXR
→ fall back honestly when a fresh second-eye frame is unavailable
```

### Embodiment as a separate capability layer

The project separates stereo rendering from hand and gameplay modules. Its capability stack includes full-body IK, controller-driven hands, weapon-muzzle aiming, optical sight alignment, motion melee, physical holsters and multiple locomotion references. Stephanos should preserve this modularity when translating patterns to Starfield.

### HUD and map presentation

The source provides evidence for rendering the HUD to both eyes at a finite depth and treating special interfaces such as the world map separately. This reinforces the Presentation Controller model: gameplay, dialogue, cinematics, maps and menus may require different spatial grammar.

### Instrumented proof chain

The in-headset overlay exposes runtime state for stereo, view capture, frame submission, pose behaviour, world scale, IPD, HUD placement and body calibration. This should inform Battle Bridge receipts that identify which stage failed rather than reporting only that VR looked wrong.

## Capability Graph candidates

- engine-native second-eye camera creation;
- genuine dual-view frame-graph execution;
- graceful mono fallback for menus/loading or missing eye frames;
- body and hand IK attachment points;
- physical weapon and sight alignment;
- motion melee and holster interaction;
- stereo HUD placement and special-interface policy;
- in-headset calibration and diagnostic overlays;
- modular separation of stereo, tracking, embodiment and gameplay adaptation.

## Licence and provenance boundary

The GitHub repository identifies as MIT, but the distributed Nexus package publishes more restrictive permissions and depends on external Cyberpunk tooling and assets. Pin the exact source commit, retain attribution and inventory every dependency before reuse. Never infer that all packaged content is MIT-covered.

## Quest 3 boundary

Published evidence mentions PICO 4 through VDXR. It does not prove Meta Quest 3, Meta OpenXR or Air Link operation. Any local experiment must remain an explicit Battle Bridge and headset acceptance lane.

## Starfield relevance

The strongest transferable ideas are the second-engine-view method, modular capability boundaries, physical weapon alignment, world-space HUD policy and diagnostic instrumentation. Creation Engine attachment points must be discovered independently through Starfield and Creation Kit evidence.
