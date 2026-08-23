# Verification Harness V1 (#1287)

Verification Harness V1 is a deterministic, source-controlled verifier layer for binding evidence packets to the Shared Agent Workspace store introduced by #1290.

## Contract

- Results use `verification-harness.v1` and `stephanos.verification.result`.
- Allowed statuses are `PASS`, `FAIL`, `OBSERVED`, and `BLOCKED`.
- `PASS` requires sanitized evidence.
- `FAIL` and `BLOCKED` require a concise reason.
- Evidence lines and proof refs are sanitized to avoid secrets, absolute paths, parent traversal, generated artifacts, or environment dumps.

## Initial deterministic verifiers

- `WorkspaceRecordVerifier` / `SharedWorkspaceVerifier`: validates a Shared Agent Workspace record with the canonical store validator.
- `ProofReferenceVerifier`: verifies safe proof-reference shape without reading arbitrary files.
- `CommandReceiptVerifier`: verifies deterministic command receipt metadata: identity, exit code, output hash, and no arbitrary shell posture.
- `AgentCapabilityVerifier`: validates an agent capability record, preserving OpenClaw's default design-only posture.
- `StaleCapabilityVerifier`: reports stale-but-valid capability records as `OBSERVED` rather than claiming `PASS`.

## Aggregated verification packet

`aggregateVerificationResults()` produces a `stephanos.verification.aggregate` packet with the overall status, evidence summary, blockers, proof refs, and projected Shared Workspace message (`verification-result`).

Aggregation rules:

1. Any invalid result or `FAIL` makes the packet `FAIL`.
2. Any `BLOCKED` result makes the packet `BLOCKED` when no `FAIL` is present.
3. Any `OBSERVED` result makes the packet `OBSERVED` when no `FAIL`/`BLOCKED` is present.
4. All valid `PASS` results make the packet `PASS`.

## Shared Agent Workspace writer

`writeVerificationPacketToSharedWorkspace()` is optional and writes only through #1290 store helpers:

- `proof/<aggregateId>-verification.json`
- `status/<aggregateId>-status.json`
- `events/verification-results.jsonl`

The writer relies on shared workspace path resolution, atomic JSON writes, JSONL appends, record validation, and repo-boundary protection from `sharedAgentWorkspaceStore.mjs`.

## Safety boundaries

- The harness does not run arbitrary shell commands.
- The writer only writes through canonical Shared Agent Workspace store functions.
- Tests use bounded temporary workspace paths outside the repository.
- No dist, build output, `node_modules`, secrets, session dumps, tokens, Battle Bridge proof claims, Codex dispatch claims, merge authority, or exact-head approval claims are produced by this slice.

## Focused tests

```sh
node --test shared/agents/verificationHarness*.test.mjs
node --test shared/agents/*.test.mjs
```
