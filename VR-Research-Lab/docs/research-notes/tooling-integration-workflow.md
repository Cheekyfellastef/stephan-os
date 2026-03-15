# Tooling Integration Workflow

This document defines how to use analysis tooling consistently during flat-to-VR research.

## Objectives

- Capture evidence for rendering and camera behavior.
- Identify hook candidates with static + dynamic analysis.
- Validate assumptions quickly before extraction into reusable modules.

## Recommended Tool Roles

### RenderDoc (GPU Frame Capture)

Use for:

- Inspecting draw calls and render target transitions
- Understanding depth buffer usage
- Tracing post-processing passes relevant to VR stereo compatibility

Suggested workflow:

1. Capture representative gameplay frames.
2. Label key passes (main scene, UI, post-effects).
3. Track where camera matrices and projection transforms affect output.
4. Record findings in `docs/engine-architecture/` and `engine-maps/`.

### PIX (DirectX Debugging)

Use for:

- GPU/CPU timing analysis
- DirectX pipeline state inspection
- Diagnosing frame pacing constraints for VR targets

Suggested workflow:

1. Capture baseline frame timing in normal play.
2. Compare timing before/after prototype hooks.
3. Flag VR-incompatible bottlenecks in `experiments/vr-performance-tests/`.

### Ghidra (Binary Reverse Engineering)

Use for:

- Static analysis of engine/game binaries
- Locating camera update paths, render orchestration, and input processing
- Building symbol/function maps when source code is unavailable

Suggested workflow:

1. Identify candidate functions for camera/render pipeline control.
2. Document function signatures and call graph notes.
3. Store map outputs in `engine-maps/<engine>/`.

### Frida (Runtime Instrumentation)

Use for:

- Dynamic hook validation at runtime
- Intercepting camera transforms and input handlers
- Experimenting with non-destructive patching before native module work

Suggested workflow:

1. Attach to target process in a controlled scenario.
2. Instrument candidate functions discovered via Ghidra.
3. Log runtime behavior and verify hook stability.
4. Promote validated ideas into `modules/` prototypes.

## End-to-End Investigation Loop

1. **Frame-first analysis** (RenderDoc/PIX) to understand visible behavior.
2. **Static mapping** (Ghidra) to identify likely code-level control points.
3. **Runtime probing** (Frida) to verify hook points quickly.
4. **Module extraction** into reusable camera/render/input components.
5. **Documentation pass** so each technique can be transferred to Stephanos.

## Documentation Checklist per Experiment

- Target game and build/version
- Engine and subsystem under analysis
- Tool captures/logs produced
- Confirmed hook points
- Known risks / failure modes
- Candidate reusable module(s)
- Integration notes for Stephanos VR Bridge
