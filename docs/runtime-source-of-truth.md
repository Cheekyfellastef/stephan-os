# Stephanos Runtime Source of Truth

## Live UI path
- **Launcher shell:** repository root `index.html` + `main.js`.
- **Live Stephanos app manifest:** `apps/stephanos/app.json`.
- **Served Stephanos iframe/document:** `apps/stephanos/dist/index.html`.
- **Authoring source of truth:** `stephanos-ui/src`.
- **Mission Console:** `stephanos-ui/src/components/AIConsole.jsx`.
- **AI router/settings store:** `stephanos-ui/src/state/aiStore.js`.
- **Theme:** `stephanos-ui/src/styles.css`.
- **Build config:** `stephanos-ui/vite.config.js`.

## Boot flow
1. Root `index.html` loads `main.js` and renders the launcher.
2. App discovery reads `apps/index.json` and `apps/stephanos/app.json`.
3. Stephanos resolves to `apps/stephanos/dist/index.html`.
4. Workspace opens that entry in an iframe.
5. `apps/stephanos/dist/index.html` loads the Vite bundle generated from `stephanos-ui/src/main.jsx`.

## Editing guidance
- Change Mission Console, provider router UI, or Stephanos theme **only** in `stephanos-ui/src/**`.
- Never hand-edit `apps/stephanos/dist/**`; it is generated output.
- Root launcher files are real, but they are **not** the Mission Console implementation.


## Build pipeline (source → dist)
1. `npm run stephanos:build` executes `scripts/build-stephanos-ui.mjs`.
2. Build metadata is computed from `stephanos-ui/src/**` + shared runtime/AI source fingerprints.
3. Vite builds from `stephanos-ui/index.html` + `stephanos-ui/src/main.jsx` into `apps/stephanos/dist` with `base: './'`.
4. Build output includes:
   - `apps/stephanos/dist/index.html`
   - hashed JS/CSS assets under `apps/stephanos/dist/assets/`
   - runtime metadata in `apps/stephanos/dist/stephanos-build.json` and embedded metadata in `dist/index.html`.

## Verification workflow
- Run `npm run stephanos:verify` after each build.
- Verification enforces:
  - launcher manifest points at `apps/stephanos/dist/index.html` via `entry: "dist/index.html"`
  - `dist/index.html` exists and contains generated-file banner
  - script/link assets exist and are dot-relative (`./...`) for GitHub Pages subpath safety
  - dist metadata matches current source fingerprint and runtime marker
  - route marker strings prove dist JS came from current source pipeline

## Runtime build marker
- Stephanos UI displays a visible runtime footer marker rendered from build-time constants (not hardcoded static text).
- Marker includes build timestamp (`buildTimestamp`), version, git commit, runtime marker token, source path, and fingerprint prefix.
- To confirm rebuild freshness, run build twice and compare footer `build:` value or `stephanos-build.json` `buildTimestamp`.

## Runtime truth contract
- The canonical route/provider/runtime decision snapshot is `runtimeStatusModel.canonicalRouteRuntimeTruth` from `shared/runtime/runtimeStatusModel.mjs`.
- Deterministic per-session runtime adjudication now runs through `shared/runtime/runtimeAdjudicator.mjs` and emits:
  - canonical adjudicated snapshot (`canonicalRouteRuntimeTruth`, also mirrored to `runtimeTruthSnapshot`),
  - grouped diagnostics model (`runtimeTruth`),
  - structured adjudicator issues (`runtimeAdjudication.issues`).
- Route selection is enforced once in the shared runtime status pipeline; UI diagnostics must render this snapshot instead of recomputing route truth.
- `buildFinalRouteTruthView` (`stephanos-ui/src/state/finalRouteTruthView.js`) is the approved UI projection layer for route kind, provider stage labels, preferred/actual target, reachability wording, fallback state, and operator reason text.
- `finalRouteTruth.uiReachabilityState` is tri-state runtime truth (`reachable | unreachable | unknown`); legacy boolean `uiReachable` is compatibility-only.
- Top-level compatibility fields (`routeKind`, `preferredTarget`, `actualTargetUsed`, `selectedProvider`, `activeProvider`) are non-authoritative and diagnostic-only.
- Home-node usability requires full truth (backend + UI/client reachability), not backend reachability alone.

## Lessons learned from finalRouteTruth rollout
- Stale top-level projections can silently override runtime truth unless projection precedence always favors `finalRouteTruth` first.
- Backend reachability is necessary but insufficient; route usability and launchability must remain separate checks.
- Home-node is usable only when the backend is reachable **and** the UI reachability chain is reachable.
- Dist fallback is a valid truthful outcome, but it must always be explicitly labeled as fallback.
- Requested, selected, and executed provider stages are distinct operator truths and must never be collapsed into one label.
- Unknown UI reachability must degrade honestly (`unknown`) and must not default to “reachable.”
- Truth drift often appears first in UI labels/operator copy before it appears as obvious routing breakage.

## Guardrails for contributors and Codex passes
- Do not derive route/provider semantics directly from raw `runtimeStatus` projection fields when `finalRouteTruth` or `buildFinalRouteTruthView` already provides the value.
- Do not present backend-only success as route readiness or home-node launchability.
- Do not label any fallback route as primary/live.
- Compatibility fields must never outrank `finalRouteTruth`.
- If legacy compatibility fields remain, label them diagnostic-only in UI and docs.
- Normalize restored persisted state before route truth is projected to UI (see shared runtime status normalization and `ensureRuntimeStatusModel` in `stephanos-ui/src/state/runtimeStatusDefaults.js`).

## Failure signatures (fast drift detection)
- Route kind and operator reason disagree.
- Active provider label collapses requested/selected/executed stages.
- Home-node appears available while UI reachability is unreachable/unknown.
- Hosted/remote session presents loopback-derived target as active truth.
- Dist path renders as normal healthy primary route instead of explicit fallback.
- Unknown reachability state silently renders as reachable.

## Recommended future work
- **Required now:** none, as long as runtime and UI truth tests stay green.
- **Optional purity upgrade:** move `uiReachabilityState` tri-state deeper into `routeEvaluations` and intermediate runtime objects so unknown/partial states cannot be flattened early.
- **Optional enforcement:** add stronger CI/static checks to block banned direct reads of compatibility projection fields in UI components.

## See also

- `docs/stephanos-routing-truths-and-guardrails.md` for local-vs-remote routing, home-node launchability, and dist fallback guardrails.
- `docs/stephanos-ui-build.md` for source→dist→runtime verification flow.
