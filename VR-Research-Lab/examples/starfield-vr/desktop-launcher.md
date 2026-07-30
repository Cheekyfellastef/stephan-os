# Starfield VR desktop launcher

## Operator experience

The installed Windows shortcut is named **Starfield VR**. It is intended to be selected from the Windows desktop while the Quest 3 is already inside Meta Air Link.

One selection:

1. confirms the exact Battle Bridge launch profile produced under #1595;
2. verifies the Starfield launcher and VR-provider files against their recorded SHA-256 identities;
3. confirms Meta Horizon Link, the Meta OpenXR runtime and an active `OculusDash` Air Link session;
4. starts the best currently verified provider;
5. writes a launch receipt to the external Stephanos workspace.

The preferred provider is `mutar-openxr`. The preserved operator-owned VorpX path remains an independently verifiable fallback. The shortcut never silently falls from a blocked VR route into flat Starfield.

## Source

- canonical decision policy: `shared/agents/starfieldVrLaunchPolicy.mjs`
- Windows launch adapter: `scripts/windows/launch-starfield-vr.ps1`
- current-user shortcut installer: `scripts/windows/install-starfield-vr-desktop-shortcut.ps1`
- non-authoritative profile shape example: `launch-profile.example.json`

## Battle Bridge handoff

After this source reaches canonical `main`, #1595 should:

1. inspect the exact installed Starfield distribution, executable and VR files;
2. match the provider files to a pinned, licence-classified package;
3. prove the Quest 3 Meta Air Link and Meta OpenXR route;
4. write the verified profile to:

   `C:\Users\Stephan Callear\Documents\Stephanos-openclaw-workspace\vr\starfield-vr-launch-profile.json`

5. run:

   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\install-starfield-vr-desktop-shortcut.ps1`

6. run the readiness proof:

   `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows\launch-starfield-vr.ps1 -ReadinessOnly`

7. perform one operator-authorised headset launch and attach the resulting receipt to #1591.

The profile cannot claim `status: ready` or verdict `STARFIELD_VR_LAUNCH_PATH_VERIFIED` merely because `dxgi.dll` exists. Exact provider provenance, hashes and headset proof are required.

The AI-assisted `gsaw0` stability fork is recorded in `../../docs/research-notes/starfield2vr-ai-stability-fork-candidate.md`. It is a candidate provider revision until #1595 pins its source/licence, compares the code and proves the claimed memory improvement on Quest 3 Meta Air Link.

## Safety boundary

The launcher does not download, unpack, install, copy or replace a mod. It does not change the active OpenXR runtime, Starfield configuration, Meta configuration or VorpX profile. Those remain separate, reversible and approval-gated #1595 actions.
