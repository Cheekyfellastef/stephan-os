# Stephanos Spatial Bridge Quest Deployment

## Chosen architecture

The target delivery is an **immersive WebXR Progressive Web App** packaged with Meta's fork of Bubblewrap and distributed to Stephan through an invite-only **ALPHA release channel**.

This is the preferred route because it provides:

- a real icon in the Quest App Library
- direct immersive launch from that icon
- one locally rendered Quest experience at home and in the caravan
- web technology aligned with the existing Stephanos surface
- Alpha-channel updates without public Store publication
- no dependency on a Quest cable
- no dependency on programmatically starting Air Link

Air Link remains a separate optional PCVR/media route for games or a later high-fidelity bridge renderer. It is not the front door to Stephanos.

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
- source-only icon specification and deterministic PNG generator
- `quest-entry-contract.v1.json`
- flat read-only bridge staging surface
- deterministic source tests

The current Quest entry page embeds the flat staging surface. It is not yet an immersive WebXR renderer.

## Generated icon requirement

The strict PR clean guard rejects committed images and binary artifacts. Before hosting or packaging, generate the required PNGs:

```text
node apps/spatial-bridge/tools/build-icons.mjs
```

This creates:

```text
apps/spatial-bridge/icons/icon-192.png
apps/spatial-bridge/icons/icon-512.png
```

The generator is deterministic and dependency-free. The source test generates the icons in a temporary directory and validates the PNG signature and dimensions. Generated PNGs must not be committed.

## Hosting requirement

The PWA must be served from a stable HTTPS origin. The production URL must expose:

```text
/manifest.webmanifest
/service-worker.js
/icons/icon-192.png
/icons/icon-512.png
/.well-known/assetlinks.json
```

The exact public or private HTTPS hostname is deliberately unresolved until the Battle Bridge hosting and remote-access route are proven.

## Package and signing requirements

1. Create the app in Meta Horizon Developer Dashboard.
2. Preserve the resulting Meta application ID.
3. Install Meta's fork of Bubblewrap on the Battle Bridge.
4. Use the package ID `com.stephanos.spatialbridge` unless a collision or Meta requirement forces a reviewed change.
5. Select **immersive** app mode once the WebXR renderer is ready.
6. Generate the Quest icon assets from source.
7. Create a dedicated signing keystore.
8. Store the keystore and passwords outside the repository and back them up securely.
9. Build the signed APK.
10. Generate the SHA-256 signing fingerprint.
11. Replace the placeholders in `assetlinks.template.json` and publish it as `/.well-known/assetlinks.json` on the same HTTPS origin.
12. Verify Digital Asset Link success before describing the package as launchable.

## Distribution requirement

Use the invite-only ALPHA release channel and add Stephan's Meta account. Release-channel applications appear in the user's App Library and My Preview Apps.

Do not rely on sideloading for the normal experience. Sideloading is acceptable only for early engineering proof because sideloaded apps remain under Unknown Sources and are not platform-updated.

## Home profile

```text
Quest-local renderer
→ local Wi-Fi
→ authenticated Stephanos control plane
→ Battle Bridge
```

The Battle Bridge may still be wired to the home router. Air Link is not required for the bridge itself.

## Caravan profile

```text
Quest-local renderer
→ caravan Wi-Fi
→ Starlink
→ authenticated remote route
→ home Battle Bridge
```

The local bridge shell, comfort-critical rendering and offline fallback remain on Quest.

## Sunday Codex proof window

Codex is treated as unavailable until **Sunday 19 July 2026 at 20:35 Europe/London**.

At or after that time, the first proof lane is:

```text
node --test tests/spatial-bridge-v0.test.mjs
node apps/spatial-bridge/tools/build-icons.mjs
```

Then:

1. Confirm the generated icons exist and remain uncommitted.
2. Serve the exact PR head through HTTPS.
3. Open `quest-entry.html` in desktop Chromium and inspect manifest and service-worker status.
4. Implement or integrate the first immersive WebXR captain scene.
5. Verify no mutation or execution endpoints are reachable.
6. Package with Meta Bubblewrap in immersive mode.
7. Create and preserve the signing key.
8. Publish the exact Digital Asset Link file.
9. Upload the signed build to ALPHA.
10. Add Stephan's Meta account to the channel.
11. Confirm the icon appears in Quest App Library.
12. Launch from the icon and capture headset, console and network proof.
13. Test home and caravan profiles independently.
14. Remove or quarantine generated PNGs before any source commit or PR update.

## Safety gate

No future approval or execution control may be enabled merely because the Quest app launches. The first Quest build remains observation-only until identity, freshness, exact-target approval binding, stop/revoke and evidence-return paths are separately proven.
