# Stephanos Known Failure Patterns (Fast Triage Atlas)

Purpose: reduce triage thrash by mapping recurring symptoms to likely causes, first inspection points, and minimal fix directions.

## 1) Stale dist/server reuse outranks live source truth

- **Symptom:** source changed, runtime still behaves old; launcher appears healthy.
- **Likely causes:** stale served process reused despite marker/source/MIME mismatch; dist not rebuilt; cache stale.
- **Inspect first:** `scripts/serve-stephanos-dist.mjs`, `scripts/verify-stephanos-dist.mjs`, `scripts/build-stephanos-ui.mjs`, `apps/stephanos/dist/stephanos-build.json`.
- **Diagnostics:** Truth Panel build markers, `/__stephanos/health`, `/__stephanos/source-truth`, served module MIME checks.
- **Expected good behavior:** mismatch blocks silent reuse and forces supervised restart/failure.
- **False assumptions:** “health endpoint is green so build truth is current.”
- **Preferred minimal fix:** tighten reuse gate condition that was bypassed; do not disable checks.
- **Guardrail ideas:** explicit reuse rejection reason telemetry with gate-by-gate pass/fail ledger.

## 2) Localhost leakage into hosted/remote client session

- **Symptom:** hosted session selects local loopback route/provider assumptions.
- **Likely causes:** persisted local state restored without session-context normalization.
- **Inspect first:** `shared/runtime/runtimeStatusModel.mjs`, `shared/runtime/runtimeAdjudicator.mjs`, `stephanos-ui/src/state/runtimeStatusDefaults.js`, `shared/runtime/stephanosLocalUrls.mjs`.
- **Diagnostics:** session kind, selected route target, restore decision logs, finalRouteTruth reason.
- **Expected good behavior:** non-local session rejects loopback as active truth.
- **False assumptions:** “manual saved host should work from any client context.”
- **Preferred minimal fix:** normalize/drop loopback-only persisted values when session is non-local.
- **Guardrail ideas:** regression test for hosted restore with prior localhost memory.

## 3) MIME/content-type failures on served modules

- **Symptom:** launcher tiles missing, module imports fail, diagnostics still visible.
- **Likely causes:** server serving wrong content type or stale/bad module payload.
- **Inspect first:** `scripts/serve-stephanos-dist.mjs`, launcher-critical module URLs, import guard script.
- **Diagnostics:** browser console import errors, serve MIME probe logs, `npm run stephanos:guard:imports`.
- **Expected good behavior:** MIME mismatch fails verification/reuse rather than partially booting.
- **False assumptions:** “if index loads, module graph is fine.”
- **Preferred minimal fix:** restore correct static serving/MIME mapping and keep guard enabled.
- **Guardrail ideas:** expand mandatory MIME probes for all launcher-critical imports.

## 4) Route truth split across validator/runtime/UI projections

- **Symptom:** UI labels disagree with actual executed route.
- **Likely causes:** UI recomputes truth from compatibility fields instead of canonical finalRouteTruth.
- **Inspect first:** `system/apps/app_validator.js`, `shared/runtime/runtimeStatusModel.mjs`, `stephanos-ui/src/state/finalRouteTruthView.js`.
- **Diagnostics:** compare `runtimeStatusModel.finalRouteTruth` vs rendered labels.
- **Expected good behavior:** one canonical route truth projected to UI through approved adapter.
- **False assumptions:** “top-level compatibility fields are still authoritative.”
- **Preferred minimal fix:** route UI reads through `buildFinalRouteTruthView` only.
- **Guardrail ideas:** lint/test check banning direct compatibility-field reads in UI components.

## 5) Backend reachable but semantically misconfigured

- **Symptom:** backend reports reachable but provider execution fails or wrong provider path chosen.
- **Likely causes:** provider credentials/config invalid, provider eligibility mismatch to route.
- **Inspect first:** `stephanos-server/services/llm/providerRouter.js`, `stephanos-server/services/llm/providers/**`, `shared/runtime/runtimeAdjudicator.mjs`.
- **Diagnostics:** provider stage fields (requested/selected/executable), backend logs, runtime adjudication issues.
- **Expected good behavior:** provider stage drift is visible and fallback clearly labeled.
- **False assumptions:** “reachable backend equals executable provider.”
- **Preferred minimal fix:** correct provider eligibility/validation, preserve stage separation.
- **Guardrail ideas:** add invariant tests for provider stage consistency under degraded configs.

## 6) Provider fallback drift or misleading provider display

