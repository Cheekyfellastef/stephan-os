# OpenClaw Capability Ladder Runbook

Issues: #1284 and #1286.

## Current safe slice

OpenClaw remains a `design_only` participant. It may publish capability records and proof requests through the Shared Agent Workspace, but it is not a trusted source writer.

## Stage order

1. `repo_scout` — can run now; publish repository observations only.
2. `test_runner` — can run now; request allowlisted deterministic proof commands.
3. `patch_prep` — can run now; prepare patch proposal packets without touching source.
4. `approval_gated_writer` — needs exact operator approval and is bounded to `/courier-open` only.
5. `pr_helper` — blocked until Codex owns committed source changes and proof; no merge authority.

## Dispatch handoff

Use `createOpenClawDispatchQueueRecord` to produce a Codex Dispatch Queue record. Codex remains the writer/reviewer path. The `approval_gated_writer` stage sets `requiresOperatorApprovalBeforeDispatch` and every stage keeps `requiresOperatorApprovalBeforeMerge`.

## Required proof

Run:

```bash
node --test shared/agents/*openclaw*capability*.test.mjs
node --test shared/agents/*.test.mjs
```

## Safety boundaries

- No arbitrary shell.
- No trusted OpenClaw source writes.
- No approval spoofing.
- No merge authority.
- No secret, environment, token, or session dumping.
- No generated `dist`, build output, or `node_modules` changes.
