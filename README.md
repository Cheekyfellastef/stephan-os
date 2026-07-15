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

- Opens the existing professional ignition splash and keeps progress, approvals, recovery states, and exact blockers visible there.
- Preserves the full launcher-root cockpit flow, including repository/worktree resolution, source safety checks, approval-gated recovery, Battle Bridge supervisor proof, bounded logs, support snapshots, and browser surface routing.
- Safely checks your local repo and pulls the latest GitHub changes only when the repo is clean.
- Skips the pull with a clear message when local changes are present, so nothing gets overwritten.
- Installs dependencies automatically for the root repo, `stephanos-ui`, and `stephanos-server` when package metadata changed or `node_modules` is missing.
- Starts or reuses the local Stephanos backend on `8787`, the real OpenClaw gateway on `18789`, and the shared launcher shell server on `4173`.
- Opens **Stephanos AI Core** in its own visible PowerShell window without replacing the existing ignition machinery.
- Waits for the launcher shell health/runtime URLs and exact-head proof before opening the configured launcher/runtime cockpit surfaces.
- Runs one localhost launcher/workspace shell so Mission Console and local tiles share runtime context.
- Keeps generated-dist, source-divergence, OpenClaw recovery, and unknown-process safety gates intact.
- Targets local Ollama at `http://localhost:11434` by default, with Mock Mode available inside Stephanos if Ollama is offline.

Mental model:

- **GitHub is the source of the latest code.**
- **The existing ignition launcher remains authoritative.**
- **The AI Core window is an added visible surface, not a replacement launcher.**
- **The launcher runs your local Stephanos build, not the GitHub-hosted web copy.**
- **Your local Stephanos build talks to your local Ollama on `localhost`.**
- **The GitHub-hosted version is not the one that uses your local Ollama.**

Launch it from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\Launch-Stephanos-Ignition.ps1 -Mode launcher-root -BootMode cockpit
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

Housekeeper remains part of the established guarded ignition design. The visible AI Core wrapper does not bypass, duplicate, or remove those source and runtime safety contracts.

## Required workflow after editing Stephanos UI source

1. Edit files in `stephanos-ui/src/**`.
2. Run `npm run stephanos:build`.
3. Run `npm run stephanos:verify`.
4. Commit the source changes and regenerated `apps/stephanos/dist/**` together.

For the fuller source-of-truth notes and guardrails, see `docs/stephanos-ui-build.md`.
