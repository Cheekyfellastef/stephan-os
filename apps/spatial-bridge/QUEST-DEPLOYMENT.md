# Stephanos Spatial Bridge Quest Deployment

## Chosen architecture

The target delivery is an **immersive WebXR Progressive Web App** packaged with Meta's fork of Bubblewrap and distributed to Stephan through an invite-only **ALPHA release channel**.

This route provides a Quest App Library icon, Quest-local rendering at home and in the caravan, and no dependency on programmatically starting Air Link. Air Link remains a separate optional PCVR/media route for games or a later high-fidelity bridge renderer.

## Intended captain experience

```text
Put on Quest 3
→ select Stephanos from the Quest Library
→ immersive bridge launches locally
→ authenticate Stephan
→ detect HOME or CARAVAN transport profile
→ connect to canonical Stephanos state
→ restore captain position and mission context
```

## Current source readiness

Present on the branch:

- `manifest.webmanifest`
- `service-worker.js`
- `offline.html`
- `quest-entry.html`
- `holodeck-baseline-v0.mjs`
- source-only icon specification and deterministic PNG generator
- `quest-entry-contract.v1.json`
- read-only Holodeck Baseline WebXR session adapter and canvas surface
- deterministic source tests
- atomic offline cache coverage for the Quest entry module graph, including Command Deck return controls

The Holodeck Baseline source path can probe WebXR support and request an immersive session while failing closed to the fallback surface. This is **source readiness only**. It is not proof that Quest 3, Meta Browser, packaging, distribution, or the physical immersive renderer works.

The bundled `bridge-state.v0.json` is static/mock projection data. Reading it does not prove that a live Stephanos backend or Battle Bridge control plane is reachable.

## Physical proof still pending

The following remain unproven:

1. exact-head Holodeck launch on Quest 3 hardware;
2. immersive WebXR session observation in the target Quest browser/runtime;
3. stable HTTPS production hosting;
4. signed Meta Bubblewrap packaging;
5. Digital Asset Link verification;
6. private ALPHA-channel installation and Quest Library launch;
7. authenticated live Stephanos control-plane reachability;
8. home and caravan transport-profile acceptance.

`immersiveRendererSourceReady` and physical `immersiveRendererReady` are deliberately separate gates.

## Generated icon requirement

The strict PR clean guard rejects committed images and binary artifacts. Before hosting or packaging, generate the required PNGs with:

```text
node apps/spatial-bridge/tools/build-icons.mjs
```

Generated PNGs must remain uncommitted.

## Hosting and packaging requirements

The PWA must be served from a stable HTTPS origin exposing the manifest, service worker, generated icons and `/.well-known/assetlinks.json`. Create the app in Meta Horizon Developer Dashboard, preserve the application ID, use `com.stephanos.spatialbridge` unless a reviewed platform constraint requires otherwise, create and preserve a dedicated signing keystore, build the signed package, publish the exact signing fingerprint through Digital Asset Links, and verify that binding before claiming launchability.

Use the invite-only ALPHA release channel for normal distribution. Sideloading is acceptable only for early engineering proof and does not satisfy normal delivery acceptance.

## Home and caravan profiles

Home:

```text
Quest-local renderer
→ local Wi-Fi
→ authenticated Stephanos control plane
→ Battle Bridge
```

Caravan:

```text
Quest-local renderer
→ caravan Wi-Fi
→ Starlink
→ authenticated remote route
→ home Battle Bridge
```

The local bridge shell, comfort-critical rendering and offline fallback remain on Quest.

## Safety gate

No approval or execution control may be enabled merely because the Quest app launches. The first Quest build remains observation-only until identity, freshness, exact-target approval binding, stop/revoke and evidence-return paths are separately proven. Source readiness must never be promoted into physical-device or live-backend acceptance without corresponding evidence.
