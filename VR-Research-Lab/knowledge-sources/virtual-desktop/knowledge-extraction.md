# Virtual Desktop: Stephanos knowledge extraction

## Source identity

- Official product source: `https://www.vrdesktop.net/`
- Public compatibility surface: `https://games.vrdesktop.net/`
- Public release/changelog repository: `guygodin/VirtualDesktop`
- Snapshot version recorded from the official product site: `1.34.18`
- Snapshot date: 2026-08-02
- Licence class: commercial proprietary
- Reuse boundary: public metadata, documented behaviour and authorised local operator evidence only

Virtual Desktop is not admitted as open implementation source. Its public GitHub surface distributes releases and records changes; it does not grant permission to copy the proprietary application, VDXR runtime or backend implementation.

## Why this is a useful VR source

Virtual Desktop provides a mature operational reference for the layers between a Windows game and a standalone headset:

1. wireless PC desktop and PCVR streaming;
2. giant virtual-screen and environment presentation;
3. side-by-side stereoscopic presentation;
4. OpenXR runtime selection and VDXR behaviour;
5. codec, bitrate, colour, sharpening and foveated-streaming choices;
6. controller, gamepad, hand, body and eye-tracking transport;
7. headset and game compatibility handling;
8. network, capture, DRM, antivirus and black-screen failure modes.

This is especially relevant to #1643 because a resistant game may still be presented as a stereoscopic screen or consume SBS output produced by a Stephanos-owned reconstruction layer.

## Verified public behaviours at capture

The official product site states that Virtual Desktop can:

- show a computer desktop, movies and games on a giant virtual screen;
- stream SteamVR and Oculus Rift PCVR games from a VR-ready Windows PC;
- support Meta Quest 1, 2, 3, 3S and Pro alongside several other standalone headsets;
- display side-by-side 3D content through its 3D mode;
- operate across a local network or supported remote connection;
- expose practical troubleshooting for network, GPU, capture and DRM-related black screens.

The official release surface also records VDXR/OpenXR routing, render-resolution controls, tracked input improvements, codec and colour work, foveated streaming and compatibility repairs. Each version-specific claim must remain tied to its exact release.

## Capability Graph candidates

Add or enrich nodes for:

- flat-game virtual-screen presentation;
- curved-screen and environment-based presentation;
- SBS stereoscopic transport;
- PC-to-headset low-latency video transport;
- encode, network, decode and display latency budget;
- OpenXR runtime selection and VDXR routing;
- controller and gamepad transport;
- eye-tracked foveated streaming;
- compatibility database and game-launch routing;
- DRM/capture black-screen detection;
- headset and network readiness checks;
- graceful fallback from PCVR to desktop-screen mode.

## Relevance to the Monocular Flat-to-VR Reconstruction Layer

Virtual Desktop can serve as a presentation benchmark and potential operator-selected transport for early #1643 experiments:

```text
permitted flat-game capture or prerecorded sequence
  -> Stephanos depth and camera estimation
  -> confidence-aware proxy scene
  -> coherent left/right SBS output
  -> Virtual Desktop 3D SBS presentation
  -> Quest 3 physical comfort and depth judgement
```

Virtual Desktop does not perform the proposed world reconstruction for Stephanos, and no claim should imply that it does. It is the presentation and transport reference at the end of the pipeline.

## Design lessons to extract without copying implementation

### 1. Presentation remains valuable below native VR

A game need not expose stereo cameras or VR poses to provide a worthwhile headset experience. A high-quality virtual screen, curved display or cockpit environment is a legitimate fallback rung.

### 2. Stereo transport and world reconstruction are separate layers

Stephanos should generate a coherent stereo pair independently. Presentation software should receive a standard output such as SBS rather than being tightly coupled to reconstruction internals.

### 3. Transport quality is part of perceived VR quality

Codec choice, bitrate, colour handling, sharpening, network stability, decode timing and reprojection can dominate the experience even when the source stereo is correct.

### 4. Compatibility needs explicit evidence

A product compatibility list or launch route is discovery evidence. It does not prove a particular game build, network, headset or runtime combination on the Battle Bridge.

### 5. Capture can be blocked independently of rendering

DRM, protected video surfaces, GPU configuration and application capture behaviour can produce black screens. #1643 must detect this boundary and fail closed rather than attempt to defeat protection.

### 6. Provider isolation preserves sovereignty

The reconstruction system should expose standard presentation outputs so Virtual Desktop can remain an optional proprietary adapter. A different SBS player, OpenXR application or Stephanos-owned viewer should be able to replace it later.

## Battle Bridge evidence packet

A future authorised test should record:

- exact Virtual Desktop client and Streamer versions;
- headset and Quest firmware identity;
- network route, router, link rate and codec;
- refresh rate, bitrate and render resolution;
- source SBS resolution and frame rate;
- capture, reconstruction and encode latency;
- dropped frames, decode latency and network latency;
- comfort verdict, depth consistency and edge artifacts;
- whether the same SBS output works through an alternative viewer.

No local product settings, account data, credentials or proprietary binaries belong in GitHub.

## Licence and sovereignty consequences

- Virtual Desktop may be used as an authorised commercial product according to its applicable store and product terms.
- Public behaviour may inform requirements and comparisons.
- Its proprietary implementation cannot be copied into Stephanos.
- #1643 should maintain a standard SBS/OpenXR presentation boundary and a sovereign replacement route.
- Any compatibility database ingestion must respect the site's terms and avoid mirroring substantial content.

## Refresh triggers

#1596 should create a material-change candidate when Virtual Desktop changes:

- supported headsets or operating systems;
- SBS/3D presentation behaviour;
- VDXR or OpenXR routing;
- codecs, latency, foveated streaming or colour pipeline;
- compatibility and launch handling;
- capture, DRM or networking limitations;
- licensing, availability or hosted-service dependency.

Routine cosmetic release notes should not trigger a programme interruption.
