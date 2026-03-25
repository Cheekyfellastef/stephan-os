# Stephanos Runtime Source of Truth

## Live UI path
- **Launcher shell:** repository root `index.html` + `main.js`.
- **Live Stephanos app manifest:** `apps/stephanos/app.json`.
- **Served Stephanos iframe/document:** `apps/stephanos/dist/index.html`.
- **Authoring source of truth:** `stephanos-ui/src`.
- **Mission Console:** `stephanos-ui/src/components/AIConsole.jsx`.
- **AI router/settings store:** `stephanos-ui/src/state/aiStore.js`.
- **Theme:** `stephanos-ui/src/styles.css`.
- **Build config:** `stephanos-ui/vite.config.js`.

## Boot flow
1. Root `index.html` loads `main.js` and renders the launcher.
2. App discovery reads `apps/index.json` and `apps/stephanos/app.json`.
3. Stephanos resolves to `apps/stephanos/dist/index.html`.
4. Workspace opens that entry in an iframe.
5. `apps/stephanos/dist/index.html` loads the Vite bundle generated from `stephanos-ui/src/main.jsx`.

## Editing guidance
- Change Mission Console, provider router UI, or Stephanos theme **only** in `stephanos-ui/src/**`.
- Never hand-edit `apps/stephanos/dist/**`; it is generated output.
- Root launcher files are real, but they are **not** the Mission Console implementation.


## See also

- `docs/stephanos-routing-truths-and-guardrails.md` for local-vs-remote routing, home-node launchability, and dist fallback guardrails.
- `docs/stephanos-ui-build.md` for source→dist→runtime verification flow.
