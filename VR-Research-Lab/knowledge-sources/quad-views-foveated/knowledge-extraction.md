# Quad-Views-Foveated Knowledge Extraction Brief

## Role in the source stack

Quad-Views-Foveated is the specialised performance reference. It demonstrates how an OpenXR API layer can translate quad-view application output into platform-compatible stereo presentation while using eye tracking or a fixed focus region to concentrate rendering effort.

## Capability candidates

- OpenXR API-layer interception and composition.
- Quad-view projection handling.
- Eye-tracked dynamic foveation and fixed foveation fallback.
- Independent focus and peripheral resolution budgets.
- Gaze-driven focus-region movement.
- Sharpening and blend controls.
- Per-application compatibility and exclusion policy.
- Runtime, graphics API and headset compatibility diagnostics.

## Method candidates

- Treat performance features as negotiated capabilities, not universal assumptions.
- Preserve an explicit disable or unadvertise path for incompatible applications.
- Measure focus-region quality, peripheral cost and transition artefacts separately.
- Keep headset, runtime, graphics API and application compatibility as independent evidence dimensions.
- Prefer instrumented frame-time evidence over subjective performance claims.

## Stephanos relevance

### Flat-game VR

This source can inform performance experiments for high-resolution PCVR targets, especially where the application or injected layer can produce the required view configuration.

### Spatial Bridge

The future Quest surface may benefit from foveation and layered-resolution strategies, but only after the base read-only client is stable and the selected Quest/OpenXR path supports the required capabilities. This is optimisation knowledge, not a prerequisite for the first bridge slice.

## Licence

MIT. Preserve the upstream copyright and permission notice with copied or adapted substantial material.

## Compatibility boundary

This is not a universal foveated-rendering injector. Application support for quad views and compatible runtime behaviour are required. Modern Unreal D3D12 titles have known compatibility hazards that must remain explicit in the Capability Graph.

## Initial questions for the Capability Graph

1. What application and runtime capabilities are prerequisites for quad views?
2. When does foveation reduce GPU cost without creating visible transition artefacts?
3. How should a system fail closed when the view configuration is unsupported?
4. Which telemetry proves a real end-to-end frame-time benefit?
5. Which parts of the API-layer pattern generalise to other observability or presentation layers?
