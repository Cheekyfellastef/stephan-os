# UEVR Knowledge Extraction Brief

## Role in the source stack

UEVR is the universal-injector reference for Unreal Engine 4 and 5 games. It complements title-specific projects such as Halo MCC VR by showing what can be generalised across a large engine family before bespoke reverse engineering is required.

## Capability candidates

- Native Unreal stereo rendering and alternate synchronized eye-rendering strategies.
- HMD-driven 6DOF camera transformation.
- Automatic conversion of common Unreal UI into VR presentation.
- Runtime object discovery and manipulation.
- OpenXR and OpenVR runtime selection.
- Generic controller and room-scale adaptation.
- Per-game profile and plugin extension points.
- Compatibility triage across engine versions, render paths and temporal effects.

## Method candidates

- Begin with the engine's native stereo path, then fall back to synchronized sequential rendering when game assumptions break native stereo.
- Keep render strategy, camera strategy, input adaptation and UI conversion independently selectable.
- Use broad generic machinery first, then isolate title-specific overrides instead of forking the whole runtime.
- Treat compatibility as evidence per title and renderer rather than a universal claim.
- Preserve a 2D fallback and reversible injection path for diagnosis and comfort.

## Stephanos relevance

### Flat-game VR

This source can inform Starfield and future Unreal-target research by providing a comparative model for generic injection, configurable render modes, camera decoupling and profile-driven adaptation.

### Spatial Bridge

The plugin, object-reflection and runtime-selection patterns may inform bounded extension points for a future Quest client, but UEVR is not a direct architectural template for Stephanos authority or mission state.

## Evidence and licence boundary

The repository's root licence is all-rights-reserved. Stephanos may preserve metadata, commit identity, public release behaviour and independently written analysis. It must not copy source, substantial documentation or binaries into canonical knowledge without separate permission.

## Initial questions for the Capability Graph

1. Which UEVR render modes map to known classes of stereo failure?
2. Which parts of camera decoupling are engine-generic versus profile-specific?
3. How does UEVR preserve temporal effects in native stereo and what breaks in sequential modes?
4. Which UI conversion techniques are reusable outside Unreal?
5. What profile evidence best predicts whether a title needs bespoke intervention?
