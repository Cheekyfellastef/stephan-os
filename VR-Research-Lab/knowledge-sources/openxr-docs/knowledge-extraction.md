# OpenXR Specification Knowledge Extraction Brief

## Role in the source stack

This is the normative reference for OpenXR behaviour, terminology, lifecycle rules, interaction profiles, composition layers and extensions. It is the authority used to challenge assumptions found in mods, middleware and runtime experiments.

## Capability candidates

- Normative application and runtime lifecycle requirements.
- View configurations and composition-layer semantics.
- Reference spaces, spatial anchors and persistence.
- Actions, interaction profiles and binding rules.
- Controller, hand, gaze and body-related extensions.
- Runtime, loader and API-layer contracts.
- Extension maturity: core, ratified multi-vendor and vendor-specific.
- Error, loss-pending, focus and session-state handling.

## Method candidates

- Label every OpenXR claim as normative, implementation evidence or project-specific interpretation.
- Prefer core or ratified multi-vendor functionality when it satisfies the requirement.
- Gate vendor extensions behind capability discovery and reversible fallbacks.
- Track extension revision, promotion and supersession instead of treating names as timeless.
- Turn lifecycle and threading requirements into executable verification checks.

## Stephanos relevance

### Flat-game VR

The specification allows the lab to identify whether a conversion issue is caused by a game, a mod, an API layer, a runtime or a genuine OpenXR constraint.

### Spatial Bridge

This is the primary source for the future Quest client's spaces, input, composition, reconnect and spatial-persistence design. Spatial Bridge goals should cite the relevant specification version and extension status.

## Licence boundary

OpenXR-Docs uses mixed per-file licensing and Khronos specification copyright terms. Each file header or adjacent licence file controls. Stephanos should retain references, version identities and original analysis rather than mirror the specification wholesale.

## Initial questions for the Capability Graph

1. Which spatial features required by the bridge are core versus extensions?
2. What is the correct response to session loss, runtime loss or device disconnect?
3. Which interaction profile provides the safest controller fallback?
4. Which anchor and persistence extensions are sufficiently portable?
5. Which extension dependencies create avoidable headset or runtime lock-in?
