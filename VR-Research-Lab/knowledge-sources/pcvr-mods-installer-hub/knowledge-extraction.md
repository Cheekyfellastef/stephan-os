# PCVR Mods Installer Hub Knowledge Extraction

Status date: 2026-07-31  
Pinned commit: `4893e85114f751b86e9b847c9a28610f93981f98`  
Pinned release: `0.8.4.7`  
Licence: MIT for Hub source

## What it actually does

PCVR Mods Installer Hub is not a universal conversion engine. It is a portable Windows catalogue, installer, updater and launcher for VR mods that already exist.

At the pinned snapshot its README lists 213 entries, including Starfield VR, Halo 3 MCC, UEVR Easy Injector, motion-control conversions, seated conversions and native-VR mod lists.

## Architecture value

The catalogue source demonstrates a practical metadata model containing fields such as:

- game title and aliases;
- Steam ID and alternative installation paths;
- motion-control and room-scale capability;
- mod name, version and release date;
- author, upstream repository and information URL;
- install script and elevation requirement;
- expected installed files;
- launch executable and arguments;
- update source;
- uninstall instructions;
- compatibility notes and tags;
- videos and screenshots.

This is close to the operational index Stephanos needs for a no-click VR capability marketplace.

## Reusable methods

- installed-game detection across launchers;
- source-aware mod catalogue records;
- custom installers for complex conversions;
- auto-update where an upstream supports it;
- launch orchestration after installation;
- detection of whether a mod is already installed;
- explicit elevation requirements;
- pinned-depot support for game-version compatibility;
- alternative install modes;
- uninstall and rollback instructions;
- motion-control and room-scale capability labelling.

## Critical licence boundary

The Hub's MIT licence applies to the Hub source. It does not automatically grant rights to every mod, binary, patch, profile, game asset or download that the Hub references. Every catalogue item must receive an independent provenance, licence and integrity verdict before Stephanos downloads, republishes or modifies it.

## Security boundary

The Hub can run batch installers, download files, request elevation and alter game directories. Therefore:

- source may be statically indexed in GitHub;
- releases may be downloaded into the governed Battle Bridge intake folder;
- no installer may be executed automatically;
- URLs and hashes must be captured before execution;
- nested scripts and binaries require inspection;
- changes to a game installation require rollback and operator approval;
- successful installation does not equal headset acceptance.

## Starfield use

Use the Hub to discover how the wider ecosystem packages and installs Starfield VR, but bind Starfield engineering authority to:

- the canonical Mutar source and release;
- exact installed Starfield identity;
- Creation Kit and SFSE evidence;
- Battle Bridge hashes and runtime proof;
- Quest 3 acceptance.

## Capability Graph candidates

- vr-mod-catalogue-record;
- game-installation-discovery;
- mod-installation-plan;
- upstream-version-resolution;
- source-to-binary provenance;
- game-build compatibility;
- elevation and mutation risk;
- rollback and uninstall route;
- launch orchestration;
- capability labels for seated, motion-controlled and room-scale VR.
