# Stephanos UI build guardrails

## Source of truth

- Live editable Stephanos UI: `stephanos-ui/src/**`
- Generated served runtime: `apps/stephanos/dist/**`
- Served localhost process truth: `http://127.0.0.1:4173/__stephanos/health` + currently served `dist/index.html` runtime marker.
- Root launcher files (`index.html`, `main.js`) are real, but they are only the launcher shell and app loader.
- Do **not** hand-edit `apps/stephanos/dist/**`.

### Truth chain guardrail (source → dist → served)

- **Source truth** = `stephanos-ui/src/**` + shared runtime inputs used to compute the source fingerprint.
- **Built dist truth** = generated `apps/stephanos/dist/**` + `apps/stephanos/dist/stephanos-build.json`.
- **Served localhost truth** = what the running dist server actually serves right now (health + served index marker).
- Runtime behavior is trusted only when all three truths agree on runtime marker/source fingerprint.

## Commands

Run these from the repository root:

- `npm run stephanos:dev` — start the backend plus the live Vite UI.
- `npm run stephanos:clean` — remove generated dist output.
- `npm run stephanos:build` — rebuild `apps/stephanos/dist/**` from the live `stephanos-ui` source.
- `npm run stephanos:verify` — fail fast if dist is missing, incomplete, stale, or built from the wrong source.
- `npm run stephanos:serve` — rebuild, verify, and serve the project so the generated runtime can be checked at `/apps/stephanos/dist/`.
- `npm run deploy` — enforced publish gate; runs build + verify before any publish step.
- `npm run stephanos:precommit` — lightweight manual pre-commit check for source + dist sync.

## What the build now proves

Each Stephanos build writes metadata into both `apps/stephanos/dist/index.html` and `apps/stephanos/dist/stephanos-build.json`, including:

- app name,
- version,
- source identifier,
- source fingerprint,
- build timestamp,
- git commit hash when available,
- build target identifier,
- runtime id and runtime marker.

That same metadata is surfaced in:

- the console boot log,
- the runtime status panel,
- the runtime footer/status strip,
- generated dist metadata files.

## Verification rules

`npm run stephanos:verify` checks that:

1. `apps/stephanos/dist/index.html` exists,
2. every asset referenced by `dist/index.html` exists,
3. `apps/stephanos/dist/stephanos-build.json` exists and is valid,
4. the embedded HTML metadata matches the dist metadata file,
5. the source identifier proves the build came from `stephanos-ui/src`,
6. the runtime marker is present,
7. the current source fingerprint still matches the generated dist.

If dist metadata is stale (for example: runtime marker mismatch between source expectations and generated files), verify must fail instead of silently accepting drift.

## Launcher process reuse guardrail

- Process reuse is gated by **runtimeMarker parity**, not health checks alone.
- Why: health-only reuse can accidentally keep a stale localhost process alive after source changes.
- Reuse is allowed only if the existing process is a Stephanos dist server, runtime URLs are ready, module MIME checks pass, and expected marker equals both:
  - marker from `__stephanos/health`, and
  - marker embedded in served `dist/index.html`.

## Deploy rule

Required order before publish: **build → verify → publish**.

If you edit `stephanos-ui/src/**`, rebuild and verify before commit or deployment. Commit the source change and regenerated dist together so the served runtime cannot drift.

Required workflow after launcher/runtime-affecting source edits (including `stephanos-ui/src/**`, `shared/runtime/**`, launcher boot/serve scripts):

1. `npm run stephanos:build`
2. `npm run stephanos:verify`
3. Restart or rerun `npm run stephanos:serve` if localhost was already running (so marker-gated reuse can reject stale processes).
4. Confirm the root launcher build stamp (`index.html` shell) shows the expected marker/timestamp.

## Operator support snapshot (Status panel)

- In the Mission Console **Status** panel, operators can click **Copy Support Snapshot** to copy a compact diagnostics block for ChatGPT/Codex.
- The snapshot is built from canonical runtime truth (`runtimeStatus.finalRouteTruth` / runtime adjudicator projections) plus safe status metadata; unknown values are labeled explicitly.
- Secrets (API keys, auth tokens, raw sensitive config) are intentionally excluded by design.

## Fast triage (operator quick path)

1. **Run first:** `npm run stephanos:verify`.
2. **Compare markers:**
   - expected/built: `apps/stephanos/dist/stephanos-build.json` → `runtimeMarker`
   - served health: `http://127.0.0.1:4173/__stephanos/health` → `runtimeMarker`
   - served index: `apps/stephanos/dist/index.html` meta `stephanos-build-runtime-marker`
3. **Detect stale localhost process:**
   - health is OK, but health/index marker differs from local dist metadata marker, or launcher build stamp shows an old marker/timestamp.
4. **If verify fails:**
   - rebuild dist (`npm run stephanos:build`), rerun verify, then restart serve process if needed.
