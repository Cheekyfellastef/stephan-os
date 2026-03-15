# RAGE Engine Rendering Pipeline (Placeholder)

## Scope

Track RAGE rendering architecture details that impact flat-to-VR conversion.

## Research Questions

- What is the frame graph / pass ordering for scene + post-processing?
- Where can stereo rendering be injected safely?
- Which effects are likely incompatible with VR depth/comfort?
- What are key frame pacing constraints?

## Hook Candidates

- View/projection setup functions
- Render pass orchestration points
- Present/swap-chain timing controls

## Evidence Links

- RenderDoc captures:
- PIX captures:
- Ghidra function map:
- Frida runtime probes:

## Notes

_Add findings, constraints, and proposed reusable modules here._
