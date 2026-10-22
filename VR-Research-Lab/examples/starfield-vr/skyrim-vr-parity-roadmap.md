# Starfield VR: Skyrim VR Parity Roadmap

## Mission

Turn Starfield from a convincing stereoscopic seated experience into a VR-native-feeling conversion, using modded Skyrim VR as the quality benchmark while preserving a seated-first Xbox-controller path.

## User baseline

- Hardware target: Quest 3 PCVR
- Current experience: VorpX pseudo-VR with Xbox controller
- Preferred initial posture: seated cockpit mode
- Quality reference: modded Skyrim VR
- Long-term option: motion controllers and embodied interaction

## What "Skyrim VR quality" means

The target is not merely stronger stereoscopic depth. The benchmark is a coherent embodiment stack:

1. low-latency six-degree-of-freedom head tracking
2. correct world scale, eye separation and camera origin
3. stable geometric stereo without alternate-eye artefacts
4. head aim decoupled from weapon and body orientation
5. VR-readable HUD, menus, terminals and ship interfaces
6. stable frame pacing and comfort controls
7. tracked hands and weapon poses
8. body inverse kinematics
9. physical object interaction and collision-aware hands
10. VR-native aiming, scopes, melee and interaction prompts

## Delivery ladder

### Stage 0: Reproducible VorpX baseline

Record the present working setup before replacing it.

- game build and storefront
- VorpX version and profile
- headset runtime and connection path
- render resolution and refresh rate
- graphics, upscaling and frame-generation settings
- controller mappings
- known visual defects, latency and comfort limits
- repeatable benchmark save and route

Exit condition: one-command or one-checklist restoration of the known-good pseudo-VR setup.

### Stage 1: Native OpenXR presentation prototype

Goal: replace the external pseudo-VR presentation path with an instrumentable OpenXR path.

Research tasks:

- inspect DirectX 12 swap-chain creation and present path
- map Creation Engine 2 camera transforms
- identify projection-matrix and render-target hook points
- test sequential stereo, duplicated passes and geometry reconstruction options
- establish OpenXR session, view and frame lifecycle
- capture RenderDoc/PIX evidence where tooling permits

Exit condition: stable headset presentation and rotational/positional tracking in a controlled test scene.

### Stage 2: Correct camera, scale and stereo

- decouple headset pose from gamepad look
- establish seated recenter and configurable standing height
- correct near clip, weapon camera, viewmodel scale and cockpit scale
- remove or classify screen-space and temporal effects that break per-eye rendering
- handle photo mode, dialogue, ladders, seats, ships and third-person transitions

Exit condition: exploration and ship cockpit traversal feel spatially coherent without eye strain.

### Stage 3: VR UI and interaction bridge

- project HUD at comfortable depth
- create readable treatment for inventory, starmap, dialogue and terminals
- map gaze or controller-ray selection without breaking Xbox navigation
- define diegetic treatment for scanner, digipicks and ship panels

Exit condition: the complete main gameplay loop is usable without removing the headset.

### Stage 4: Combat-grade seated VR

- independent head and weapon aim
- dominant-eye reticle and two-eye alignment tests
- VR-safe recoil, camera shake and hit effects
- scope and ADS replacement
- grenade trajectory and melee comfort
- optional head-directed versus gamepad-directed locomotion

Exit condition: a representative ground combat mission and ship battle are comfortable and competitive with the VorpX baseline.

### Stage 5: Embodiment

- OpenXR motion-controller input
- tracked hand and weapon poses
- holsters and contextual interaction points
- upper-body then full-body IK
- physical grabbing and collision-aware hands
- two-handed weapons, melee and object manipulation

Reference patterns should be extracted from public projects such as VRIK/HIGGS-style Skyrim VR systems, REFramework VR, UEVR, Unity VR conversions and HaloCEVR, subject to licence and provenance policy.

Exit condition: Starfield supports an optional motion-controller mode that feels designed rather than bolted on.

## Architecture workstreams

- `runtime/openxr`: session, swapchains, views, timing and runtime compatibility
- `hooks/dx12`: factory, device, queue, swapchain and presentation interception
- `engine/creation-engine-2`: camera, player, animation, UI and input maps
- `rendering/stereo`: per-eye matrices, culling, shadows, post-processing and temporal history
- `interaction/seated`: Xbox input, head decoupling, recenter and comfort
- `interaction/motion`: controller actions, hand poses, grabbing and haptics
- `ui/spatial`: HUD, menus, terminals and cockpit panels
- `avatar/ik`: head, hands, weapon anchors and body solving
- `validation`: frame pacing, latency, visual correctness and regression captures

## Evidence rules

Every experiment records:

- exact game and dependency revisions
- hardware/runtime configuration
- hook or address provenance
- screenshots or captures where legally distributable
- measured frame timing
- success, failure and rollback path
- reusable technique extracted

## Initial engineering questions

1. Can the existing Starfield Script Extender/plugin ecosystem provide a sufficiently stable in-process foothold, or is a graphics-layer injector required first?
2. Which camera and projection data can be reached without hard-coded addresses?
3. Does Creation Engine 2 permit true per-eye render passes at acceptable cost?
4. Which temporal and screen-space systems require per-eye history or disabling?
5. Can ship cockpit and on-foot modes share one pose and scale model?
6. What is the smallest slice that beats VorpX clearly: positional tracking, cleaner stereo, or decoupled aiming?

## First milestone

Deliver a documented, reversible prototype that:

- starts Starfield through a controlled launcher
- initializes OpenXR on Quest 3
- presents a stable test image
- reads headset pose
- applies pose to a mapped camera path
- records frame timing and failures
- leaves the existing VorpX setup untouched
