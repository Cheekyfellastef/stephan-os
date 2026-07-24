# Flat-to-VR Mod Catalogue

Last verified: 2026-07-24

This is a research index, not a redistribution archive. Inclusion means the project contains potentially useful evidence for flat-to-VR engineering. It does not imply compatibility, safety, quality, or permission to reuse all code.

| Project | Target / scope | Engine or layer | VR model | Corpus class | Licence / reuse status | Research value |
|---|---|---|---|---|---|---|
| UEVR | Broad UE4/UE5 game support | Unreal Engine native stereo and process injection | 6DOF HMD, stereo, optional motion controls and room scale | Open source | MIT; verify upstream revision before analysis | Universal injection, native stereo modes, UI projection, object hooks |
| REFramework | RE Engine games | DX11/DX12 mod framework and scripting layer | VR support plus scripting/plugins | Open source | MIT | Engine-specific framework design, render hooks, scripting bridge |
| UnityVRMod | Broad Unity games | BepInEx, Mono/IL2CPP, DX11 | OpenXR/OpenVR, 6DOF injection | Open source | GPL-3.0 | Version-independent Unity runtime access, camera discovery, backend abstraction |
| UUVR | Broad Unity games | Unity patcher and XR packages | OpenXR/OpenVR support | Open source | Verify upstream licence and active status | Universal Unity patching and XR bootstrap patterns |
| HaloCEVR | Halo: Combat Evolved / Custom Edition | Native game-specific hooks | Full VR conversion with motion-controller work | Open source | Verify repository licence before extracting code | Camera, aiming, UI overlay, left-handed bindings, legacy engine conversion |
| Halo 3 MCC VR | Halo 3 in Master Chief Collection | Native OpenXR game-specific mod | Reported 6DOF and motion-controller features | Source availability to verify | Public reports say AI-authored; licence and canonical repository must be verified | AI-directed reverse engineering, MCC game hooks, OpenXR integration |
| Halo 2 VR | Halo 2 work announced by HaloCEVR creator | To verify | To verify | Unverified lead | No canonical implementation recorded yet | Potential cross-title reuse inside Halo engine family |
| RepoXR | R.E.P.O. | Unity, BepInEx, Unity OpenXR plugin | Full 6DOF motion controls, mixed flat/VR multiplayer | Open source | GPL-3.0 | Multiplayer embodiment, networked hand motion, dynamic compatibility checks |
| RoR2VRMod | Risk of Rain 2 | Unity / BepInEx ecosystem | Full motion controls | Open source | Verify repository licence before extracting code | VR API separation, input mapping, multiplayer-safe conversion |
| BotW BetterVR | Breath of the Wild via Cemu | Vulkan interception plus Vulkan-D3D12 interop and OpenXR presentation | HMD and controller support | Open source | Verify upstream licence before extracting code | Emulator interception, cross-API texture sharing, external compositor design |
| VorpX | Broad commercial game support | Proprietary injector | Head tracking, stereo/depth modes, gamepad-centric use | Release only | Proprietary | Compatibility taxonomy and user-experience comparison only |
| Luke Ross REAL mods | Selected AAA games | Proprietary game-specific mods | Primarily gamepad/head-tracked VR with alternate-eye rendering in many titles | Release only | Proprietary / access conditions vary | Alternate-eye rendering trade-offs, seated conversion UX, performance study |

## Primary upstream references

- UEVR: https://github.com/praydog/UEVR
- REFramework: https://github.com/praydog/REFramework
- UnityVRMod: https://github.com/NewUnityModder/UnityVRMod
- UUVR: https://github.com/Raicuparta/uuvr
- HaloCEVR: https://github.com/LivingFray/HaloCEVR
- RepoXR: https://github.com/DaXcess/RepoXR
- RoR2VRMod: https://github.com/DrBibop/RoR2VRMod
- BotW BetterVR: https://github.com/Crementif/BotW-BetterVR

## Next catalogue expansion

The next pass should cover publicly verifiable conversions and frameworks for:

- Half-Life and Source-engine games
- Doom, Quake, Jedi Knight, and other open-source engine ports
- Unity-specific game mods such as Lethal Company VR
- emulator-based VR work for Dolphin, Cemu, and related projects
- Minecraft, Valheim, Deep Rock Galactic, Outer Wilds, and Subnautica VR ecosystems
- Cyberpunk 2077, Red Dead Redemption 2, GTA V, Starfield, and other release-only conversions as documentation-only entries

Each addition must follow the corpus policy and record its primary source, licence, revision, and confidence.