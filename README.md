# stephan-os

Core architecture and development of Stephanos OS.

## Stephanos live UI pipeline

- **Live editable Mission Console source:** `stephanos-ui/src/**`
- **Served/generated runtime:** `apps/stephanos/dist/**`
- **Launcher shell only:** the root `index.html` and `main.js` load apps and launch the built Stephanos runtime, but they are **not** the place for Mission Console/provider/theme logic.
- **Do not hand-edit dist:** `apps/stephanos/dist/**` is generated output and must be rebuilt from source.

## One-click local launcher

Use the Windows launcher named **Update + Launch Local Stephanos (Ollama)** at `windows/Launch-Stephanos-Local.cmd`.

The default `launcher-root` + `cockpit` ignition keeps the complete established startup system and opens three browser surfaces:

1. **Stephanos Ignition Status**: the professional splash, progress, approval, repair, blocker, log, and proof surface.
2. **Stephanos OS landing page**: the root launcher and tile workspace at `http://127.0.0.1:4173/`.
3. **Stephanos AI Core**: the built Mission Console/runtime browser surface at `http://127.0.0.1:4173/apps/stephanos/dist/index.html`.

What the full launcher does:

- resolves the intended repository or proof worktree;
- classifies source dirt, generated runtime dirt, and approval-required blockers;
- checks dependencies and guarded source update state;
- runs the Battle Bridge ignition supervisor;
- starts or reuses backend `8787`, OpenClaw gateway `18789`, and UI `4173`;
- preserves approval-gated generated-dist, source-divergence, and OpenClaw recovery;
- writes bounded logs, transcripts, support snapshots, and exact blocker details;
- requires exact-head served-runtime proof before unlocking and opening the cockpit browser surfaces;
- supports launcher-root, Vite development, readiness-report, and guarded UI-repair modes;
- targets local Ollama at `http://localhost:11434`, with Mock Mode available inside Stephanos when Ollama is offline.

The AI Core is a browser application, not a dedicated PowerShell console. PowerShell processes may host or supervise services in the background, but the operator-facing AI Core surface is the browser page whose HTML title is `Stephanos AI Core`.

Launch it from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\windows\Launch-Stephanos-Local.ps1 -Mode launcher-root -BootMode cockpit
```

Or by double-clicking:

```text
windows\Launch-Stephanos-Local.cmd
```

## Stephanos developer scripts

- `npm run stephanos:dev` — run the Stephanos server plus the live Vite UI from `stephanos-ui`.
- `npm run stephanos:clean` — remove generated `apps/stephanos/dist/**` assets before a rebuild.
- `npm run stephanos:build` — rebuild `stephanos-ui` into `apps/stephanos/dist/**` and stamp it with runtime metadata.
- `npm run stephanos:verify` — validate dist, referenced assets, metadata, fingerprint, and source alignment.
- `npm run stephanos:serve` — rebuild, verify, and serve the repository for browser proof.
- `npm run stephanos:ignite` — run the Battle Bridge ignition supervisor proof flow.
- `npm run stephanos:ignite:auto-publish` — ignition with generated-dist auto-publication enabled through the guarded wrapper.
- `npm run stephanos:ignite:housekeep` — standalone guarded housekeeping.
- `npm run stephanos:ignite:housekeep:dry-run` — preview housekeeping without cleanup mutations.

## Required workflow after editing Stephanos UI source

1. Edit files in `stephanos-ui/src/**`.
2. Run `npm run stephanos:build`.
3. Run `npm run stephanos:verify`.
4. Commit the source changes and regenerated `apps/stephanos/dist/**` together.

For fuller source-of-truth notes and guardrails, see `docs/stephanos-ui-build.md`.
