# Stephanos System Model (Quick Operational Mental Model)

Purpose: load the living system quickly without re-deriving architecture from scattered files.

## 1) Boot and ignition flow

1. Root `index.html` loads launcher shell.
2. Root `main.js` boots launcher runtime services (event bus, service registry, workspace, diagnostics, laws/truth surfaces).
3. App discovery + validation runs through `system/apps/app_discovery.js` and `system/apps/app_validator.js`.
4. Command Deck renders tiles from validated app definitions.
5. Tile launch resolves target using entry semantics (`launchEntry -> runtimeEntry -> entry`).
6. For Stephanos app launches, workspace opens `apps/stephanos/dist/index.html` (or other validated runtime target) in the runtime frame.

## 2) Launcher shell responsibilities (root)

- Tile-first primary UX and workspace transitions.
- App discovery/validation normalization.
- Runtime/laws/truth panel mounts as secondary surfaces.
- Session/UI toggle persistence via session memory.
- Runtime continuity + memory services registration for shared integrations.

Not launcher-shell responsibilities:
- Mission Console feature implementation,
- provider UI internals,
- Vite app styling/logic owned by `stephanos-ui/src/**`.

## 3) Live runtime responsibilities (Stephanos UI)

Source: `stephanos-ui/src/**`.
Built artifact: `apps/stephanos/dist/**`.

Runtime responsibilities include:
- Mission Console UX,
- route/provider state projection,
- runtime status/truth UI,
- AI/tile interaction surfaces,
- support snapshot and diagnostics views.

## 4) Backend responsibilities

`stephanos-server/**` handles backend API concerns:
- provider routing/execution,
- memory service endpoints,
- provider secrets and config bridges,
- backend reachability used by runtime adjudication.

Backend health is necessary but not sufficient for route launchability truth.

## 5) Route selection and truth model

Operational route truth is adjudicated in shared runtime modules:
- `shared/runtime/runtimeStatusModel.mjs`
- `shared/runtime/runtimeAdjudicator.mjs`
- UI projection adapter: `stephanos-ui/src/state/finalRouteTruthView.js`

Core rules:
- Route truth is recomputed per session/device context.
- Hosted/non-local sessions cannot trust loopback leftovers.
- Home-node usability requires backend + UI/client reachability truth.
- Dist fallback is valid but must stay labeled as fallback.

## 6) Target selection model (entry semantics)

Stephanos launch fields remain separated:
- `launcherEntry`: launcher shell truth.
- `runtimeEntry`: validated Mission Console/runtime target.
- `launchEntry`: action-context target.
- `entry`: compatibility-only fallback.

Required launch resolution order:
1. `launchEntry`
2. `runtimeEntry`
3. `entry`

## 7) Memory hydration and continuity flow

Separate memory layers:
- Session/UI memory: `shared/runtime/stephanosSessionMemory.mjs`.
- Durable Stephanos memory: `shared/runtime/stephanosMemory.mjs`.
- Continuity context: `shared/runtime/stephanosContinuity.mjs`.

Hydration guidance:
- Restore intent/layout from session memory.
- Recompute runtime execution truth (never restore it as authoritative persisted fact).
- Keep durable AI/tile records under shared memory APIs.

## 8) Tile/app discovery flow

- `apps/index.json` + app manifests discovered.
- Validator normalizes entry semantics and guardrails malformed targets.
- Command Deck renders actionable tiles.
- Workspace executes selected launch target and tracks active workspace state.

## 9) Provider selection / fallback flow

- Requested provider intent is distinct from selected and executable provider.
- Provider viability depends on route and backend semantics, not only preference.
- Runtime truth surfaces must show stage separation (requested/selected/executable) and fallback state explicitly.

## 10) Truth surfaces and invariants

Primary truth mechanisms:
- Laws (policy/invariants): `shared/runtime/stephanosLaws.mjs`.
- Runtime truth/adjudication: `runtimeStatusModel` + `runtimeAdjudicator`.
- Operational contradictions: `shared/runtime/truthEngine.mjs`.
- Stale/current reconciliation: `shared/runtime/realitySync.mjs`.
- Build/source/served checks: build + verify + serve guard scripts.

Do not collapse these into a single “healthy” bit.

## 11) Local vs hosted vs remote-client behavior

- Localhost sessions can validly use loopback-local routes.
- Hosted/remote sessions must reject poisoned loopback assumptions.
- Home-node sessions are remote-mode truth and must validate launchability end-to-end.
- Confidence must degrade honestly when truth endpoints are unavailable.

## 12) Where AI continuity and durable memory fit

AI/tile systems should:
- use shared durable memory contracts,
- read adjudicated runtime truth for operational context,
- write continuity summaries/events through continuity service,
- avoid ad hoc storage keys and duplicated state contracts.
