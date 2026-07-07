# Codex Dispatch Queue V1 Runbook

## Purpose

The Codex Dispatch Queue V1 is the source-controlled contract for GitHub issue #1292. It models queue records, proof requirements, manual Codex handoff packets, dashboard projection data, and Shared Agent Workspace publication without launching Codex automatically.

## Safety boundaries

- Queue records are written only to the Shared Agent Workspace, outside the repository source tree.
- The queue does not launch Codex, claim a dispatch, run arbitrary shell, merge, push, or mutate unscoped paths.
- Operator approval and exact-head approval remain separate from queue presence.
- Missing direct automated dispatch for #1293 is represented as `BLOCKED_BY_MISSING_CODEX_AUTOMATED_DISPATCH_INTEGRATION_1293`.
- Proof must be supplied through bounded proof references and Verification Harness checks.

## Queue flow

1. Create a queue record with `createCodexQueueRecord`.
2. Validate it with `validateCodexQueueRecord` or the Verification Harness `CodexQueueRecordVerifier`.
3. Write it outside the repo with `writeCodexQueueRecordToSharedWorkspace`.
4. Publish current status with `publishCodexQueueStatusToSharedWorkspace`.
5. Move through allowed states with `transitionCodexQueueRecord`.
6. Build a manual packet with `buildManualCodexHandoffPacket` only after `READY_FOR_MANUAL_DISPATCH` and an operator approval receipt.
7. Project dashboard data with `projectCodexQueueDashboard`.

## Required proof

Run the focused queue proof first:

```sh
node --test shared/agents/codexDispatchQueue.test.mjs shared/agents/verificationHarness.test.mjs shared/agents/verificationHarnessWorkspace.test.mjs
```

Run the full shared agent suite before PR handoff:

```sh
node --test shared/agents/*.test.mjs
```

## Shared Workspace paths

- Queue records: `codex-dispatch/queue/<jobId>.json`
- Queue status: `status/codex-dispatch-queue.json`
- Queue events: `events/codex-dispatch-queue.jsonl`

These paths must resolve outside the repo root through `resolveSharedWorkspacePath`.
