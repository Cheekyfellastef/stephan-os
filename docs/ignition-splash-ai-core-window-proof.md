# Stephanos ignition splash and AI Core window repair

## Preservation contract

This repair is an additive wrapper around `windows/Launch-Stephanos-Local.ps1`. It must not replace or reimplement the established ignition system.

The existing launcher remains authoritative for:

- repository and proof-worktree resolution;
- the professional ignition splash/status browser;
- source cleanliness and generated-runtime classification;
- dependency and runtime prerequisite checks;
- approval-gated generated-dist, source-divergence, and OpenClaw recovery;
- Battle Bridge supervisor orchestration;
- backend `8787`, OpenClaw `18789`, UI `4173`, shared-workspace, and exact-head readiness proof;
- bounded logs, transcripts, support snapshots, and blocker surfacing;
- launcher, runtime, cockpit, Vite development, readiness-report, and guarded UI-repair modes;
- browser surface selection and opening.

The wrapper adds only one missing operator-facing behavior: `Stephanos AI Core` must exist in its own visible PowerShell window.

## Operator contract

One press of `windows/Launch-Stephanos-Local.cmd` must:

1. Start the full existing launcher with `-Mode launcher-root -BootMode cockpit`.
2. Wait until the full launcher splash is active.
3. Reuse an already healthy visible AI Core window, or replace only an allowlisted Stephanos backend process with a visible AI Core window.
4. Let the existing launcher perform all source update, approval, OpenClaw, build, proof, and browser work.
5. If source HEAD changes during ignition, restart the visible AI Core from the updated worktree.
6. Return the original launcher's exit status unchanged.

## Safety contract

- Unknown listeners on `8787` are refused rather than terminated.
- The wrapper does not directly build, serve, open Stephanos, run the Battle Bridge supervisor, or reproduce approval logic.
- Special modes and switches are forwarded to the existing launcher.
- No Git push, merge, OpenClaw task execution, arbitrary shell authority, or readiness bypass is added.
- The existing splash, logs, support snapshots, and exact blockers remain the source of truth.

## Windows proof required before merge

Run from the PR worktree:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows\Launch-Stephanos-Ignition.ps1 -Mode launcher-root -BootMode cockpit -RepositoryRoot . -AllowProofBranch
```

Required visible behavior:

- the established `Stephanos Ignition Status` splash opens and retains its full stages and blocker details;
- `Stephanos AI Core` opens as a separate visible PowerShell window;
- the normal launcher/runtime cockpit browser surfaces still open according to the existing launcher contract;
- approval and blocker flows still originate from the existing launcher and approval helper;
- the wrapper reports that it delegated to the full existing launcher.

The normal launcher proof files remain in:

```text
%USERPROFILE%\Documents\Stephanos-openclaw-workspace\
```

The AI Core window PID record is additive and stored at:

```text
%USERPROFILE%\Documents\Stephanos-openclaw-workspace\status\stephanos-ai-core-window.pid
```
