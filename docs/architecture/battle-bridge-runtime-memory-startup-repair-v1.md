# Battle Bridge Runtime Memory Startup Repair V1

Status: draft source repair for #1810

## Incident basis

Exact current main: `ca519431f3c57add0dfa2e7b80a6e6b26404b111`.

Windows recovery on 2026-08-16 proved four coupled faults in the Battle Bridge ignition/recovery path:

1. backend startup rejected an unstaged runtime write to `stephanos-server/data/memory/durable-memory.json` as source drift;
2. backend listener proof rejected the canonical npm-launched Windows Node form `node  stephanos-server/server.js` even while `/api/health` proved the exact source head;
3. direct supervisor invocation inherited caller cwd for repository housekeeping/source proof;
4. supervisor housekeeping could restore runtime-owned durable memory and revert/clean freshly built exact-head dist before browser/runtime proof, creating its own stale-runtime failure.

The same incident proved backend 8787, OpenClaw 18789 and Shared Workspace could be healthy while these proof-boundary defects kept ignition red.

## Repair invariants

The repair must preserve fail-closed source authority while treating runtime state as runtime state.

- Only an unstaged worktree modification with porcelain status ` M` at the exact path `stephanos-server/data/memory/durable-memory.json` may be tolerated by backend exact-head startup proof.
- Any staged change, rename, deletion, other tracked path or malformed status entry remains source dirt and blocks.
- Runtime memory bytes are never restored, reset, cleaned, stashed or silently replaced by ignition/supervisor housekeeping.
- Backend runtime receipts distinguish `sourceWorktreeClean` from `trackedWorktreeClean` and report whether runtime-memory dirt was tolerated.
- Backend listener identity remains pinned to `C:\Program Files\nodejs\node.exe` and the fixed `stephanos-server/server.js` target. Benign Win32 command-line whitespace and the canonical npm-launched `node`/`node.exe` spelling may normalize, but extra arguments, different scripts, shell indirection and foreign executables remain rejected.
- Exact-head generated dist is preserved between successful build/verify and served-runtime proof.
- Canonical supervisor repository operations must be independent of caller cwd.
- Recovery Mesh must use the same runtime-memory and backend-listener identity rules before this draft is review-ready.

## Current draft estate

This draft currently updates:

- `scripts/windows/start-stephanos-backend.ps1`
- `scripts/run-battle-bridge-ignition.mjs`
- `scripts/run-battle-bridge-ignition.test.mjs`
- this document

Recovery Mesh and raw-supervisor caller-cwd consistency remain required follow-on edits on the same branch before ready-for-review promotion.

## Authority boundary

Source-only. This repair does not merge, deploy, install Podman, execute Forge M2/M3, restart the PC, mutate OpenClaw tasks, perform destructive Git, or replay any expired protected-merge authorization.
