# Unreal Easy Injector / UEVR Deluxe Knowledge Extraction

Status date: 2026-07-31  
Pinned commit: `0adc70d57421e7aa9354423f99e22a2039882d2e`  
Pinned release: `3.3.2`  
Reuse posture: analysis and non-commercial operational evidence only

## What it actually does

Unreal Easy Injector is a usability and orchestration layer around UEVR. It does not create an independent universal VR renderer and it does not support arbitrary non-Unreal games.

It can:

- scan Steam, Epic, GOG, Xbox and EA installations for likely Unreal games;
- install and update selected UEVR backends;
- maintain per-game backend choices;
- discover and install tested profiles from an online database;
- expose a simplified profile editor;
- switch XR runtimes and launch/inject with fewer desktop steps;
- provide voice commands and global hotkeys;
- package profiles with metadata and descriptions for community submission.

## Important design lessons

### Separate conversion engine from operator experience

UEVR owns the conversion machinery. Unreal Easy Injector owns discovery, profiles, updates, launch flow and beginner guidance. Stephanos should preserve that separation between capability engine and orchestration shell.

### Profiles are versioned operational knowledge

A useful profile is more than configuration values. The publishing workflow includes:

- test duration beyond a five-minute smoke test;
- community testing where possible;
- `ProfileMeta.json` metadata;
- `ProfileDescription.md` instructions;
- required graphics settings and workarounds;
- optional package installation;
- removal of logs and temporary crash data before publishing;
- resetting user-specific settings while leaving the local profile unchanged.

This is an excellent model for Stephanos VR experiment packages.

### Multiple backends need compatibility selection

The tool can switch between several UEVR backends because a single backend is not always best for compatibility or performance. The Capability Graph should therefore model backend choice per game and build rather than treating `UEVR` as one immutable binary.

### Trust communication is part of usability

Injection software can trigger antivirus warnings. A professional launcher must explain why, preserve hashes and provenance, and never train users to disable protections blindly.

## Reuse boundary

The project declares all rights reserved and free non-commercial use. Stephanos may:

- cite and analyse its public behaviour;
- use it locally under its stated terms;
- learn architectural and workflow lessons independently;
- track releases and compatibility.

Stephanos must not copy its source or backend service, commercially redistribute it, or assume its profile database is available to other applications.

## Capability Graph candidates

- installed-unreal-game-discovery;
- uevr-backend-catalogue;
- per-game-backend-selection;
- tested-profile-database;
- profile-metadata-contract;
- profile-publication-validation;
- xr-runtime-switching;
- voice-and-hotkey-control;
- beginner-warning-and-remediation;
- one-click-launch-orchestration.

## Starfield relevance

Starfield is not an Unreal Engine game, so this tool is not a Starfield conversion route. Its value is architectural: Stephanos can borrow the ideas of tested profiles, backend selection, runtime switching, voice control and a low-friction launcher while using Creation Engine 2 and Mutar-specific machinery underneath.