- **Symptom:** UI says provider A while execution used provider B fallback.
- **Likely causes:** flattened provider label logic or stale projection.
- **Inspect first:** `stephanos-ui/src/state/finalRouteTruthView.js`, runtime status projection consumers, provider defaults.
- **Diagnostics:** compare requested/selected/executable provider fields with rendered badge.
- **Expected good behavior:** display keeps stage distinctions explicit.
- **False assumptions:** “single provider label is enough.”
- **Preferred minimal fix:** tighten projection mapping, avoid collapsing fields.
- **Guardrail ideas:** snapshot tests for provider badge under fallback scenarios.

## 7) Dead-click / iframe overlay / pointer event blockage

- **Symptom:** tile appears but clicks do nothing or launch target never opens.
- **Likely causes:** overlay blocks pointer events, launch handler not bound, workspace iframe obstruction.
- **Inspect first:** `modules/command-deck/command-deck.js`, `system/workspace.js`, root styles affecting overlays.
- **Diagnostics:** click event logs, DOM overlay inspection, workspace open events.
- **Expected good behavior:** tile click emits launch action and workspace transition.
- **False assumptions:** “rendered tile implies functional click path.”
- **Preferred minimal fix:** remove/contain blocking overlay or restore binding.
- **Guardrail ideas:** smoke test that verifies click-to-workspace transition on representative tile.

## 8) Tile visible but non-launching due to entry semantics drift

- **Symptom:** tile visible, opens wrong page or does nothing in mixed app manifests.
- **Likely causes:** `launcherEntry/runtimeEntry/launchEntry` collapsed; raw `entry` treated as authoritative.
- **Inspect first:** `system/apps/app_validator.js`, `modules/command-deck/command-deck.js`, `system/workspace.js`, entry guard tests.
- **Diagnostics:** runtime app object snapshot and resolution order traces.
- **Expected good behavior:** fixed resolution order `launchEntry -> runtimeEntry -> entry`.
- **False assumptions:** “simplifying to one entry field is safe.”
- **Preferred minimal fix:** restore separation and fallback ordering.
- **Guardrail ideas:** keep/expand `tests/stephanos-entry-guardrails.test.mjs` and `tests/root-launcher-guardrails.test.mjs`.

## 9) Durable/shared memory not hydrating early enough

- **Symptom:** AI continuity feels reset; panel toggles/records appear late or inconsistent.
- **Likely causes:** memory/continuity services initialized after consumers; wrong memory layer used.
- **Inspect first:** `main.js` service registration, `shared/runtime/stephanosSessionMemory.mjs`, `shared/runtime/stephanosMemory.mjs`, `shared/runtime/stephanosContinuity.mjs`.
- **Diagnostics:** startup timing logs, missing bridge (`window.stephanosMemory`), session restore snapshots.
- **Expected good behavior:** session memory restores early; runtime truth recomputed; durable records available through shared service.
- **False assumptions:** “session layout persistence equals durable AI continuity.”
- **Preferred minimal fix:** move registration/restore earlier without changing contracts.
- **Guardrail ideas:** startup test asserting memory services exist before tile/app boot hooks run.

## 10) Hosted/local parity drift

- **Symptom:** works on localhost but fails in hosted/subfolder deployment.
- **Likely causes:** absolute asset paths, localhost-specific assumptions, base path regression.
- **Inspect first:** `stephanos-ui/vite.config.js`, built `apps/stephanos/dist/index.html`, route/URL helpers.
- **Diagnostics:** network tab for broken `/_assets`-style paths, runtime origin checks.
- **Expected good behavior:** dot-relative assets and subfolder-safe behavior.
- **False assumptions:** “local root deployment behavior matches GitHub Pages subpath behavior.”
- **Preferred minimal fix:** restore relative path generation and hosted-safe URL derivation.
- **Guardrail ideas:** CI check that dist assets remain `./`-relative.

## 11) Diagnostic surfaces contradict actual route execution

- **Symptom:** diagnostics claim one route/provider while behavior follows another.
- **Likely causes:** duplicated truth calculations in separate UI surfaces.
- **Inspect first:** `shared/runtime/truthEngine.mjs`, `shared/runtime/renderTruthPanel.mjs`, runtime status model consumers.
- **Diagnostics:** compare truth panel payload with canonical runtime adjudication object.
- **Expected good behavior:** diagnostics consume canonical adjudicated truth and show contradictions, not independent guesses.
- **False assumptions:** “diagnostic widgets are authoritative by default.”
- **Preferred minimal fix:** wire surface to canonical truth feed, remove parallel calculators.
- **Guardrail ideas:** contract test ensuring truth panel and runtime adjudicator share selected route/provider values.
