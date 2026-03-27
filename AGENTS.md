# Stephanos repository agent guardrails

## Mandatory architecture invariants

1. Never collapse Stephanos launch semantics into one field.
   - Keep these distinct: `launcherEntry`, `runtimeEntry`, `launchEntry`.
   - `entry` is compatibility-only and cannot become authoritative.
2. Root launcher (`/`) is launcher-shell truth and must stay tile-first.
3. Mission Console/runtime target is separate from launcher shell target.
4. Secondary diagnostics/status UI must not render in the primary launcher body by default.
5. Localhost health alone is not truth. Source/build/served markers and MIME checks gate trust and reuse.

## File ownership boundaries

- Launcher-shell critical: `main.js`, `index.html`, `modules/command-deck/**`, `system/workspace.js`.
- Runtime/dist/build truth: `apps/stephanos/dist/**`, `scripts/build-stephanos-ui.mjs`, `scripts/verify-stephanos-dist.mjs`, `scripts/serve-stephanos-dist.mjs`.
- Validation/normalization truth: `system/apps/app_validator.js`.

Do not add Mission Console feature work into launcher-shell files during guardrail tasks.

## Required change hygiene

- Any change that touches Stephanos launch semantics must update/add tests covering field separation and target resolution order.
- Any change touching source/dist/served truth or process reuse must run build + verify + relevant tests.
- Never loosen validation to “get green”. Fail loudly when truth checks do not pass.

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
