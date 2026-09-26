# VR Source Stack Capability Unlocks

Status date: 2026-07-31

## Source stack

| Layer | Primary source | What it contributes |
|---|---|---|
| First proving target | Starfield | The first project intended to reach named Skyrim VR-quality parity |
| Authoring and engine evidence | Starfield Creation Kit | Creation Engine 2 records, forms, scripts, plugin structure and official authoring semantics |
| Local source and runtime intake | Battle Bridge Downloads via #1595 | Exact downloaded source packages, hashes, licence state, installed builds, logs and headset proof |
| Native interaction benchmark | Skyrim VR + SKSE/VRIK/HIGGS/PLANCK | Provider-owned parity for body, calibration, holsters, grabbing, collision, two-handing and character kinetics |
| Open Starfield implementation | Mutar / NoMoreFlat | Existing 6DoF, room scale, HUD, input, haptics and OpenXR/OpenVR Starfield implementation evidence |
| Commercial operational baseline | vorpX | Preserved profile-driven seated baseline, DirectVR and stereo fallback methods |
| Alternate-eye framework | Luke Ross R.E.A.L. VR | Shared multi-title alternate-eye and seated AAA conversion methods |
| Normative contract | Khronos OpenXR-Docs | Required lifecycle, spaces, views, actions, composition and extension semantics |
| Reference implementation | Khronos OpenXR-SDK-Source | Loader, API-layer and minimal application implementation evidence |
| Universal engine conversion | UEVR | Broad Unreal Engine injection, stereo, camera, UI and profile patterns |
| Shared engine framework | REFramework | Common native runtime with scripting, plugins and per-title adapters |
| Native multi-title case study | Halo MCC VR | Reverse engineering, capability ownership, exact-hash headset proof and AI-assisted delivery |
| Performance specialisation | Quad-Views-Foveated | API-layer foveation, quad views, compatibility gating and performance budgeting |
| Field compatibility telemetry | Paradise Decay | Large game-by-game headset catalogue covering UEVR, vorpX, first-person conversion, motion controls, room scale, comfort and failures |
| Tool and setup evaluation | VoodooDE | Hands-on tutorials, runtime configuration, setup friction, headset behaviour and one-click workflow evaluation |
| Cross-engine mod catalogue | PCVR Mods Installer Hub | Existing-mod discovery, installation, update, launch, rollback and capability metadata across many engines |
| Local game and engine discovery | Rai Pal | Multi-store library scanning, engine/version detection and universal-mod routing |
| Unreal profile orchestration | Unreal Easy Injector / UEVR Deluxe | UEVR backend selection, tested profiles, runtime switching, profile publishing, voice and beginner-facing launch automation |

## Starfield-first evidence triangle

Starfield work uses three evidence planes:

```text
Creation Kit and official Bethesda documentation
        -> authored Creation Engine 2 evidence

Mutar, REFramework, OpenXR and other admitted projects
        -> implementation evidence

Battle Bridge installed game, Downloads packages and headset proof
        -> observed runtime evidence
```

No plane substitutes for another. An editor record does not prove a runtime hook. Public code does not prove compatibility with the user's installed build. A successful launch does not prove stereo quality, comfort, interaction or Skyrim parity.

## Creator evidence lane

Paradise Decay and VoodooDE contribute creator field evidence rather than source-code authority.

Useful records include:

- exact video, date and timestamps;
- game, engine and game build when known;
- headset, GPU, runtime and connection method;
- conversion tool, backend and profile;
- setup steps, settings and additional files;
- working capabilities and visible failures;
- comfort, frame pacing and usability observations;
- reproduction state on the Battle Bridge.

Public captions and transcripts may be used when available to locate claims and timestamps. The lab stores compact attributed summaries, not full transcripts. A creator demonstration remains an observation until reproduced against the exact local build.

## What one-click actually means

The new tools automate different parts of the journey:

### PCVR Mods Installer Hub

Discovers, installs, updates and launches VR mods that already exist across many engines. It does not generate a new VR conversion for an unsupported title.

### Unreal Easy Injector / UEVR Deluxe

Simplifies UEVR for Unreal Engine games through game scanning, backend selection, profile installation, runtime switching and launch automation. UEVR remains the conversion engine.

### Rai Pal

Discovers local and owned games, estimates engine and version, identifies applicable universal mods and launches the correct mod route. Detection confidence must remain explicit.

Together these supply a strong model for a Stephanos conversion factory:

