# Starfield and Creation Kit Knowledge Extraction

Status date: 2026-07-29  
Priority: P0  
Owning goal: #1611  
Battle Bridge worker: #1595

## Why this source exists

Starfield is the first project intended to reach Skyrim VR-quality within the Stephanos VR Research programme. The Starfield Creation Kit provides the official authoring-side view of Creation Engine 2. It must therefore become a first-class evidence source alongside runtime VR implementations and exact installed-game proof.

This source does not mean that the Creation Kit exposes every system required for VR. It contributes authored-data and editor evidence. Rendering, frame timing, OpenXR integration, low-level camera application, runtime input interception and headset behaviour may still require source analysis, instrumentation and physical proof.

## Three-plane evidence model

### 1. Authoring plane

Use the Creation Kit and official Bethesda documentation to understand:

- record and form identities;
- object and plugin relationships;
- authored camera, actor, animation, interface, interaction, vehicle and world data where exposed;
- script and event surfaces;
- master/plugin dependencies;
- which behaviours are data-driven and which appear to require runtime code.

### 2. Implementation plane

Compare the authoring model with admitted public implementation evidence:

- Mutar / NoMoreFlat `starfield2vr`;
- REFramework architecture;
- Khronos OpenXR sources;
- Halo MCC VR proof and lifecycle methods;
- vorpX and Luke Ross public behaviour and operational evidence;
- Skyrim VR provider-owned parity layers.

### 3. Observed runtime plane

Use #1595 on the Battle Bridge to capture:

- the exact installed Starfield distribution, path, executable version and hash;
- the exact Creation Kit installation, version and hash;
- Steam ownership and launch compatibility;
- SFSE and VR-related plugin/runtime inventory;
- logs, configuration and headset proof;
- source packages placed in the approved Downloads intake surface.

No conclusion should silently cross from one plane to another. A Creation Kit record does not prove a runtime hook. Public source does not prove compatibility with the installed build. A successful launch does not prove correct stereo, input, comfort or parity.

## Immediate Starfield questions

The first extraction should answer:

1. Which desired Skyrim VR parity capabilities have an identifiable Creation Engine 2 authoring surface?
2. Which are already present in Mutar's Starfield implementation?
3. Which require runtime hooks or new engine research?
4. Which capabilities can remain seated and Xbox-controller-first for the earliest useful slice?
5. Which body, hand, holster, collision and physical-character capabilities belong to later VRIK, HIGGS and PLANCK parity slices?
6. Which editor-visible data can guide camera, HUD, interaction and vehicle experiments without mutating the game?
7. What exact build and plugin identities must be pinned before any proof is accepted?

## Creation Kit operational facts

Current official Bethesda support states:

- the Starfield Creation Kit is a separate free Steam download;
- it can be downloaded without buying Starfield, but will not launch unless Starfield is owned and installed through Steam.

The Battle Bridge worker must inspect the real installation and return a verdict. Do not assume the user's current Starfield distribution is compatible with launching the editor.

## Evidence outputs allowed in GitHub

Allowed derived outputs include:

- hashes and version identities;
- file and plugin inventories without proprietary file contents;
- independently written record and relationship maps;
- field names or compact schema notes when lawful and necessary;
- experiment plans and observed results;
- screenshots or excerpts only where rights and privacy permit;
- links to exact official pages and public source revisions;
- unknown, unsupported and conflicting-evidence records.

Do not commit Bethesda executables, plugins, archives, assets, paid Creations or wholesale documentation.

## First implementation route

```text
Approved source package enters Battle Bridge Downloads
    -> #1595 hashes and inventories it
    -> licence and provenance are classified
    -> source is safely unpacked into isolated staging when approved
    -> static index and evidence packet are produced
    -> Starfield and Creation Kit installed identities are captured
    -> authored, implementation and runtime evidence are linked
    -> #1593 generates capability and method candidates
    -> #1591 selects the smallest reversible Starfield parity slice
```

## Method Library candidates

- three-plane evidence separation;
- editor-versus-runtime responsibility mapping;
- exact installed-build admission before proof;
- proprietary authoring-tool evidence without asset ingestion;
- Downloads-folder source intake with immutable original hashes;
- provider-owned Skyrim parity mapping;
- preserved VorpX rollback while native work progresses;
- reuse-first comparison against Mutar before new implementation.

## Completion signal

This source becomes operational when one exact Starfield/Creation Kit evidence packet is produced through #1595 and #1591 can answer, with evidence, whether a requested Skyrim VR-quality capability is authored-data-visible, already implemented, runtime-only, unsupported or still unknown.
