# stephan-os

Core architecture and development of Stephanos OS.

## Stephanos live UI pipeline

- **Live editable Mission Console source:** `stephanos-ui/src/**`
- **Served/generated runtime:** `apps/stephanos/dist/**`
- **Launcher shell only:** the root `index.html` and `main.js` load apps and launch the built Stephanos runtime, but they are **not** the place for Mission Console/provider/theme logic.
- **Do not hand-edit dist:** `apps/stephanos/dist/**` is generated output and must be rebuilt from source.


## Windows one-click launcher

Stephanos now includes a desktop-shortcut-friendly Windows launcher at `windows/Launch-Stephanos-Local.cmd`.

What it does:
- Uses the live Stephanos source at `stephanos-ui/src/**` and rebuilds the runtime into `apps/stephanos/dist/**`.
- Safely updates the current Git branch with `git pull --ff-only` when the repo is clean.
- Installs dependencies only when `package.json` or `package-lock.json` changed.
- Starts `stephanos-server` plus the local static runtime server.
- Opens `http://127.0.0.1:4173/apps/stephanos/dist/` in your browser.
- Keeps Ollama pointed at `http://localhost:11434` by default, with Mock Mode available in the UI when Ollama is offline.

Run it from Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\Launch-Stephanos-Local.ps1
```

Or double-click:

```text
windows\Launch-Stephanos-Local.cmd
```

## Commands

- `npm run stephanos:dev` — run the Stephanos server plus the live Vite UI from `stephanos-ui`.
- `npm run stephanos:clean` — remove generated `apps/stephanos/dist/**` assets before a rebuild.
- `npm run stephanos:build` — rebuild `stephanos-ui` into `apps/stephanos/dist/**` and stamp it with runtime metadata.
- `npm run stephanos:verify` — validate that dist exists, asset references resolve, and build metadata/fingerprint still match the current source.
- `npm run stephanos:serve` — rebuild, verify, and serve the repository so the generated runtime can be checked in a browser.
- `npm run deploy` — run the required predeploy build+verify gate and print the publish target.

## Required workflow after editing Stephanos UI source

1. Edit files in `stephanos-ui/src/**`.
2. Run `npm run stephanos:build`.
3. Run `npm run stephanos:verify`.
4. Commit the source changes and regenerated `apps/stephanos/dist/**` together.

For the fuller source-of-truth notes and guardrails, see `docs/stephanos-ui-build.md`.
