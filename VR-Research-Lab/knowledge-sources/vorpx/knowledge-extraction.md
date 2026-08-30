# vorpX knowledge extraction

Status: registered P0 proprietary operational source.

## Why this source is distinct

vorpX demonstrates a long-lived commercial approach to making many unrelated flat games useful in headsets through a shared driver, per-game profiles and bounded automation rather than bespoke native VR code for every title.

## Capability Graph candidates

- Graphics-API interception across DirectX generations and selected OpenGL titles.
- Profile inheritance based on renderer and engine similarity.
- Geometry stereo versus depth-derived stereo versus immersive-screen presentation.
- DirectVR automation for field of view, resolution, camera rotation and head tracking.
- Decoupling headset presentation from the game's native input model.
- Cloud-profile discovery and local profile tuning.
- Gesture-to-key or gesture-to-gamepad translation.
- Compatibility classification across game version, graphics driver, runtime, headset and profile revision.

## Method Library candidates

1. **Profile-first compatibility triage**
   - Identify renderer and engine family.
   - Start from a known related profile.
   - Separate hook success, stereo success, camera correctness and comfort.
   - Preserve game-specific overrides without contaminating the shared base.

2. **Direct adjustment before invasive hooks**
   - Prefer bounded configuration, FOV, resolution and camera corrections before title-specific binary intervention.

3. **Presentation ladder**
   - Native/geometry stereo where viable.
   - Depth-derived stereo when full geometry stereo is too costly or incompatible.
   - Immersive-screen mode when head-locked full VR would be uncomfortable or incorrect.

4. **Operational compatibility evidence**
   - Record exact game build, profile, runtime, GPU driver, headset route and observed failure mode.
   - Do not equate a supported-game listing with a verified local result.

## Relevance

### Flat-to-VR programme

Useful for quickly classifying whether a target needs deep native work or can first be explored through profiles, configuration and stereo presentation choices.

### Starfield VR

Provides comparison evidence for the user's existing seated Xbox-controller experience and for deciding which comfort and presentation behaviours should be preserved or replaced by native OpenXR work.

### Spatial Bridge

Only the configuration, profile, compatibility and presentation-ladder methods are relevant. Game injection and direct process intervention are not an authority model for Stephanos.

## Evidence boundary

vorpX is proprietary. Stephanos may store public metadata, operator-owned observations and independently authored conclusions. It must not mirror binaries, proprietary profiles or substantial vendor documentation.
