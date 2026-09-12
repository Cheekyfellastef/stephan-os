# Halo AI-Assisted VR Research Note

Last verified: 2026-07-24

## Current evidence

### Halo: Combat Evolved

A public source repository exists for **HaloCEVR** under `LivingFray/HaloCEVR`. This is the strongest current Halo training source because its implementation can be inspected directly, subject to its recorded licence and revision.

Known public release notes and documentation describe work including:

- VR camera and projection handling
- UI overlay scaling and aspect correction
- aiming smoothing
- scoped-view corrections
- left-handed bindings and weapon-hand switching
- support for Halo Custom Edition

Primary source: https://github.com/LivingFray/HaloCEVR

### Halo 3 in The Master Chief Collection

A newly reported project describes a native OpenXR VR mod for Halo 3 in the Steam edition of The Master Chief Collection. The author states that every line of code was produced by Anthropic Claude and OpenAI Codex under human direction.

This is important evidence for the Lab because it demonstrates an AI-directed workflow for a difficult, game-specific VR conversion. However, the Lab must not claim access to private model sessions, private prompts, unpublished reverse-engineering notes, or any non-public code.

Public report currently recorded:

- https://vrforum.de/threads/halo-3-the-master-chief-collection.14490/

## Verification gaps

Before code-level ingestion, locate and verify:

1. the canonical Halo 3 repository or release page
2. the source licence
3. the exact supported MCC build and anti-cheat posture
4. the OpenXR loader and graphics API hook path
5. whether claimed motion-controller, IK, dual-wield, vehicle, and multiplayer features are present in the public build
6. whether the implementation contains generated third-party code with additional licence obligations
7. the exact AI workflow: task decomposition, test loop, debugging evidence, human review, and validation process

Until these are verified, Halo 3 remains **source availability to verify**, not an open-source training corpus.

### Halo 2

Halo 2 VR work has been publicly discussed, but no canonical implementation has yet been recorded in this Lab. Treat it as an **unverified lead** until a primary repository, release, or developer statement is captured.

## Reusable research questions

When the Halo 3 code is located, compare it with HaloCEVR across these layers:

- process/module injection
- graphics API interception
- OpenXR instance/session/swapchain lifecycle
- per-eye projection generation
- camera ownership and decoupling from weapon aim
- animation and first-person body handling
- weapon transforms and two-handed constraints
- UI extraction and composition layers
- cutscene and vehicle camera transitions
- input abstraction and controller bindings
- frame pacing, prediction, and late update
- multiplayer and anti-cheat boundaries
- build-version resilience and signature scanning

## AI-assisted implementation pattern to extract

The useful lesson is not merely that AI wrote code. The Lab should reconstruct the engineering loop:

1. human defines one bounded observable goal
2. AI maps likely hook points and proposes instrumentation
3. build produces logs or visual proof
4. human reports exact failure evidence
5. AI patches one layer at a time
6. regression checks preserve already-working behaviour
7. discoveries are promoted into engine maps and reusable modules

This pattern fits the Stephanos operating model: the user remains at intent, judgment, and approval while AI performs bounded implementation and evidence collection.

## Proposed first Halo workstream

1. Pin and catalogue HaloCEVR.
2. Generate a repository architecture map.
3. Identify OpenXR, camera, projection, UI, input, and weapon subsystems.
4. Record build requirements without copying game content.
5. Create a cross-title Halo hook map.
6. Add Halo 3 only after canonical source and licence verification.
7. Use the comparison to define a safe, original seated/gamepad Halo prototype path for the VR Research Lab.
