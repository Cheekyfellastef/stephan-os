# Stephanos UI build guardrails

## Source of truth

- Edit the live Stephanos UI only in `stephanos-ui/src/**`.
- Production is served from `apps/stephanos/dist/**`.
- `apps/stephanos/dist/**` is generated output, not hand-edited source.

## Build and verification commands

From the repository root:

- `npm run dev` — starts the Stephanos server plus the Vite UI dev server.
- `npm run build` — rebuilds `apps/stephanos/dist/**` from `stephanos-ui/src/**`.
- `npm run verify` — checks for drift by validating:
  - `apps/stephanos/dist/index.html` exists,
  - every asset referenced by `dist/index.html` exists,
  - embedded runtime metadata matches the current source version, source identifier, build target, runtime marker, and current git commit,
  - a valid build timestamp is present.

## Build metadata written into dist

Each Stephanos UI build writes metadata into the generated app, including:

- version,
- source identifier,
- build target,
- git commit hash when available,
- build timestamp,
- runtime marker used by the app diagnostics.

This metadata is surfaced in:

- the browser console boot logs,
- the runtime status panel,
- the footer diagnostic strip,
- embedded JSON metadata in `apps/stephanos/dist/index.html`.

## Regeneration rule

If you change anything in `stephanos-ui/src/**`, the expected next commands are:

```bash
npm run build
npm run verify
```

If `npm run verify` fails, treat `apps/stephanos/dist/**` as stale and rebuild it instead of editing dist manually.
