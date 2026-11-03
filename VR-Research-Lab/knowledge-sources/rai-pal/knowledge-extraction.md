# Rai Pal Knowledge Extraction

Status date: 2026-07-31  
Pinned commit: `ace5d1f299633720ad0a8d696bf1cb689544bdfe`  
Licence: GPL-3.0-or-later

## What it contributes

Rai Pal is a local game-library and universal-mod discovery tool. It can detect installed and owned games across multiple stores, infer game engines and versions, install or update universal mods and launch UEVR for a selected title.

## Reusable methods

- scan Steam, GOG, Epic, Itch and moddable Xbox installations;
- distinguish owned games from installed games;
- accept a manually dropped executable when a store is unsupported;
- detect engine family and engine version with explicit confidence limits;
- find games eligible for a universal mod;
- install and update the correct universal-mod version;
- launch a mod against a selected game without manual process selection;
- preserve uncertainty when engine identification is only a guess.

## Why this matters to Stephanos

This is a strong reference for the front end of a conversion factory:

```text
local game library
  -> engine and version detection
  -> applicable conversion frameworks
  -> profiles and known compatibility
  -> recommended setup route
  -> proof still required
```

It can also help #1595 inspect the Battle Bridge game library without assuming every title was installed through Steam.

## Licence boundary

Rai Pal is GPL-3.0-or-later. Stephanos may run it, study it and modify it under the GPL. Directly incorporating its code into a distributed combined work can trigger GPL obligations. Safer options include:

- use it unchanged as a separate local tool;
- communicate through exported files or a process boundary;
- independently implement permissively licensed ideas without copying protected expression;
- deliberately license a compatible component under the GPL where appropriate.

## Accuracy boundary

The project explicitly notes that owned-game and engine detection can involve guesswork. Every detection record should carry:

- source provider;
- installed versus merely owned;
- engine and version confidence;
- local file evidence;
- date and tool revision;
- manual confirmation state.

## Capability Graph candidates

- local-game-library-inventory;
- store-provider-adapter;
- game-engine-detection;
- engine-version-detection;
- detection-confidence;
- universal-mod-applicability;
- mod-version-selection;
- mod-update-orchestration;
- game-specific universal-mod launch.
