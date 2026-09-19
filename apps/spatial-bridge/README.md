# Stephanos Spatial Bridge V0

## Status

Flat source prototype and Quest PWA entry scaffold built. Deterministic execution, immersive WebXR, packaging, signing, release-channel installation, Battle Bridge, controller and Quest proof are pending.

This app remains read-only. The flat prototype consumes only `bridge-state.v0.json`, a bundled mock projection with `readOnly: true` and `authority: none`.

## Chosen Quest route

The intended one-icon experience is an **immersive WebXR Progressive Web App** distributed to Stephan through an invite-only Meta Horizon **ALPHA release channel**.

That route is preferred because it can place Stephanos in the normal Quest App Library and launch directly into an immersive experience while using the same Quest-local renderer at home and in the caravan.

Air Link remains an optional separate PCVR or high-fidelity media route. It is not required to open the Stephanos bridge.

## Prototype routes

Flat surface:

```text
/apps/spatial-bridge/index.html
```

Quest entry staging shell:

```text
/apps/spatial-bridge/quest-entry.html
```

Transport simulation routes:

```text
/apps/spatial-bridge/index.html?mode=home
/apps/spatial-bridge/index.html?mode=caravan
/apps/spatial-bridge/index.html?mode=degraded
```

## Included in the branch

- captain mission view
- Quest-local home, caravan Starlink and degraded read-only simulations in the flat prototype
- department selection and captain detail focus
- mock transport telemetry
- evidence and readiness panels
- responsive flat-screen layout
- reduced-motion support
- keyboard navigation suitable for later controller mapping
- strict rejection of projections that are not read-only or that carry authority
- Quest PWA web manifest
- Quest entry staging shell
- offline service worker and read-only fallback
- source-only deterministic generator for 192px and 512px PNG icons
- Digital Asset Link template
- private Alpha release-channel deployment contract
- exact Sunday Codex proof window and task packet

## Generated packaging assets

The repository firewall rejects committed images and binary files. Generate the required PNG icons during packaging:

```text
node apps/spatial-bridge/tools/build-icons.mjs
```

For verification without dirtying the application folder:

```text
node apps/spatial-bridge/tools/build-icons.mjs --output-dir tmp/spatial-bridge-icons
```

Generated PNGs are deployment artifacts and must not be committed.

## Explicitly not yet included

- live Stephanos state
- immersive WebXR captain scene
- packaged or signed Quest APK
- verified Digital Asset Link
- Meta Developer Dashboard application ID
- Alpha-channel upload or installation
- voice recognition
- gaze tracking
- Xbox controller proof
- AI requests
- approvals
- agent dispatch
- OpenClaw, Codex or Battle Bridge command routes
- network writes

## Deterministic source test

```text
node --test tests/spatial-bridge-v0.test.mjs
```

The test generates and validates the PNG icons inside a temporary directory, then removes them.

## Codex availability

Codex is treated as unavailable until **Sunday 19 July 2026 at 20:35 Europe/London**.

Before that time, design, source contracts, PWA scaffolding, offline behaviour, icon generation, safety gates and proof instructions can continue without Codex.

At or after that time, Codex should work at the exact PR head and:

1. Run `node --test tests/spatial-bridge-v0.test.mjs`.
2. Generate deployment icons with `node apps/spatial-bridge/tools/build-icons.mjs`.
3. Run the repository app or static-surface validation used by the launcher.
4. Serve the repository through a trusted HTTPS route.
5. Confirm the launcher discovers **Stephanos Spatial Bridge**.
6. Open the flat prototype and Quest entry shell and record screenshot, DOM, manifest, service-worker and console evidence.
7. Confirm all simulation controls change only local presentation state.
8. Confirm no POST, PUT, PATCH or DELETE request is emitted.
9. Implement or integrate the first immersive WebXR captain scene.
10. Package with Meta's forked Bubblewrap in immersive mode.
11. Create and preserve the signing keystore outside the repository.
12. Generate and publish the exact Digital Asset Link statement.
13. Upload the signed build to the invite-only ALPHA release channel.
14. Add Stephan's Meta account to the channel.
15. Prove the icon appears in Quest App Library and launches from the icon.
16. Test Quest-local home and caravan profiles independently.
17. Map and prove Xbox controller inputs separately.
18. Record comfort, readability, network and frame-pacing evidence.
19. Remove or quarantine generated icon artifacts before any source commit or PR update.

See `QUEST-DEPLOYMENT.md` and `quest-entry-contract.v1.json` for the full handoff.

## Merge gate

Do not merge merely because the source looks plausible. Merge only after the exact PR head has:

- deterministic test proof
- launcher discovery proof
- browser render and console proof
- PWA manifest and service-worker proof
- generated icon validation
- confirmation that the surface remains read-only
- an explicit record that immersive WebXR, Quest Library installation, controller and headset proof are either observed or still deferred

The app must never be described as a working Quest VR bridge until immersive rendering, signed packaging, Digital Asset Link verification, Alpha-channel installation and on-headset launch are observed.
