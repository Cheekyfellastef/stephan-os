# Starfield VR Track (Starter)

## Mission Focus
Establish a seated-first **Cockpit Mode** path for Starfield that can evolve into broader flat-to-VR conversion techniques reusable across engines.

## First Capture Checklist
1. Baseline camera model and player view assumptions.
2. Rendering pipeline stages most likely to break stereo output.
3. HUD/UI layers that need spatial anchoring or comfort-preserving projection.
4. Input map viability for seated VR controls.
5. Frame pacing constraints that block stable VR comfort.

## Where to Record Findings
- Technique updates: `VR-Research-Lab/docs/vr-techniques/`
- Experiment details: `VR-Research-Lab/docs/experiment-logs/`
- Reusable outputs: `VR-Research-Lab/modules/`

## Controlled launch surface

`desktop-launcher.md` defines the fail-closed Windows shortcut named **Starfield VR**. It launches only a provider, game build and Quest 3 Meta Air Link route that #1595 has bound to exact evidence. The current VorpX experience remains a separately verified fallback while `mutar-openxr` is the preferred native-style path.
