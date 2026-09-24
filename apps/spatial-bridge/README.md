# Stephanos Spatial Bridge V0

## Status

The flat source prototype and Quest PWA entry are built, and the #1717 Holodeck Baseline now includes the first dependency-free immersive WebXR captain-scene source path. Deterministic source proof is available, while signed packaging, release-channel installation, physical Quest 3 observation, controller acceptance, Battle Bridge runtime proof and headset acceptance remain pending.

This app remains read-only. The flat prototype consumes only `bridge-state.v0.json`, a bundled mock projection with `readOnly: true` and `authority: none`; that fixture is never evidence of live Stephanos/backend reachability.

## Chosen Quest route

The intended one-icon experience is an **immersive WebXR Progressive Web App** distributed to Stephan through an invite-only Meta Horizon **ALPHA release channel**.

That route is preferred because it can place Stephanos in the normal Quest App Library and launch directly into an immersive experience while using the same Quest-local renderer at home and in the caravan.

Air Link remains an optional separate PCVR or high-fidelity media route. It is not required to open the Stephanos bridge.

## Prototype routes

Flat surface:

```text
/apps/spatial-bridge/index.html
```

Quest Holodeck Baseline entry:

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
- Quest Holodeck Baseline entry with bounded WebXR session handling and fail-closed fallback
- offline service worker and read-only fallback shell
- source-only deterministic generator for 192px and 512px PNG icons
- Digital Asset Link template
- private Alpha release-channel deployment contract

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

## Explicitly not yet included or proven

- live Stephanos state or live backend reachability
- packaged or signed Quest APK
- verified Digital Asset Link
- Meta Developer Dashboard application ID
- Alpha-channel upload or installation
- physical Quest 3 immersive observation or acceptance
- offline availability of destinations outside the Spatial Bridge service-worker scope
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
node --test tests/spatial-bridge-v0.test.mjs tests/spatial-bridge-holodeck-baseline-v0.test.mjs
```

The source tests validate the flat contract, Holodeck Baseline source-readiness boundary and PNG generation without promoting physical headset proof.

## Remaining delivery work

After exact-head source proof and review are clean:

1. Generate deployment icons with `node apps/spatial-bridge/tools/build-icons.mjs`.
2. Run the repository app or static-surface validation used by the launcher.
3. Serve the repository through a trusted HTTPS route.
4. Confirm the launcher discovers **Stephanos Spatial Bridge**.
5. Open the flat prototype and Quest Holodeck entry and record screenshot, DOM, manifest, service-worker and console evidence.
6. Confirm all simulation controls change only local presentation state.
7. Confirm no POST, PUT, PATCH or DELETE request is emitted.
8. Package with Meta's forked Bubblewrap in immersive mode.
9. Create and preserve the signing keystore outside the repository.
10. Generate and publish the exact Digital Asset Link statement.
11. Upload the signed build to the invite-only ALPHA release channel.
12. Add Stephan's Meta account to the channel.
13. Prove the icon appears in Quest App Library and launches from the icon.
14. Test Quest-local home and caravan profiles independently.
15. Map and prove Xbox controller inputs separately.
16. Record comfort, readability, network and frame-pacing evidence.
17. Remove or quarantine generated icon artifacts before any source commit or PR update.

See `QUEST-DEPLOYMENT.md` and `quest-entry-contract.v1.json` for the full handoff.

## Merge gate

Do not merge merely because the source looks plausible. Merge only after the exact PR head has:

- deterministic test proof
- launcher discovery proof
- browser render and console proof
- PWA manifest and service-worker proof
- generated icon validation
- confirmation that the surface remains read-only
- an explicit record separating WebXR source readiness from packaging, Quest Library installation, controller and physical headset proof

The Holodeck Baseline may be described as source-ready only when its exact-head source/tests/review prove that claim. The app must never be described as a working Quest VR bridge until signed packaging, Digital Asset Link verification, Alpha-channel installation and on-headset launch are observed.
