# Stephanos Spatial Bridge V0

## Status

Source prototype built. Battle Bridge, browser, Air Link, controller and Quest proof are pending.

This app is a read-only flat prototype for the future Stephanos spatial command surface. It consumes only `bridge-state.v0.json`, a bundled mock projection with `readOnly: true` and `authority: none`.

## Prototype route

```text
/apps/spatial-bridge/index.html
```

Transport simulation routes:

```text
/apps/spatial-bridge/index.html?mode=home
/apps/spatial-bridge/index.html?mode=caravan
/apps/spatial-bridge/index.html?mode=degraded
```

## Included in V0

- captain mission view
- home Air Link, caravan Starlink and degraded read-only simulations
- department selection and captain detail focus
- mock transport telemetry
- evidence and readiness panels
- responsive flat-screen layout
- reduced-motion support
- keyboard navigation suitable for later controller mapping
- strict rejection of projections that are not read-only or that carry authority

## Explicitly not included

- live Stephanos state
- WebXR or native Quest packaging
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

## Codex and Battle Bridge proof handoff

When Codex capacity is available, perform the following on an isolated branch or worktree at the exact PR head:

1. Run `node --test tests/spatial-bridge-v0.test.mjs`.
2. Run the repository app or static-surface validation used by the launcher.
3. Serve the repository through the canonical Stephanos local route.
4. Confirm the launcher discovers **Stephanos Spatial Bridge**.
5. Open `/apps/spatial-bridge/index.html?mode=home` and record screenshot, DOM and console evidence.
6. Confirm all three simulation modes change only local presentation state.
7. Confirm department buttons update the captain detail panel without network writes.
8. Confirm the page remains usable at desktop, tablet and narrow viewport widths.
9. Confirm `prefers-reduced-motion` removes non-essential transitions.
10. Confirm no POST, PUT, PATCH or DELETE request is emitted.
11. Confirm no AI, OpenClaw, Codex or Battle Bridge command endpoint is called.
12. Test keyboard navigation, then map and prove the intended Xbox controller inputs separately.
13. Open through the normal home Air Link workflow and record comfort, readability and frame-pacing observations.
14. Do not report Quest or Air Link proof based only on desktop browser success.

## Merge gate

Do not merge merely because the source looks plausible. Merge only after the exact PR head has:

- deterministic test proof
- launcher discovery proof
- browser render and console proof
- confirmation that the surface remains read-only
- an explicit record that Quest, Air Link and controller proof are either observed or still deferred

The app is deliberately useful as a flat prototype before headset proof, but it must never be described as a working VR bridge until observed in the intended environment.
