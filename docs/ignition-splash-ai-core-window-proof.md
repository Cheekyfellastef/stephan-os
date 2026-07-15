# Stephanos ignition splash and AI Core window repair

## Operator contract

One press of `windows/Launch-Stephanos-Local.cmd` must:

1. Open the ignition splash before startup work.
2. Update, build, verify, and serve the latest `main` through the canonical launcher-root lane.
3. Start `Stephanos AI Core` in a separate visible PowerShell window from the updated source.
4. Prove backend `8787`, OpenClaw `18789`, and Stephanos UI `4173` are ready.
5. Prove the served UI commit matches the current short Git HEAD.
6. Open Stephanos only after those proofs pass.

## Safety contract

- Port replacement is limited to command lines matching known Stephanos runtime identities.
- Unknown listeners on `4173` or `8787` are refused.
- The exact-head proof does not run the destructive supervisor housekeeping pass after the new dist has been built.
- The AI Core starts after the source update, so the visible backend window cannot be left on pre-pull code.
- OpenClaw task execution, Git push, merge, and arbitrary shell authority are not added.
- Non-main execution is blocked unless the explicit `-AllowProofBranch` switch is supplied.
- Proof-branch mode builds the selected branch without pulling or merging it.

## Windows proof required before merge

Run from the PR worktree:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\windows\Launch-Stephanos-Ignition.ps1 -RepositoryRoot . -AllowProofBranch
```

Expected visible surfaces:

- `Stephanos Ignition` splash in the browser.
- `Stephanos AI Core` PowerShell window.
- Stephanos browser runtime after green proof.

Expected proof file:

```text
%USERPROFILE%\Documents\Stephanos-openclaw-workspace\ignition\stephanos-ignition-proof.json
```

Required fields:

```text
verdict = ready
sourceBranch = fix/ignition-splash-ai-core-windows
sourceHead = servedCommit
backend8787.ready = true
openClaw18789.ready = true
ui4173.ready = true
ui4173.exactHead = true
```
