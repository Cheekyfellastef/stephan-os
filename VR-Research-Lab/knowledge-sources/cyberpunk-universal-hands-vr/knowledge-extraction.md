# Cyberpunk Universal Hands VR

Status date: 2026-08-05  
Priority: P1  
Evidence class: operational and interface evidence with unresolved source-licence pin

## Useful method

The project separates the source of hand tracking from the game-specific skeleton adapter. External tracking producers write controller positions and rotations to a bounded shared-memory map; the Cyberpunk adapter consumes those poses and applies them to a full-arm IK solver.

```text
OpenXR / SteamVR / BodyWalkVR / custom tracking producer
→ versioned bounded pose contract
→ shared-memory transport
→ title-specific skeleton adapter
→ arm IK and calibration
```

That boundary is valuable to Stephanos because a Quest/OpenXR tracking provider should not need to know how Starfield represents shoulders, elbows, wrists or weapon attachments.

## Capability Graph candidates

- transport-neutral tracking producer interface;
- bounded low-latency shared-memory pose exchange;
- title-specific skeleton adaptation;
- two-bone arm IK;
- per-hand position and rotation calibration;
- persistent reach and offset configuration;
- head-relative locking during forced camera motion;
- runtime enable/disable controls.

## Safety and provenance boundary

The Nexus package describes itself as free and open-source, but the currently admitted evidence does not pin a public repository and permissive licence file. Nexus permissions prohibit redistribution and modification without permission. Treat this as method and behaviour evidence only until the source and licence are independently resolved.

## Relationship to CyberpunkVR Port

This is a companion and alternative tracking adapter, not a replacement architecture for the complete CyberpunkVR Port. Keep stereo rendering, tracking transport, embodiment, gameplay adaptation and title-specific skeleton work as independently selectable modules.

## Starfield relevance

A future Starfield embodiment layer could consume the same canonical Stephanos hand-pose contract regardless of whether poses originate from Quest controllers, OpenXR hand tracking, SteamVR or a later body-tracking system. The Starfield skeleton and gameplay bindings would remain a separate adapter with separate tests and rights.
