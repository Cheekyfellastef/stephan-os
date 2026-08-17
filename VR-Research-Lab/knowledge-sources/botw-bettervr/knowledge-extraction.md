# Breath of the Wild BetterVR

Status date: 2026-08-17
Priority: P0
Evidence class: direct public implementation source with emulator, game and dependency boundaries

## Why this source matters

BetterVR adds a distinct flat-to-VR route that is not yet well represented in the Lab: converting a game through an emulator while coordinating renderer interception, VR presentation and game-code patches.

The admitted release is BetterVR 0.9.20 at commit `0e1053d58cdfbd592522dc892b1770418a1af009`. The maintainer explicitly says work is focused on the big 1.0 release, but 1.0 is not yet released at this snapshot.

## Reusable architecture

### Emulator-layer presentation boundary

BetterVR launches Cemu with a Vulkan layer enabled. The layer intercepts Vulkan commands and captures the game's rendered output. Because the project found OpenXR awkward to instantiate inside the Vulkan interception path, it uses Vulkan-to-D3D12 interop and submits through a separate D3D12 presentation path.

```text
Wii U game under Cemu
→ Vulkan command stream
→ BetterVR Vulkan interception layer
→ captured eye image / diagnostics
→ Vulkan ↔ D3D12 interop
→ OpenXR submission
→ headset
```

This is important because it establishes a conversion family where the game itself does not need to expose a native PC graphics-hook surface.

### Stereo game-state scheduling

The VR layer alone cannot create correct stereo. BetterVR also applies PowerPC assembly patches to the emulated game. A key pattern is to make the game render two frames for the two eye views before advancing game systems and visible objects.

```text
pose / game state N
→ render left-eye view
→ render right-eye view
→ advance game simulation
→ pose / game state N+1
```

That method is a strong Capability Graph candidate for emulated or translated titles because it preserves eye coherence instead of advancing animation and simulation between eyes.

### Game-code patch to host-code bridge

Simple game changes remain PowerPC assembly patches. More complex calculations can call into BetterVR's C++ code for camera, hand and interaction mathematics. Translated GPU clearing instructions can also be used as synchronization signals to the Vulkan presentation path.

This suggests a reusable architecture:

```text
minimal title-specific low-level patch
→ stable semantic event or state handoff
→ richer host-side VR logic
→ renderer synchronization
```

The title-specific patch remains small while the VR framework owns reusable math, input, interaction and diagnostics.

## Embodiment and interaction evidence

The current project includes:

- full 6DoF and room scale;
- full hands and arms;
- physical weapon use;
- swing and stab detection rather than simply touching enemies with a weapon collider;
- gestures to equip and throw weapons;
- motion interaction for puzzles and environmental actions;
- physical bow drawing in 0.9.20;
- optional third-person VR mode;
- controller- or head-relative walking options;
- snap turning and camera-comfort fixes.

These make BetterVR relevant to Starfield's later embodiment stack even though its engine attachment points are unrelated.

## Camera and presentation lessons

Release 0.9.20 includes fixes that prevent unwanted camera rotation during climbing and similar movement while explicitly excluding events, dialogues and cutscenes. Earlier releases also include first-/third-person transitions and cutscene-specific model fixes.

That is useful evidence for the Stephanos Presentation Controller:

```text
normal locomotion
→ VR owns comfortable head/camera policy

event / dialogue / cutscene
→ classify separately
→ preserve authored intent without forcing headset motion
```

BetterVR should therefore be compared with Halo MCC VR's room-fixed cutscene theatre and Starfield's Dialogue Camera signal rather than treated only as a renderer example.

## Mod-compatibility lesson

BetterVR states that it modifies code rather than game data and therefore retains broad compatibility with other Breath of the Wild mods. That suggests a useful design principle for Stephanos:

> Prefer narrow runtime or executable adaptation layers over invasive content rewrites when the same VR capability can be achieved without altering game assets or data.

This does not eliminate compatibility testing, but it reduces the number of content conflicts the VR layer itself introduces.

## Diagnostics and operational evidence

The current launcher and README expose explicit setup requirements and failure signatures:

- Cemu version 2.6 is the tested baseline;
- Vulkan renderer required;
- Breath of the Wild update V208 expected;
- FPS++ must be enabled or the game can crash;
- inaccurate graphics/runtime configuration produces identifiable failure modes;
- Vulkan overlays/layers can interfere;
- GPU driver failures are distinguished from game/mod failures;
- quality presets and VR resolution multiplier expose controlled performance tradeoffs.

This should inform a generic VR Route Readiness contract with observable preflight rather than trial-and-error launch.

## Capability Graph candidates

- emulator-layer VR conversion route;
- Vulkan interception plus external OpenXR presentation;
- Vulkan/D3D12 interop for headset submission;
- coherent two-eye render scheduling before simulation advance;
- low-level emulated-code patch to host-side C++ bridge;
- renderer synchronization signals emitted from translated guest GPU instructions;
- room-scale full-body attachment in an emulated title;
- physical melee intent detection;
- physical bow draw state mapping;
- hybrid first-/third-person VR policy;
- event/dialogue/cutscene camera exception handling;
- code-only adaptation for broad content-mod compatibility;
- explicit emulator/runtime/profile preflight and diagnostic classification.

## Licence and provenance boundary

BetterVR itself is MIT licensed and the repository lists MIT-licensed supporting libraries including vkroots, ImGui and ImPlot. The Nintendo game, Cemu, graphic packs and any other dependencies retain their own licences and rights.

The project requires a legal Wii U copy of Breath of the Wild and states that it ships no game files. Stephanos should store source-derived methods, metadata and independently written analysis only, never Nintendo assets or unauthorised game data.

## Quest 3 boundary

The project uses OpenXR and lists Meta Quest among supported headset families. The upstream README currently recommends Virtual Desktop, ALVR or Steam Link over Meta/Oculus Link for Quest because of interpolation artefacts observed by the maintainer.

That is useful upstream operational evidence, but it is not proof for Stephan's exact Quest 3 + Meta Air Link route. Any local comparison must remain a separately authorised Battle Bridge experiment, and Air Link remains the primary Stephanos transport unless evidence justifies an explicit alternative test.

## Starfield relevance

The direct game hooks are not portable from Wii U Breath of the Wild to Creation Engine 2. The transferable value is architectural:

1. separate title-specific low-level adaptation from reusable VR logic;
2. render both eyes from one coherent simulation state;
3. keep camera ownership activity-aware;
4. prefer code/runtime adaptation over unnecessary content mutation;
5. expose explicit readiness and failure-layer diagnostics;
6. treat embodiment, interaction, stereo, presentation and transport as separate modules.

BetterVR therefore belongs beside Halo MCC VR and CyberpunkVR Port as a P0 implementation reference, but in a new **emulator-layer conversion** family.
