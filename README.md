# stephan-os

Core architecture and development of Stephanos OS.

## Stephanos live UI pipeline

- **Live editable Mission Console source:** `stephanos-ui/src/**`
- **Served/generated runtime:** `apps/stephanos/dist/**`
- **Launcher shell only:** the root `index.html` and `main.js` load apps and launch the built Stephanos runtime, but they are **not** the place for Mission Console/provider/theme logic.
- **Do not hand-edit dist:** `apps/stephanos/dist/**` is generated output and must be rebuilt from source.

## One-click local launcher

Use the Windows launcher named **Update + Launch Local Stephanos (Ollama)** at `windows/Launch-Stephanos-Local.cmd`.

What it does, in plain English:

- Opens the Stephanos ignition splash first and keeps progress or exact blockers visible there.
- Safely checks the local main worktree and lets the canonical launcher pull, build, verify, and serve the latest GitHub source.
- Opens **Stephanos AI Core** in its own visible PowerShell window on port `8787`.
- Starts the Stephanos runtime host separately on port `4173`, verifies the served commit matches current main, and checks the real OpenClaw gateway on `18789`.
- Opens Stephanos in the browser only after AI Core, OpenClaw, and exact-head runtime proof pass.
- Replaces only allowlisted Stephanos listeners when a restart is required; unknown port owners are refused rather than terminated.
- Targets local Ollama at `http://localhost:11434` by default, with Mock Mode available inside Stephanos if Ollama is offline.

Mental model:

- **GitHub is the source of the latest code.**
- **The ignition splash is the primary startup surface.**
- **Stephanos AI Core is a visible, separate runtime window.**
- **The launcher runs your local Stephanos build, not the GitHub-hosted web copy.**
- **Your local Stephanos build talks to your local Ollama on `localhost`.**
- **The GitHub-hosted version is not the one that uses your local Ollama.**

Launch it from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\Launch-Stephanos-Ignition.ps1
```

Or by double-clicking the Windows launcher:

```text
windows\Launch-Stephanos-Local.cmd
```

## Stephanos developer scripts

- `npm run stephanos:dev` — run the Stephanos server plus the live Vite UI from `stephanos-ui` (component iteration mode).
- `npm run stephanos:clean` — remove generated `apps/stephanos/dist/**` assets before a rebuild.
- `npm run stephanos:build` — rebuild `stephanos-ui` into `apps/stephanos/dist/**` and stamp it with runtime metadata.
- `npm run stephanos:verify` — validate that dist exists, asset references resolve, and build metadata/fingerprint still match the current source.
- `npm run stephanos:serve` — rebuild, verify, and serve the repository so the generated runtime can be checked in a browser.
- `npm run stephanos:ignite` — run the Battle Bridge ignition supervisor proof flow.
- `npm run stephanos:ignite:auto-publish` — local ignition flow with `STEPHANOS_IGNITION_AUTOPUBLISH_DIST=1` enabled via a Node wrapper for cross-platform use.
- `npm run stephanos:ignite:housekeep` — standalone housekeeper clean pass (uses `scripts/ignite-stephanos-local.mjs --mode=housekeep`).
- `npm run stephanos:ignite:housekeep:dry-run` — standalone housekeeper preview with no cleanup mutations (`--mode=housekeep-dry-run`).

Housekeeper is intentionally standalone and is **not** auto-wired into the splash-driven Windows launcher after the current build has been created; the exact-head proof must never restore an older generated dist over the build being proved.

## Required workflow after editing Stephanos UI source

1. Edit files in `stephanos-ui/src/**`.
2. Run `npm run stephanos:build`.
3. Run `npm run stephanos:verify`.
4. Commit the source changes and regenerated `apps/stephanos/dist/**` together.

For the fuller source-of-truth notes and guardrails, see `docs/stephanos-ui-build.md`.
