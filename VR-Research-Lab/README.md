# VR-Research-Lab

A private research repository for studying how to convert traditional "flat" games into robust, reusable virtual reality experiences.

## Purpose

The **VR Research Lab** is a structured environment for:

- Investigating VR mods and implementation strategies.
- Reverse-engineering rendering and camera systems in major game engines.
- Extracting repeatable patterns into reusable flat-to-VR modules.
- Building a practical knowledge base that will feed into the broader **Stephanos** ecosystem.

Initial focus projects include:

- Starfield VR mod analysis
- Red Dead Redemption 2 VR mod analysis
- Reusable technique extraction across engines and titles

## Primary VR Target: Seated VR (Cockpit Mode)

Current target interaction model:

- **Headset** controls camera orientation (head-tracked look)
- **Xbox controller** handles gameplay input
- Motion controls and room-scale support may be explored later

## The Flat-to-VR Conversion Problem

Most flat games are not designed for stereoscopic rendering, head-tracked cameras, or low-latency VR presentation. Typical conversion challenges include:

- Camera system incompatibilities (third-person/first-person assumptions)
- Mono rendering pipelines and post-process chains
- Timing, prediction, and frame pacing constraints
- Input model mismatch between game controls and VR expectations
- UI/HUD projection and depth comfort issues

This lab documents where those issues surface and how to solve them in a modular way.

## Investigation Workflow

1. Select a game / target engine and gather artifacts.
2. Map engine architecture and rendering flow.
3. Identify VR hook points (camera, render targets, input, timing).
4. Prototype techniques and validate with tooling.
5. Extract reusable modules and document outcomes.

### Research Workflow Diagram

```text
Game
↓
Engine analysis
↓
VR hook identification
↓
Technique extraction
↓
Reusable VR module
```

## Tooling Integration

The research process is designed to incorporate:

- **RenderDoc** for GPU frame captures and render pass inspection
- **PIX** for DirectX pipeline debugging and performance analysis
- **Ghidra** for static binary reverse engineering
- **Frida** for runtime instrumentation and hook experimentation

See detailed workflow guidance in:

- [`docs/research-notes/tooling-integration-workflow.md`](docs/research-notes/tooling-integration-workflow.md)

## Stephanos Integration Path

Discoveries from this lab are intended to become production-ready assets for the **Stephanos VR Bridge**, including:

- Engine-specific hook maps
- Reusable rendering/camera/input modules
- Validation checklists and experiment evidence
- Risk/compatibility notes for integration planning

## Repository Structure

```text
VR-Research-Lab/
├── docs/
│   ├── research-notes/
│   ├── engine-architecture/
│   ├── vr-techniques/
│   └── experiment-logs/
├── examples/
│   ├── starfield-vr/
│   ├── rdr2-vr/
│   └── other-vr-mods/
├── tools/
│   ├── frame-analysis/
│   ├── reverse-engineering/
│   ├── instrumentation/
│   └── ai-analysis/
├── modules/
│   ├── camera-injection/
│   ├── stereo-rendering/
│   ├── depth-reconstruction/
│   ├── geometry-interception/
│   └── input-hooks/
├── engine-maps/
│   ├── creation-engine/
│   ├── rage-engine/
│   └── unreal-engine/
└── experiments/
    ├── rendering-tests/
    ├── camera-tests/
    └── vr-performance-tests/
```
