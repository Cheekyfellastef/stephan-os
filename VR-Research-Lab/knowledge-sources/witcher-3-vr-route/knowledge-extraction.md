# The Witcher 3 VR Route

Status date: 2026-08-05
Priority: P1
Evidence class: title-specific route synthesis and creator field evidence

## Why this source family matters

The Witcher 3 demonstrates a different conversion grammar from CyberpunkVR Port. Rather than beginning with a complete open engine integration, the route appears to combine:

```text
third-person game
→ first-person camera and animation adaptation
→ stereo/head-tracking presentation layer
→ headset-level setup and comfort tuning
```

This route is valuable because many resistant games may become compelling through a carefully composed stack even when a native OpenXR conversion is unavailable.

## Evidence planes

### The Witcher 3

The proprietary game defines the camera, combat, animation, dialogue, menu and cutscene constraints. Game-version compatibility must remain explicit.

### Gervant First Person

The first-person mod supplies camera and presentation options, including hybrid camera behaviour and adjustments intended to reduce clipping or animation problems. Its restrictive permissions make it an operational reference rather than a code-reuse source.

### vorpX

vorpX supplies proprietary VR presentation and profile behaviour. Store public metadata, observed settings and operator evidence only. Do not infer internal implementation.

### VoodooDE VR English

The current operator-reported Witcher 3 showcase supplies discovery and headset-level evidence. The exact video ID, tested versions, headset, runtime and settings are pending extraction and must remain visibly unresolved.

## Questions for showcase extraction

- Which Witcher build and first-person mod version were used?
- Was the route Geometry 3D, Z3D, alternate-eye or another presentation mode?
- Which headset, runtime and streaming transport were used?
- How are combat, horseback movement and third-person animations handled?
- What happens during dialogue, cutscenes, menus, inventory and map use?
- Are head tracking and game camera fully decoupled?
- What clipping, nausea, flicker or performance caveats appear?
- Does the route remain comfortable for a sustained session?

## Capability Graph candidates

- composable title-route planning;
- first-person camera adapters for third-person games;
- hybrid camera policies by activity;
- proprietary presentation-layer interoperability;
- scene-specific fallback for dialogue and cinematics;
- creator-driven comfort and usability evidence;
- route acceptance conditioned on exact game/mod/runtime versions.

## Starfield relevance

Starfield may ultimately use a more native OpenXR route, but Witcher provides useful evidence for bounded fallbacks and hybrid presentation. A title can remain spatially compelling even when some activities use first person, some use a room-fixed theatre and some retain a carefully controlled third-person or spatial-screen mode.

## Acceptance boundary

Registration means the route is worth studying. It does not mean Stephanos has verified the current showcase, owns the required software, or has proven the route on Quest 3 through Meta Air Link.