```text
local game discovery
  -> engine and version classification
  -> applicable conversion frameworks
  -> tested profiles or existing native mods
  -> licence and provenance checks
  -> guided installation and launch
  -> physical headset acceptance
  -> improvement work where the result falls short
```

## Battle Bridge Downloads intake

Canonical contract:

`VR-Research-Lab/docs/research-notes/battle-bridge-downloads-vr-source-intake.md`

The #1595 worker may inspect approved VR source packages under:

```text
C:\Users\Stephan Callear\Downloads
```

Preferred unattended drop zone:

```text
C:\Users\Stephan Callear\Downloads\Stephanos-VR-Intake
```

The worker hashes originals, classifies provenance and rights, safely unpacks into isolated staging, indexes source and emits evidence packets. It does not execute downloads, publish proprietary material or sweep unrelated personal files.

Installer hubs and injection tools require extra care. Static analysis, URL capture, file hashes and rollback planning come before execution. Elevation, game mutation, injection and binary launch remain approval-gated.

## What the combined stack unlocks

### 1. Reuse-first Starfield engineering

Before writing new code, Stephanos can determine:

- what the preserved vorpX setup already solves;
- what Mutar already implements;
- what Creation Kit data explains;
- what Paradise Decay or VoodooDE have demonstrated operationally;
- whether an existing installer catalogue already packages the relevant route;
- what the exact installed Starfield build permits;
- what remains missing against named Skyrim VR providers;
- which smallest reversible experiment has the highest information value.

### 2. A semantic VR capability marketplace

The Capability Graph can connect:

- locally installed or owned games;
- engine and version confidence;
- candidate frameworks and mods;
- profile and backend versions;
- supported seated, motion-control and room-scale capabilities;
- upstream source and licences;
- installation, launch, update and rollback routes;
- creator demonstrations;
- exact Battle Bridge and Quest 3 proof.

### 3. Provider-owned Skyrim parity

A parity request must name its provider:

- Skyrim VR base game for native world and tracked input;
- SKSE VR for plugin extensibility;
- VRIK for body, calibration, gestures and holsters;
- HIGGS for grabbing, collision, two-handing and physical interaction;
- PLANCK for physical character response.

This prevents "Skyrim-quality" from becoming a foggy wish with no engineering owner.

### 4. Creation Engine 2 responsibility mapping

The Capability Graph can distinguish:

- authored data visible through the Creation Kit;
- plugin and scripting extension surfaces;
- title-specific runtime hooks;
- graphics and camera interception;
- OpenXR application, loader, runtime and headset responsibilities;
- body and interaction layers;
- configuration and performance constraints.

### 5. Professional proof ladder

1. authoritative or normative source;
2. exact authoring or implementation evidence;
3. creator field observation with timestamps and setup metadata;
4. exact installed game/editor identity;
5. deterministic desk tests;
6. packaged candidate and configuration identity;
7. physical Quest 3 result;
8. regression against the known-good vorpX fallback and accepted native slices;
9. accepted-state pointer and rollback route.

### 6. No-click discovery and source acquisition

The future operator flow can begin by scanning the local game library, locating an existing conversion or profile, checking rights and compatibility, staging the correct package and generating a proof plan. The operator remains at intent and acceptance level rather than manually hunting through Discord, GitHub, YouTube and mod sites.

### 7. Better Method Library extraction

New Method Library candidates include:

- creator-video evidence records;
- transcript and timestamp claim extraction;
- engine-detection confidence;
- universal-mod applicability;
- tested-profile metadata contracts;
- per-game backend selection;
- cross-engine mod catalogue records;
- guided install and rollback plans;
- antivirus and injector trust communication;
- immutable original download hashes;
- exact-installed-build admission;
- provider-owned parity matrices;
- preserved fallback while native work advances.

### 8. Autonomous research work

Once #1596 and the Mission Scheduler are live, workers can:

- watch selected creator channels for material VR conversion videos;
- retrieve public descriptions, chapters and captions where available;
- resolve every mentioned tool to its canonical upstream;
- classify licences and availability;
- create deduplicated evidence candidates;
- compare catalogue and profile changes;
- ingest approved local packages;
- update the Starfield parity matrix;
- propose bounded experiments and return completion receipts without an open chat.

## Current gaps

Later sources may still be useful for:

- a full open-source OpenXR runtime and compositor;
- OpenVR-to-OpenXR translation;
- standalone Quest-native rendering and transport;
- WebXR thin-client presentation;
- structured comfort and accessibility telemetry;
- long-duration headset reliability.

These remain discovery candidates and must pass provenance, licence, freshness and distinct-value checks.
