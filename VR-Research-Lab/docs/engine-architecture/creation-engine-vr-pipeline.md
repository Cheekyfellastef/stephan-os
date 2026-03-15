# Creation Engine VR Pipeline (Placeholder)

## Scope

Document rendering and camera pipeline behavior in Creation Engine relevant to seated VR conversion.

## Research Questions

- Where is the primary camera update executed each frame?
- How are projection matrices generated and applied?
- Which render passes are stereo-sensitive?
- How is HUD/UI composited, and can it be depth-aware?

## Hook Candidates

- Camera transform update path
- Projection matrix generation points
- Render target submission chain

## Evidence Links

- RenderDoc captures:
- PIX captures:
- Ghidra function map:
- Frida runtime probes:

## Notes

_Add analysis findings and validated hook points here._
