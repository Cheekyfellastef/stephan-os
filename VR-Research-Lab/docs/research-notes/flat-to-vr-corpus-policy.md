# Flat-to-VR Research Corpus Policy

## Purpose

This corpus exists to turn public flat-to-VR work into structured research evidence for the VR Research Lab and, eventually, reusable Stephanos VR Bridge techniques.

It is not a bulk mirror of the internet and it must not ingest proprietary game assets, leaked code, paywalled builds, copyrighted binaries, or material whose licence does not permit reuse.

## What may be stored

- Original research notes written for this repository.
- Metadata and links to publicly available mods, frameworks, papers, documentation, talks, and repositories.
- Small, attributed code excerpts where licence and quotation rules permit them.
- Architectural summaries, hook maps, technique comparisons, experiment logs, and compatibility findings.
- Public source code only through an explicit upstream reference, submodule, vendored snapshot, or generated analysis that records the upstream licence and revision.

## What must not be stored

- Game executables, DLLs, assets, maps, textures, audio, keys, DRM bypasses, or redistributed commercial content.
- Closed-source mod binaries copied into the research repository.
- Patreon-only, Discord-only, leaked, or otherwise access-controlled material without explicit permission.
- Source code with an incompatible licence represented as if it were reusable training material.
- Claims copied from social posts without a primary source or an explicit `unverified` label.

## Corpus classes

Every entry must use one of these classes:

1. **Open source**: public source with a recorded licence and revision.
2. **Source available**: code is visible but reuse rights may be limited or unclear.
3. **Release only**: binaries are public but source is unavailable.
4. **Documentation only**: technical information is public, but no implementation is available.
5. **Unverified lead**: discovery awaiting confirmation from a primary source.

Only classes 1 and 2 may feed code-level analysis. Classes 3 and 4 may feed architecture hypotheses, compatibility research, and experiment planning. Class 5 must never be treated as fact.

## Required metadata

Each catalogue entry should record:

- project and target game
- engine or rendering API where known
- interaction model: seated/gamepad, 3DOF, 6DOF, motion controls, room scale
- runtime: OpenXR, OpenVR, Oculus, SteamVR, emulator-specific, or unknown
- source URL and release URL
- licence
- last verified date
- corpus class
- reusable techniques
- confidence and unresolved questions

## Ingestion workflow

1. Discover the project.
2. Locate the primary upstream source.
3. Verify source availability and licence.
4. Pin a commit or release when code analysis begins.
5. Create or update the catalogue entry.
6. Write an architectural note in the relevant engine, technique, or example folder.
7. Record experiments separately from upstream facts.
8. Extract only techniques that are demonstrably reusable.
9. Preserve attribution and upstream links.
10. Re-verify periodically because repositories, licences, and compatibility can change.

## AI usage

AI may index, summarise, compare, classify, generate test hypotheses, and help implement original code informed by documented ideas. AI must not erase provenance. Every generated conclusion should remain traceable to either:

- an upstream source,
- a local experiment,
- or an explicitly labelled inference.

The goal is not to train a model by indiscriminately copying code. The goal is to build a lawful, evidence-rich engineering memory that helps humans and AI reproduce techniques independently.

## Initial research priorities

1. Universal injectors and frameworks: UEVR, REFramework, UnityVRMod, UUVR.
2. Native game-specific conversions with public source: HaloCEVR, Risk of Rain 2 VR, R.E.P.O. VR, BotW BetterVR.
3. AI-assisted conversions: Halo 3 MCC VR and later Halo 2 work when primary sources are available.
4. Closed-source but influential techniques: VorpX and selected Luke Ross mods, documented without copying protected implementation.
5. Engine maps: Unreal Engine, Unity, RE Engine, Creation Engine, RAGE, and emulator interception.
