# Stephanos Guardrails v2 (Launcher / Runtime / Routing)

## Scope
This file is a hard policy for launcher/runtime/routing edits. It is not optional guidance.
Machine-readable companion policy lives in `shared/runtime/stephanosLaws.mjs`.
Human/operator guide lives in `docs/stephanos-laws.md`.

## Truth model (must stay separated)

### 1) Root launcher truth
- Canonical launcher shell: `http://127.0.0.1:4173/`.
- Root launcher is tile-first.
- Secondary diagnostics/status surfaces are opt-in and must never render in the primary launcher body by default.

### 2) Runtime truth
- Mission Console/runtime target is distinct from launcher shell.
- Runtime usually resolves to `apps/stephanos/dist/index.html` (or another validated runtime URL).
- Runtime target cannot overwrite launcher shell identity.

### 3) Backend truth
- Backend health is required but never sufficient to claim runtime/build truth.
- Backend reachability, runtime marker parity, and served artifact checks are separate validations.

### 4) Source vs built vs served truth
All three must agree, or verification fails:
- Source truth: repo code.
- Built truth: `apps/stephanos/dist/**` + `stephanos-build.json`.
- Served truth: what `:4173` health + served index/module MIME return.

## Stephanos entry semantics (do not collapse)
- `launcherEntry`: canonical launcher shell target.
- `runtimeEntry`: validated Mission Console/runtime target.
- `launchEntry`: actual navigation target for this action/context.
- `entry`: compatibility field only.

Rules:
1. `entry` may mirror `launchEntry` for compatibility.
2. Compatibility updates must never erase `launcherEntry` / `runtimeEntry` / `launchEntry`.
3. Target resolution for launch actions is: `launchEntry -> runtimeEntry -> entry`.

## Forbidden collapses / shortcuts
Never:
- set all entry fields to one URL “for simplicity”.
- treat `app.entry` as authoritative Stephanos semantic truth.
- route a tile click to launcher shell when runtime target is valid.
- inject diagnostics/status surfaces into primary launcher tile body by default.
- treat localhost health as proof that source/build/served truth is current.

## Stale process reuse policy
A healthy process is reusable only when all gates pass:
1. service identity + mount/static-root checks pass,
2. health runtime marker matches expected local dist marker,
3. served index runtime marker matches expected local dist marker,
4. launcher-critical module MIME checks pass,
5. launcher-critical source parity check (`/__stephanos/source-truth`) matches on-disk SHA-256 hashes.

Any mismatch => reject reuse and force operator restart.

## Diagnostics rendering boundary
- Launcher tile grid (`#project-registry`) is primary.
- Diagnostics/status belong in isolated secondary mounts only.
- Secondary surfaces require explicit enable flag.

## Operator fast triage (after bad Codex pass)
1. Inspect live Stephanos object fields: `launcherEntry`, `runtimeEntry`, `launchEntry`, `entry`.
2. If root opens runtime directly, inspect validator normalization (`system/apps/app_validator.js`).
3. If tile click opens wrong URL, inspect launch target resolution (`modules/command-deck/command-deck.js`, `system/workspace.js`).
4. If behavior disagrees with source, run:
   - `npm run stephanos:build`
   - `npm run stephanos:verify`
5. If localhost appears healthy but behavior is stale, inspect served marker + module MIME gates in `scripts/serve-stephanos-dist.mjs`.

## Codex failure signatures to treat as guardrail violations
- `launcherEntry === runtimeEntry` in root-launcher context without explicit reason.
- Tile click using raw `entry` when separated fields exist.
- Root launcher showing diagnostics/status content in primary tile body.
- Reusing existing local server with marker mismatch or bad module MIME.
- Build metadata mismatch between `dist/index.html` and `stephanos-build.json`.

## Import structure enforcement (launcher-critical)
- Imports must remain in the file's top import section (comments/blank lines may precede them).
- Duplicate imported bindings in the same file are forbidden.
- Enforced gate: `npm run stephanos:guard:imports` (also runs inside `npm run stephanos:verify`).
- Incident note: this exact failure class previously caused root launcher tile loss (`Tile registry entries: 0`) after `command-deck.js` hit a duplicate import declaration.

## Constitutional law linkage (Stephanos Laws layer)

Guardrails v2 is now mirrored by a structured law layer:

- Runtime law source: `shared/runtime/stephanosLaws.mjs`
- UI renderer: `shared/runtime/renderStephanosLawsPanel.mjs`
- Launcher-visible surface: `index.html#stephanos-laws-mount`

When changing launcher/runtime/routing behavior, update tests/docs/law mappings together. Do not let prose policy and structured law source diverge.


## Reality Sync policy (stale-screen correlation)

- Reality Sync is mandatory launcher/runtime behavior: displayed build truth must be correlated with latest authoritative truth.
- Authoritative truth priority for runtime sync checks: `__stephanos/source-truth` (when it exposes marker/timestamp) -> `__stephanos/health` -> `apps/stephanos/dist/stephanos-build.json` -> currently displayed build proof fallback.
- When displayed marker/timestamp is older than latest detected truth, launcher must surface stale state and contradiction in Truth Panel.
- Auto-reconcile may use full reload for reliability, but must include loop protections:
  1. marker/timestamp must actually change,
  2. per-marker refresh attempt cap,
  3. refresh cooldown.
- Operator must retain a persisted System Panel toggle (`Reality Sync / Auto Truth Refresh`). Disabled mode still reports stale state but does not auto-refresh.
- Hosted and localhost flows may expose different truth depth; when endpoints are unavailable, Reality Sync must report reduced confidence rather than claiming current truth.

## Truth Engine and operator toggles

- Truth Engine (`shared/runtime/truthEngine.mjs`) is the operational self-audit layer (reality snapshot + contradictions), not decorative status text.
- Laws panel is constitutional guidance and stays separate from operational Truth Panel output.
- System-panel/cog popup owns operator toggles for Runtime Diagnostics, Launcher Runtime Fingerprint, and Truth Panel.
- Visibility toggle state should persist via shared Stephanos session-memory UI layout fields so surfaces restore consistently after reload.
