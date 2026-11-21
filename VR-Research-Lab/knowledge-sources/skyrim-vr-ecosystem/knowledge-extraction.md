# Skyrim VR native parity knowledge extraction

Status: registered P0 native interaction and modding benchmark.

## Why this source is distinct

Skyrim VR is not a flat-game conversion technique. It is a shipped native VR game whose community has spent years building the interaction layers missing from the base product. It therefore supplies the programme's strongest evidence for what a mature, embodied, moddable open-world VR experience can become.

## Capability ownership model

The Capability Graph must attribute every feature to the layer that provides it:

- **Skyrim VR base game:** native stereo, tracked-controller support, locomotion, combat, magic, menus and complete open-world content.
- **SKSE VR:** native plugin and scripting extension surface.
- **VRIK:** visible full body, inverse kinematics, calibration, gestures, holsters, drawing and sheathing, controller-touch hand animation.
- **HIGGS:** hand and weapon collision, two-handing, physical grabbing, throwing, gravity gloves, body manipulation, physical inventory/consumption interactions, physics fixes and mod APIs.
- **PLANCK:** physical character animation, contact and kinetics extending HIGGS interactions into NPC and combat behaviour.

## Capability Graph candidates

- Full-body avatar reconstruction from HMD and controllers.
- User calibration for height, scale, limb proportions and posture.
- Physical holsters and spatial inventory access.
- Gesture-driven commands that avoid menu interruption.
- Hand/finger pose selection from object geometry and contact.
- One-hand and two-hand weapon constraints.
- Object mass, collision and grab-state handling.
- Distance pull, catch, throw and consume interactions.
- Physics timestep adaptation to headset refresh and reprojection.
- Physical character response and melee contact.
- Plugin APIs that allow independently developed interaction layers to cooperate.
- Configuration and mod-list reproducibility across many interacting components.

## Method Library candidates

1. **Parity must name the provider**
   - A capability is not simply 'in Skyrim VR'.
   - Record whether it comes from the base game, SKSE, VRIK, HIGGS, PLANCK or another exact component.

2. **Embodied interaction layering**
   - Establish tracking and body representation first.
   - Add object interaction and collision.
   - Add character contact and kinetics.
   - Keep APIs between layers explicit so each remains replaceable.

3. **Calibration before polish**
   - User height, scale, controller offsets, handedness and seated/standing posture are first-class state.
   - Visual polish cannot compensate for an incorrectly calibrated body.

4. **Physical interaction fallback**
   - Preserve ordinary button and menu paths when physical grabbing, gestures or holsters fail.
   - Embodied convenience should not trap the player.

5. **Frame-rate-aware physics**
   - Physics correctness must account for refresh rate and reprojection rather than assuming a fixed desktop timestep.

6. **Mod-stack proof manifest**
   - Record exact game version, runtime, SKSE version, mod versions, configuration and load order.
   - A headset result is not reproducible without the complete stack identity.

## Starfield VR parity implications

The parity target should be decomposed rather than copied wholesale:

- **Foundation:** stable stereo, 6DoF head tracking, recentering and controller coexistence.
- **Body:** visible calibrated avatar and weapon alignment.
- **Interaction:** grabbing, holsters, two-handing and physical inventory shortcuts.
- **World:** object collision, throwing and responsive physics.
- **Characters:** bounded contact and physical reaction.
- **Extensibility:** APIs and configuration that let later mods add capability without patching one monolith.

Each slice should state which Skyrim component establishes the benchmark and what equivalent Starfield evidence would count as parity.

## Spatial Bridge relevance

Useful methods include calibration, seated/standing modes, spatial menus, gestures, holsters-as-information-placement, interaction fallbacks and layered extension APIs. Combat and game-specific physical systems are not direct bridge requirements.

## Evidence boundary

The base game is proprietary. HIGGS is GPL-3.0. SKSE, VRIK and PLANCK require their own permission and file-level checks. Stephanos may store public metadata, lawful operator observations and independently authored parity analysis without mirroring restricted files.
