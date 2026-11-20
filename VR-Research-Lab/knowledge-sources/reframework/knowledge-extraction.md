# REFramework Knowledge Extraction Brief

## Role in the source stack

REFramework is the shared-engine framework reference. It demonstrates how one native interception, scripting and plugin platform can support many related games while retaining per-title adapters and VR behaviour.

## Capability candidates

- Native mod-loader lifecycle and safe attachment.
- DirectX 11 and DirectX 12 interception.
- Generic 6DOF VR support across a shared engine family.
- Per-title motion-control and gameplay adaptations.
- Lua scripting and native plugin extension surfaces.
- Runtime object inspection and engine reflection.
- Shared configuration, UI and diagnostics.
- Separation of common engine machinery from title-specific behaviour.

## Method candidates

- Build a stable shared engine core, then add bounded title adapters.
- Expose scripting for fast experimentation while retaining native plugins for performance-critical paths.
- Keep VR support as capabilities layered over the mod framework rather than a disconnected product.
- Preserve title-specific evidence even when games share an engine.
- Use one diagnostic and configuration surface across adapters to reduce repeated operator work.

## Stephanos relevance

### Flat-game VR

REFramework provides a strong comparison with Halo MCC VR: one is organised around a shared commercial engine and the other around several related title modules. Comparing both can reveal which lifecycle, capability and adapter patterns generalise beyond either project.

### Spatial Bridge

Its plugin and scripting boundaries may inform future bounded extension contracts, while its separation between common runtime services and title adapters resembles the desired separation between canonical Stephanos state and thin spatial presentation modules.

## Licence

MIT. Preserve the upstream copyright and permission notice with any copied or adapted substantial material.

## Initial questions for the Capability Graph

1. Which services belong in a shared engine runtime versus a title adapter?
2. When should an experiment remain scripted, and when should it become native code?
3. Which diagnostics are reusable across all adapters?
4. How are VR capabilities withheld or specialised for unsupported titles?
5. Which reflection techniques reduce brittle fixed-offset bindings?
