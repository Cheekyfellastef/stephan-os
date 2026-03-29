# Stephanos repository agent guardrails

Stephanos OS is a launcher-shell + runtime system with strict truth boundaries. Treat this file as the fast operating map before edits.

## Fast repo map (what is what)

- **Launcher shell (root, tile-first):** `index.html`, `main.js`, `modules/command-deck/**`, `system/workspace.js`.
- **Live Stephanos UI authoring source:** `stephanos-ui/src/**`.
- **Generated runtime output (not hand-edited):** `apps/stephanos/dist/**`.
- **Build + serve + verify truth gates:** `scripts/build-stephanos-ui.mjs`, `scripts/serve-stephanos-dist.mjs`, `scripts/verify-stephanos-dist.mjs`.
- **Validation/normalization truth:** `system/apps/app_validator.js`.
- **Constitutional law source:** `shared/runtime/stephanosLaws.mjs`.

## Mandatory architecture invariants

1. Never collapse launch semantics into one field.
   - Keep `launcherEntry`, `runtimeEntry`, `launchEntry` distinct.
   - `entry` is compatibility-only and non-authoritative.
2. Root launcher (`/`) is launcher-shell truth and remains tile-first.
3. Mission Console/runtime target is separate from launcher shell target.
4. Secondary diagnostics/status UI must not render in the primary launcher body by default.
5. Localhost health alone is not truth. Source/build/served markers + MIME checks gate trust/reuse.

## Route and target resolution rules (must preserve)

- Launch resolution order is fixed:
  1. `launchEntry`
  2. `runtimeEntry`
  3. `entry` (compatibility fallback only)
- Never treat backend reachability as route launchability without UI/client reachability truth.
- Never let hosted/remote sessions inherit loopback assumptions from localhost sessions.
- Dist fallback is valid when preferred runtime route is unlaunchable, but it must stay explicitly labeled as fallback.

## Truth model rules

- Do not treat generated dist as equivalent to live runtime truth.
- Keep source truth, built truth, served truth, and browser-loaded truth separated in analysis.
- Reality Sync (`shared/runtime/realitySync.mjs`) and Truth Engine (`shared/runtime/truthEngine.mjs`) are guardrails, not cosmetic status.
- Hosted/local/home-node truth differs by session context; do not poison remote clients with localhost assumptions.

## Memory and continuity rules

- Keep **session/UI memory** (`shared/runtime/stephanosSessionMemory.mjs`) separate from **durable Stephanos memory** (`shared/runtime/stephanosMemory.mjs`).
- Keep continuity/service context (`shared/runtime/stephanosContinuity.mjs`) separate from durable record storage.
- Use shared memory contracts for AI/tile data; do not add ad hoc storage contracts.
- Do not imply cross-device sync unless a real server adapter exists.

## Provider/backend truth rules

- Provider intent, selected provider, and executable provider are distinct truths.
- Backend reachable != provider semantically configured.
- Do not display fallback/provider stage labels as if they were primary route truth.

## Stephanos laws policy (mandatory)

1. Treat `shared/runtime/stephanosLaws.mjs` as repository policy, not optional commentary.
2. Before launcher/runtime/routing/build-truth edits, consult law IDs + related files.
3. If invariant-sensitive behavior changes, update laws/docs/tests in the same pass.
4. Do not ship behavior that violates active law status unless the law itself is explicitly updated.
5. Keep launcher-visible laws UI sourced from the structured law file.

## Debugging discipline (required)

- Inspect before editing; do not assume root cause.
- Preserve architecture and prefer minimal, truth-preserving fixes.
- Add diagnostics when ambiguity blocks reliable triage.
- Prevent split-brain truth surfaces (one concern, one authoritative model).
- Never loosen validation just to make checks pass.

## Implementation discipline (required)

- Avoid parallel competing state models.
- Prefer one authoritative model per concern and projection-only adapters for compatibility.
- Preserve GitHub Pages/subfolder-safe relative asset behavior.
- Do not silently introduce fake “healthy/current” states.
- Keep imports at the top of JS/MJS files; duplicate imports are forbidden.

Historical failure reminder (2026-03-27): duplicate/late imports in `modules/command-deck/command-deck.js` produced `Tile registry entries: 0` while diagnostics/laws still rendered.

## Required checks before claiming success

At minimum for launcher/runtime/guardrail edits:
- syntax check for touched JS/MJS,
- targeted tests for affected guardrails,
- `npm run stephanos:verify` (and `npm run stephanos:build` if dist truth changed),
- stale-process reuse guard tests,
- import guard checks.

## Response discipline for future Codex passes

- Explain root cause, not only symptom.
- Call out key assumptions and confidence boundaries.
- Name likely regression risks from the proposed change.
- When relevant, include adjacent hardening ideas that preserve existing truth boundaries.
