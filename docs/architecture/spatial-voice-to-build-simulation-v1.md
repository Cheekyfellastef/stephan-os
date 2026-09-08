# Spatial Voice-to-Build Simulation V1

## Purpose

This source-only slice advances #1760 toward the headset interaction loop without adding a speech provider, Quest runtime, command executor, scheduler, worker or mutation path.

A spoken transcript becomes data that can be proposed as an existing `stephanos.spatial-build-order.v1` record. Voice itself never becomes execution authority.

## Context model

The proposal can carry references to:

- mission, planet and region;
- selected objects;
- conversation/location references;
- gaze target;
- controller target.

Gaze, controller and selection values are context only. They do not infer `ownedResourceScopes`. The caller must provide an explicit bounded proposed scope, and the proposal remains `SCOPE_CONFIRMATION_REQUIRED` until that scope is explicitly confirmed.

## Authority boundary

The adapter always reports:

- `rawVoiceExecutionAllowed=false`;
- `gazeAuthorityAllowed=false`;
- `controllerTargetAuthorityAllowed=false`;
- no source mutation, lease issue, asset generation, merge, deployment or runtime mutation authority.

Command-like or hostile words inside the transcript are preserved only as operator-request text. They cannot expand the fixed M1 allowed-operation vocabulary.

## Next use

A later headset adapter may supply the transcript and spatial context. The result can enter Shared Workspace as a proposal and then pass through the normal Foundry build-order, genome, lease, validation, preview and approval gates.
