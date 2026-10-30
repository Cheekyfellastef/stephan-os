# Battle Bridge Installed VR Corpus

## Purpose

This source turns the Battle Bridge's already-installed VR software into a provenance-aware engineering reference without copying proprietary binaries into Stephanos. The acquisition snapshot is deliberately local-only. This document stores safe metadata and independently authored comparisons that can teach the VR Research Agent, Capability Graph and Method Library.

## Evidence boundary

Snapshot identity: `sha256:1e9b4ed9a990d8f576b91be4fb94e968f657a73c92af9a8091f53c1aa08af1c8`

Observed: 2026-09-29 on the operator-owned Battle Bridge.

Canonical evidence plane for the scan is `APPROVED_LOCAL_PACKAGE_EVIDENCE`. File presence proves installation topology, version/configuration evidence and co-location only. It does **not** by itself prove that a route currently launches, renders correctly, is comfortable, performs well, or works on the Quest 3. Those claims still require the existing independent `OBSERVED_RUNTIME_OR_HEADSET_PROOF` path.

No game/mod binaries, assets, proprietary profiles or decompiled material are stored in the repository.

## Installed corpus

| Specimen | Local identity / VR fingerprint | Architectural value |
| --- | --- | --- |
| Starfield | Steam build 23518663; Starfield.exe 1.16.244.0; root `dxgi.dll`, `openxr_loader.dll`, `vr_config.txt`, `vr_ui.ini` | Flat-game conversion with root graphics interception, OpenXR loader and title-specific VR configuration |
| Skyrim VR | build 2743427; SkyrimVR.exe 1.4.15.0; `openvr_api.dll`; SKSEVR; HIGGS, VRIK and PLANCK artefacts | Native VR base plus extensibility, embodiment, grabbing and physics layers |
| Skyrim Special Edition | build 24914197; SkyrimSE.exe 1.7.104.0 | Flat sibling for differential analysis |
| Fallout 4 VR | build 2772164; Fallout4VR.exe 1.2.72.0; `openvr_api.dll`; F4SEVR; VR archives | Creation Engine native-VR sibling with script-extender/plugin seam |
| Fallout 4 | build 24564252; Fallout4.exe 1.11.240.0 | Flat sibling for differential analysis |
| Borderlands 2 VR | build 4614005; separate Win64 `Borderlands2VR.exe`; `openvr_api.dll` | Separate VR edition with a dedicated 64-bit executable/runtime path |
| Borderlands 2 | build 9218157; Win32 `Borderlands2.exe` | Clean flat sibling for executable/runtime comparison |
| No Man's Sky | build 25442159; `NMS.exe`; `openvr_api.dll` | One-install native VR mode spanning the same game universe |
| Half-Life: Alyx | build 25352687; `hlvr.exe`; OpenVR; dedicated VR machine/user configs | VR-first baseline with explicit VR configuration surface |
| Hellblade VR | build 3015561; VR-specific executables; UE4 Oculus/OpenVR third-party runtime trees | Separate Unreal VR edition with multiple runtime backends |
| GORN | build 4043783; Unity; SteamVR actions, OpenVR, OVRPlugin and controller binding files | Unity runtime abstraction, actions and device bindings |
| VRChat | build 25307595; Unity XR OpenVR subsystem; SteamVR actions and bindings for Touch, Knuckles, Vive, VD hand controller and others | Data-driven runtime/input portability |
| Thumper | build 8899753; conventional game executables plus `openvr_api.dll` | Optional VR mode within a primarily flat presentation architecture |
| Aliens Attack VR | build 3879900; Unity VR-specific data/plugin layout | Smaller Unity native-VR reference |
| Red Dead Redemption 2 | build 13773296; `RealVR64.dll`, `RealVR_RDR2.asi`, `dinput8.dll`, `dxgi.dll`, `openvr_api.dll`, Vulkan layer manifest and RealVR config | Generic VR framework plus game adapter, graphics/API interception and title-specific stereo/camera repair |
| Cyberpunk 2077 | executable 2.31; Windows registration “CyberpunkVR powered by vorpX”; `vpxCP2077` plugin with OpenXR/OpenVR display/tracker backends and bindings | Title-specific commercial conversion package with selectable runtime/tracker abstraction |

The machine also has vorpX 25.1.5.0, SteamVR, Virtual Desktop Streamer 1.34.2 and Virtual Desktop Service 1.18.52 installed. These are supporting runtime/presentation infrastructure and retain their separately registered provenance boundaries.

## High-value differentials

### Skyrim SE → Skyrim VR

