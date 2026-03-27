# Stephanos repository agent guardrails

## Mandatory architecture invariants

1. Never collapse Stephanos launch semantics into one field.
   - Keep these distinct: `launcherEntry`, `runtimeEntry`, `launchEntry`.
   - `entry` is compatibility-only and cannot become authoritative.
2. Root launcher (`/`) is launcher-shell truth and must stay tile-first.
3. Mission Console/runtime target is separate from launcher shell target.
4. Secondary diagnostics/status UI must not render in the primary launcher body by default.
5. Localhost health alone is not truth. Source/build/served markers and MIME checks gate trust and reuse.

## Stephanos laws policy (mandatory)

1. Treat `shared/runtime/stephanosLaws.mjs` as repository policy, not optional commentary.
2. Before editing launcher/runtime/routing/build-truth behavior, consult the laws source and relevant law IDs.
3. If you change invariant-sensitive behavior, update law references and tests in the same pass.
4. Do not ship changes that violate an active law status unless the law itself is explicitly updated (with docs/tests).
5. Keep runtime-visible laws UI sourced from the structured law file; do not fork law text in disconnected UI copies.

## File ownership boundaries

- Launcher-shell critical: `main.js`, `index.html`, `modules/command-deck/**`, `system/workspace.js`.
- Runtime/dist/build truth: `apps/stephanos/dist/**`, `scripts/build-stephanos-ui.mjs`, `scripts/verify-stephanos-dist.mjs`, `scripts/serve-stephanos-dist.mjs`.
- Validation/normalization truth: `system/apps/app_validator.js`.

Do not add Mission Console feature work into launcher-shell files during guardrail tasks.

## Required change hygiene

- Any change that touches Stephanos launch semantics must update/add tests covering field separation and target resolution order.
- Any change touching source/dist/served truth or process reuse must run build + verify + relevant tests.
- Never loosen validation to “get green”. Fail loudly when truth checks do not pass.
- Imports must only appear at the top of files. Duplicate imports are forbidden. Any change violating this must fail guard-import-structure before merge.
- Historical failure reminder (2026-03-27): duplicate/late imports in `modules/command-deck/command-deck.js` caused launcher tiles to disappear (`Tile registry entries: 0`) even while diagnostics/laws UI remained visible.

## Required launch resolution order

For Stephanos launch actions, resolve target as:
1. `launchEntry`
2. `runtimeEntry`
3. `entry` (compatibility fallback only)

## Required checks before claiming success

At minimum for launcher/runtime/guardrail edits:
- syntax check for touched JS/MJS files,
- targeted tests covering new guardrails,
- `npm run stephanos:verify` (and `npm run stephanos:build` if dist truth changed),
- stale-process reuse guard tests.


## Reality Sync policy (mandatory)

- Treat Reality Sync (`shared/runtime/realitySync.mjs`) as build-truth guardrail behavior, not a cosmetic notifier.
- Launcher/runtime changes that affect build markers or truth-source availability must preserve:
  - displayed marker/timestamp capture,
  - latest authoritative marker/timestamp resolution,
  - stale/current contradiction reporting,
  - loop-protected auto-refresh behavior.
- Reality Sync authoritative source order should remain explicit and documented in code/tests.
- Keep the System Panel Reality Sync toggle persisted via shared session memory UI layout state.
- If truth sources are unavailable (especially hosted contexts), surface degraded confidence/state instead of claiming current truth.

## Truth Engine and toggle policy

- Truth Engine (`shared/runtime/truthEngine.mjs`) is the operational self-audit layer and must stay data-driven from runtime/build/module truth signals.
- Laws panel (`shared/runtime/renderStephanosLawsPanel.mjs`) remains the constitutional layer and must stay distinct from the Truth Panel.
- Runtime Diagnostics, Launcher Runtime Fingerprint, and Truth Panel visibility controls live in the system panel/cog popup and must remain toggleable with persisted state.
- Future truth-surface changes must preserve toggle integration + persisted visibility behavior.

## Stephanos memory architecture policy

- Keep UI/session memory (`shared/runtime/stephanosSessionMemory.mjs`) distinct from durable Stephanos memory (`shared/runtime/stephanosMemory.mjs`).
- AI systems and tiles must use the shared Stephanos memory contract rather than creating ad hoc storage keys/contracts.
- Localhost vs hosted memory semantics must stay explicit; do not imply cross-device sync without a real server-backed adapter path.
