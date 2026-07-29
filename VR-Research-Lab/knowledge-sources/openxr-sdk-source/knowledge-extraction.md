# OpenXR SDK Source Knowledge Extraction Brief

## Role in the source stack

This is the authoritative implementation reference for OpenXR application, loader and API-layer behaviour. It anchors interpretations drawn from mods and frameworks against the standard ecosystem's actual sample and loader machinery.

## Capability candidates

- Loader discovery and runtime negotiation.
- Instance, system, session and frame lifecycle.
- Reference spaces, view location and pose handling.
- Swapchain creation, acquisition, submission and composition layers.
- Action sets, bindings and interaction profiles.
- API-layer interception and chaining.
- Graphics API integration and validation.
- `hello_xr` as a minimal conforming application reference.

## Method candidates

- Resolve ambiguous third-party behaviour against an authoritative sample or loader path.
- Separate application responsibilities, loader responsibilities, API-layer responsibilities and runtime responsibilities.
- Model lifecycle as explicit states and legal transitions rather than loosely ordered callbacks.
- Preserve extension negotiation and failure results as first-class evidence.
- Build the smallest conforming reference path before adding engine-specific machinery.

## Stephanos relevance

### Flat-game VR

The SDK lets Stephanos distinguish correct OpenXR behaviour from mod-specific convention and provides a stable target for evaluating session, frame, space, input and API-layer implementations.

### Spatial Bridge

It is foundational for the future Quest client: session lifecycle, spaces, composition layers, controller actions, disconnect handling and extension negotiation should be designed from this source and the normative specification, not copied from a game mod.

## Licence

Apache-2.0 at repository level with per-file notices. Preserve licence and NOTICE obligations for any copied or adapted substantial material.

## Initial questions for the Capability Graph

1. Which responsibilities belong to the future spatial client versus the OpenXR runtime?
2. Which API-layer patterns are relevant to observability and performance tooling?
3. Which lifecycle failures require reconnect, recreation or full shutdown?
4. Which reference-space choices best support stable seated world-locked presentation?
5. Which extensions are core, ratified multi-vendor, vendor-specific or experimental?
