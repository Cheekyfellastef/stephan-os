# Luke Ross R.E.A.L. VR knowledge extraction

Status: registered P0 proprietary methodology and compatibility source.

## Why this source is distinct

R.E.A.L. VR demonstrates how one common injector can be adapted across a large catalogue of visually complex AAA games while retaining a seated controller or keyboard-and-mouse operating model. It is a major comparison point for alternate-eye rendering, broad title support and continuous compatibility repair.

## Capability Graph candidates

- ReShade-based injection and common-framework ownership.
- Alternate-eye rendering, including versioned improvements and temporal artefact management.
- Per-game modules on top of a shared framework.
- Gamepad-first and keyboard/mouse-first interaction without requiring motion-control parity.
- Camera, FOV, HUD, cutscene and first-person/third-person adaptation.
- Upscaler, anti-aliasing and driver compatibility.
- Resolution and frame-pacing trade-offs in high-fidelity AAA games.
- Framework overlay and per-title configuration.
- Game-update breakage, repair cadence and compatibility communication.

## Method Library candidates

1. **Common framework, narrow title adapter**
   - Keep renderer and headset transport common.
   - Isolate camera, HUD and title-specific corrections.
   - Revalidate after each game or graphics-stack update.

2. **Alternate-eye evidence protocol**
   - Measure eye alternation correctness, temporal ghosting, camera-motion artefacts, frame consistency and reprojection interaction separately.
   - Treat stable frame pacing as part of stereo correctness rather than merely performance.

3. **Seated-controller viability**
   - A conversion can deliver high value without motion controls when head tracking, scale, stereo, camera and comfort are correct.
   - Do not burden every target with full hand interaction before the primary experience is proven.

4. **Compatibility maintenance as a product surface**
   - Record game version, driver, upscaler, framework and module revision.
   - Separate a framework regression from a title-module regression.

5. **Legal and availability resilience**
   - Source provenance, licence and publisher-policy state are operational dependencies.
   - Withdrawn or paywalled files must not become hidden foundations for Stephanos.

## Relevance

### Flat-to-VR programme

Provides the strongest large-catalogue comparison for shared-framework conversion of non-Unreal, non-RE-Engine and otherwise unsupported AAA games.

### Starfield VR

Useful as a contrast between alternate-eye conversion and Mutar's deeper REFramework/OpenXR implementation. The comparison can reveal which benefits require native per-eye rendering and which can be achieved more cheaply.

### Spatial Bridge

The reusable ideas are common-core modularity, configuration, compatibility repair and seated interaction. Alternate-eye game rendering is not the preferred architecture for a native Quest client.

## Evidence boundary

Current framework artefacts remain proprietary or access-controlled. Stephanos stores public metadata, lawful operator observations and independently authored abstractions only. Unauthorised mirrors are excluded.
