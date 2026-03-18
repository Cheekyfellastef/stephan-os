# stephan-os

Core architecture and development of Stephanos OS.

## Stephanos UI source vs generated dist

- **Live source:** edit the Stephanos UI only under `stephanos-ui/src/**`.
- **Generated production artifact:** `apps/stephanos/dist/**` is what the launcher serves via `apps/stephanos/app.json`.
- **Do not hand-edit dist:** `apps/stephanos/dist/**` is generated output and must be rebuilt from source.

## Commands

- `npm run dev` — run the Stephanos server and the live Vite UI for development.
- `npm run build` — build `stephanos-ui/src/**` into `apps/stephanos/dist/**`.
- `npm run verify` — validate that `apps/stephanos/dist/**` exists, references real assets, and matches current build metadata.

## Required workflow after editing Stephanos UI source

1. Edit files in `stephanos-ui/src/**`.
2. Run `npm run build`.
3. Run `npm run verify`.

For a slightly longer explanation of the source-of-truth rule and the build protections, see `docs/stephanos-ui-build.md`.
