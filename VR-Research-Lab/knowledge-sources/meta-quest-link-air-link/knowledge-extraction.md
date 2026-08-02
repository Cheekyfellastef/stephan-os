# Meta Quest Link and Air Link: Stephanos knowledge extraction

## Source identity

- Vendor: Meta Platforms
- Product family: Meta Horizon Link / Meta Quest Link
- Wireless mode: Air Link
- Primary operator headset: Meta Quest 3
- Primary operator route: Battle Bridge to Quest 3 over Wi-Fi
- Snapshot date: 2026-08-02
- Licence class: commercial proprietary

This is an operational and vendor-evidence record. It does not provide authority to copy Meta's implementation or redistribute Meta software.

## Why this is a priority source

Air Link is the operator's normal PCVR transport. It is therefore the primary acceptance route for Starfield VR, the Monocular Flat-to-VR Reconstruction Layer and future Stephanos spatial experiences unless a bounded experiment explicitly selects another transport.

Virtual Desktop remains a valuable comparison and optional transport. Wired Link remains a diagnostic fallback. Neither silently replaces the operator's preferred Air Link route.

## Capability model

Treat the route as a pipeline rather than a single supported flag:

```text
PC application or reconstructed stereo producer
  -> graphics and OpenXR application path
  -> PC render and encode
  -> Ethernet/Wi-Fi network path
  -> Quest receive and decode
  -> compositor, reprojection and display
  -> headset pose and controller return path
```

A launch failure, latency spike or visual defect must be attributed to the correct layer before repair.

## Operational knowledge targets

### 1. Exact installed identity

Battle Bridge evidence should capture:

- installed Meta Horizon Link / Quest Link version;
- executable and service identities and hashes where appropriate;
- relevant process and service health;
- active OpenXR runtime identity;
- Quest headset and Horizon OS version;
- graphics driver and GPU identity;
- selected refresh rate and render resolution;
- Air Link pairing and active-session state.

No version should be inferred from public documentation.

### 2. Network topology and quality

For repeatable wireless proof, record:

- PC-to-router path and link speed;
- headset Wi-Fi band and negotiated link details where available;
- access-point identity and distance;
- packet loss, jitter, congestion and retransmission signals;
- competing traffic and mesh/roaming behaviour;
- bitrate mode and configured ceiling;
- end-to-end latency components where exposed.

Meta support commonly recommends a wired PC connection to the router/access point, a 5 GHz AC/AX headset connection and close access-point placement. These are setup recommendations, not proof of the user's actual network state.

### 3. OpenXR and runtime responsibility

Air Link transports PCVR but does not itself prove that the application is using the intended OpenXR path. Evidence must distinguish:

- Meta OpenXR selected and active;
- SteamVR/OpenXR or another runtime selected;
- the application's rendering backend;
- transport session health;
- game or mod compatibility;
- compositor and reprojection behaviour.

### 4. Performance and comfort

Measure at least:

- application frame time and delivered cadence;
- headset refresh rate;
- encode, network and decode latency where available;
- dropped frames and packet loss;
- motion smoothing or reprojection state;
- image quality, compression artefacts and colour behaviour;
- controller response and head-motion latency;
- long-session stability and thermal/network drift.

A route that launches is not automatically comfortable or Skyrim-quality.

### 5. Failure and recovery patterns

Capture bounded recovery evidence for:

- PC not discovered;
- pairing lost;
- Link launch hangs;
- Meta OpenXR not active;
- Dash session absent;
- black screen or frozen frame;
- half-rate cadence caused by smoothing;
- network instability;
- service or application repair/restart;
- safe fallback to wired Link or Virtual Desktop for diagnosis.

## Role in #1643 monocular reconstruction

Air Link should be treated as the default eventual live Quest 3 transport for a Stephanos-owned stereo reconstruction producer.

The reconstruction system should expose a transport-neutral output boundary:

```text
coherent left/right reconstruction
  -> standard SBS or OpenXR presentation adapter
  -> Air Link primary adapter
  -> Virtual Desktop optional adapter
  -> wired Link diagnostic adapter
```

This prevents the sovereign reconstruction engine from becoming dependent on Meta's proprietary transport implementation.

## Role in Starfield VR

For #1591, the normal accepted route is:

```text
pinned Starfield build
+ exact VR provider files
+ Meta OpenXR
+ active Quest 3 Air Link session
+ operator-authorised headset proof
```

The desktop launcher must continue to fail closed when the expected Air Link, OpenXR or provider evidence is absent. Virtual Desktop or another route must be separately admitted rather than silently substituted.

## Capability Graph candidates

- wireless PCVR transport
- Meta OpenXR runtime route
- Air Link session readiness
- encode/network/decode/display latency chain
- bitrate and resolution negotiation
- packet-loss and jitter sensitivity
- motion smoothing and delivered cadence
- headset/controller return path
- transport fallback and comparative proof
- vendor lock-in and transport-neutral adapter boundary

## Licence and sovereignty

- Meta software and implementation remain proprietary.
- Public support and developer material may provide operational requirements and comparison evidence.
- Local operator evidence may be collected from authorised installations without publishing credentials or private diagnostic data.
- Stephanos should own the route contract, readiness schema, telemetry schema and acceptance tests.
- A future standards-based or independently implemented transport can replace Air Link without replacing the Starfield or reconstruction capability.

## Next bounded proof

#1595 should produce one Air Link transport evidence packet from the Battle Bridge containing exact installed identity, active OpenXR runtime, Quest 3 session state, network topology, selected refresh rate, resolution/bitrate settings and a short frame/latency observation. This is an evidence task, not an automatic configuration mutation.
