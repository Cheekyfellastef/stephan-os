# Mutar / NoMoreFlat VR knowledge extraction

Status: registered P0 open-source and public-release source family.

## Why this source is distinct

Mutar's work connects the current Stephanos programme directly to a real Starfield VR implementation and extends the comparison across other engines and titles. Unlike a purely proprietary framework, key repositories are MIT-licensed and may be inspected, tested and adapted with attribution.

## Directly evidenced Starfield capabilities

From the pinned `starfield2vr` source and documentation:

- REFramework-based common runtime.
- Full 6DoF head tracking.
- Room-scale standing origin and configurable world scale.
- Configurable HUD scale and distance.
- OpenXR resolution scaling.
- Decoupled head pitch.
- Haptics and multiple controller families.
- Quad-view compatibility.
- OpenXR and OpenVR package variants.
- Motion-controller input translated through a virtual joystick path.

## Capability Graph candidates

- Creation Engine / Starfield camera and renderer adaptation.
- Common framework ownership versus title-specific hooks.
- Controller-to-gamepad translation for games whose gameplay remains controller-native.
- HUD placement and scale as first-class comfort controls.
- OpenXR/OpenVR transport variants on the same title adapter.
- Quad-view compatibility negotiated independently from core stereo.
- Engine-family reuse through `anvilengine2vr`.
- Public-release migration from creator-controlled access to canonical GitHub distribution.

## Method Library candidates

1. **Framework reuse with title proof**
   - Start from a proven shared runtime.
   - Bind only the target's camera, rendering, UI and input seams.
   - Require independent headset proof for each title.

2. **Controller-preserving VR conversion**
   - Keep native gameplay controls where they are already effective.
   - Add head tracking, stereo, scale and comfort without forcing a complete interaction rewrite.

3. **Transport parity testing**
   - Test OpenXR and OpenVR packages as separate compatibility surfaces.
   - Keep rendering and interaction evidence distinct from transport success.

4. **Configuration as product engineering**
   - Treat HUD distance, world scale, resolution, origin and mirror behaviour as versioned tested inputs.

5. **Engine-family extraction**
   - Separate engine-generic code from title signatures and offsets.
   - Never infer that a second game is supported merely because it shares an engine label.

## Relevance

### Starfield VR parity

This is a primary implementation source rather than a peripheral comparison. It can directly inform the Starfield research corpus, experiment queue, capability graph and staged parity programme.

### Learning Flywheel

Mutar's public repositories allow Stephanos to compare implementation history, shared-framework changes, title adapters, release packaging and real compatibility repairs over time.

### Spatial Bridge

Reusable knowledge includes OpenXR lifecycle integration, configuration, controller coexistence, HUD placement and performance negotiation. Game-process injection remains outside the bridge authority architecture.

## Evidence boundary

The two pinned repositories are MIT-licensed. Every additional Mutar repository or release must receive its own licence and provenance check before source is copied or adapted.