The VR edition is not merely a flat executable launched in a headset. The installed VR sibling exposes a different executable identity, OpenVR, VR-specific game data and a VR script-extender path. Its mature mod stack then composes body IK, grabbing, collision and physics above that base. The reusable lesson is to separate **base VR plumbing** from **interaction parity layers**.

### Fallout 4 → Fallout 4 VR

The same Creation Engine family shows the same broad split: VR-specific executable/data/runtime plus a VR-specific script-extender/plugin seam. That makes the Skyrim/Fallout pair useful for discovering which adaptation concepts recur across related engine generations without assuming offsets or code are portable.

### Borderlands 2 → Borderlands 2 VR

The installed flat sibling is Win32, while the VR edition has a distinct Win64 VR executable and OpenVR library. This is a particularly clean reminder that a commercial VR edition may involve a substantial platform/runtime fork rather than a small camera patch.

## Flat-to-VR conversion specimens

### Starfield conversion route

The Starfield root contains a graphics proxy/interception DLL, an OpenXR loader and title-specific VR configuration. The configuration independently exposes head tracking, world scale, HUD projection/scale/distance, motion-controller inactivity, OpenXR resolution, recentering, DLSS/TAA-related repair and AER controls.

Safe inference: a robust conversion architecture benefits from separating presentation/runtime hooking from title-specific correction/configuration. Exact binary origin and current playability must be proven separately.

### Cyberpunk 2077 + vorpX

The Cyberpunk installation is registered by Windows as `CyberpunkVR powered by vorpX`. Its `vpxCP2077` package contains separate display and tracker configuration for Oculus, OpenXR and SteamVR, OpenVR input action/binding data, and OpenXR/OpenVR device libraries.

Safe inference: title-specific conversion can sit above a common runtime abstraction layer, with display, tracking and controller bindings selected as data rather than hard-wired into one headset path.

### Red Dead Redemption 2 + R.E.A.L. VR

The RDR2 install contains the R.E.A.L. VR framework DLL, RDR2-specific ASI adapter, DirectInput/graphics proxy components, OpenVR, ReShade-compatible configuration and a Vulkan global-layer manifest naming `VK_LAYER_RealVR`. The config separately controls stereo/TAA repair, dominant eye, world size, camera-change recentering, yaw prediction, buffering, render mode and HUD presentation.

Safe inference: difficult flat engines may need a chain of **API interception + common VR framework + title adapter + stereo/temporal repair + camera/HUD correction**, not one monolithic “VR mod”.

## Reusable conversion grammar

1. **Diff siblings before inventing.** When flat and VR editions coexist, compare executable architecture, runtime libraries, data/config and extension seams. The difference set is often a better design map than generic VR advice.
2. **Separate plumbing from embodiment.** Runtime/stereo/head tracking can be correct while body, hands, grabbing, holsters and physics remain separate parity layers.
3. **Prefer explicit runtime adapters.** OpenXR, OpenVR/Oculus and controller families should be replaceable boundaries where the title permits it.
4. **Treat input mappings as data.** VRChat, GORN and Cyberpunk all provide evidence that device/action bindings can live outside core title logic.
5. **Keep title correction local.** Camera offsets, HUD projection, world scale, temporal reconstruction, dominant-eye and FOV fixes are usually title/build-specific even when the framework is reusable.
6. **Model temporal stereo repair separately.** Converted flat engines frequently expose TAA/DLSS/AER/alternate-eye hazards that are different from pose tracking.
7. **Preserve rollback.** Root proxy DLLs, API layers and title adapters should be identifiable and reversible so the flat baseline remains recoverable.
8. **Do not collapse evidence planes.** Installed topology, public source architecture, creator claims and Quest 3 runtime proof remain distinct.

## Capability Graph candidates

- flat/VR sibling differential analysis
- separate-VR-edition architecture detection
- in-place native-VR mode detection
- graphics-proxy/OpenXR-loader conversion seam
- script-extender/plugin embodiment composition
- multi-runtime display/tracker abstraction
- data-driven VR input binding
- common-framework/title-adapter conversion
- temporal stereo repair layer
- HUD/world-scale/camera correction layer

## Method Library candidates

The companion `teaching-records.json` encodes the method candidates in the canonical teaching shape consumed by `vrTeachingWorkspaceProjectionV1`. Every record is bound to the local snapshot identity above and uses `APPROVED_LOCAL_PACKAGE_EVIDENCE` plus `STEPHANOS_INFERENCE_OR_PROPOSAL`; none claims independent headset acceptance.

## Next evidence

Future rescans should create a new immutable local snapshot/hash rather than silently replacing this one. A changed game/mod build can supersede this teaching only through an explicit source revision and teaching supersession chain. Quest 3 playtests remain the authority for actual runtime acceptance.
