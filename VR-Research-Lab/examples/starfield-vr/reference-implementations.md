# Starfield VR Reference Implementations

## Purpose

This note records external flat-to-VR work that can inform the Starfield programme without implying that closed-source software is available for copying or redistribution.

## Evidence classes

1. **Public source**: code and documentation that may be inspected subject to its licence.
2. **Public technical documentation**: implementation descriptions, settings, release notes and observed behaviour.
3. **Black-box reference**: closed software that may be evaluated through lawful use, configuration, output capture and controlled experiments, but not decompiled or redistributed unless permission and law clearly allow it.
4. **User-owned baseline**: the user's own lawful installation, settings, observations and performance captures.

## MutaR / NoMoreFlat / VRto3D

### Starfield relevance

MutaR's NoMoreFlat Starfield profile is the most directly relevant current reference because it targets Starfield through OpenXR and documents practical limitations.

Reported behaviours to reproduce and measure:

- alternate-eye rendering
- stereo instability during lateral camera motion
- dominant-eye cursor alignment
- non-dominant-eye aiming offset
- scope misalignment
- separate depth and convergence settings for ordinary first-person play and aiming down sights
- runtime profile switching and reset controls

### Research use

Treat the public profile, release notes and any licence-compatible source as direct research material. Preserve exact release identifiers and licences before importing code. Use the documented limitations as acceptance tests for our own renderer.

### Starfield acceptance questions

- Can both eyes represent the same simulation instant?
- Can weapon sights and scopes be geometrically correct in both eyes?
- Can aim direction be decoupled from head direction without breaking controller play?
- Can ADS use correct camera and projection transforms rather than only changing depth parameters?
- Can frame pacing avoid alternate-eye temporal disparity?

## Luke Ross / R.E.A.L. VR

### Available public material

Luke Ross's historical GTA V R.E.A.L. repository and documentation expose valuable engineering lessons even where newer framework code is unavailable.

Documented techniques and design choices include:

- alternate-eye rendering as a performance compromise
- asynchronous runtime reprojection for head rotation
- forced or corrected camera field of view
- positional head tracking layered over a non-VR game camera
- configurable dominant-eye aiming
- heading and pitch-control modes
- decoupled third-person camera behaviour
- view-matrix correction
- multiple cutscene comfort modes
- head-locked, fixed and adaptive HUD modes
- recentering and runtime developer controls
- capturing an internal high-resolution render buffer rather than only the final backbuffer
- strict graphics-profile management and reversible configuration

### Research use

Public code and documentation may be studied according to their licences. Unavailable, withdrawn, paywalled or access-controlled framework releases must not be copied into the corpus. Their externally observable behaviour and openly published technical explanations may be recorded with provenance.

### Lessons for Starfield

- Exact headset-compatible FOV is a core correctness requirement, not a cosmetic option.
- Camera transitions and cutscenes require explicit VR modes.
- Alternate-eye rendering buys performance by introducing temporal stereo error; it should be a fallback, not the parity target.
- Internal render targets are often more useful than post-processing the final desktop backbuffer.
- A good conversion requires runtime controls for recentering, stereo mode, HUD placement, aiming eye and camera policy.

## VorpX

### Classification

VorpX is a proprietary black-box reference. Do not attempt to copy its binaries, bypass protections or claim access to its implementation.

### Lawful research value

The user's existing licensed Starfield setup can provide:

- a reproducible baseline for perceived depth and scale
- working game launch and headset-routing behaviour
- known-good input and seated-controller ergonomics
- profile settings and sensitivity ranges
- frame-time and latency captures
- screenshots or headset captures of UI and stereo defects
- observations of Z3D behaviour under DX12
- before-and-after comparisons for FOV, viewmodel scale and convergence

### Black-box experiment protocol

For each controlled test:

1. Record game, VorpX, GPU driver and runtime versions.
2. Pin the save location and repeatable movement path.
3. Change one setting only.
4. Capture frame timing, desktop output and headset observation.
5. Record comfort, scale, aiming and UI outcomes.
6. Restore the baseline profile after the test.

### Boundary

We may learn from behaviour, configuration and public documentation. We must independently implement our own code and avoid reproducing proprietary implementation details obtained through prohibited access.

## Comparative benchmark matrix

| Capability | VorpX baseline | MutaR target/reference | Luke Ross lesson | Our target |
|---|---|---|---|---|
| OpenXR presentation | Observe | Documented | Framework-dependent | Native controlled path |
| Stereo method | Z3D/pseudo stereo | Alternate eye | Alternate eye documented | Same-instant stereo preferred |
| 6DOF head pose | Limited/profile-dependent | Verify | Documented position tracking | Stable native 6DOF |
| Head/aim separation | Limited | Dominant-eye workaround | Configurable heading/aim modes | Independent head and weapon aim |
| Scopes | Baseline defects | Misalignment documented | Dominant-eye controls | Binocular-correct or explicit VR scope mode |
| HUD | Virtual/profile view | Verify | Multiple HUD tracking modes | Spatial, readable, mode-aware HUD |
| Cutscenes | Virtual cinema/profile behaviour | Verify | Dynamic stereo/flat comfort modes | Explicit comfort policy |
| Frame pacing | Capture | Alternate-eye limitations | Temporal stereo trade-off | Measured stable VR pacing |

## Immediate next experiments

1. Capture the user's current VorpX Starfield profile and baseline.
2. Install MutaR's current public Starfield release only after pinning source, release and licence provenance.
3. Run the same save-route benchmark through VorpX and MutaR.
4. Extract measurable defects into the Starfield acceptance suite.
5. Use Luke Ross's public GTA V documentation to expand camera, HUD, cutscene and runtime-control requirements.
