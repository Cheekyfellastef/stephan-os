# Stephanos UI build guardrails

## Source of truth

- Live editable Stephanos UI: `stephanos-ui/src/**`
- Generated served runtime: `apps/stephanos/dist/**`
- Root launcher files (`index.html`, `main.js`) are real, but they are only the launcher shell and app loader.
- Do **not** hand-edit `apps/stephanos/dist/**`.

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

## Deploy rule

Required order before publish: **build → verify → publish**.

If you edit `stephanos-ui/src/**`, rebuild and verify before commit or deployment. Commit the source change and regenerated dist together so the served runtime cannot drift.
