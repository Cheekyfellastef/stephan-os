# Execution Receipts V1 acceptance checklist

- [x] Canonical versioned receipt schema.
- [x] Required queued, accepted, started, progress, stalled, completed, failed, and cancelled states.
- [x] Repository, issue, PR, branch, exact-head, worker, execution, lease, sequence, predecessor, heartbeat, blocker, proof, and next-action binding.
- [x] Fail-closed validation for malformed or mismatched identity.
- [x] Out-of-order and conflicting-terminal transition rejection.
- [x] Duplicate active lease detection.
- [x] Shared Agent Workspace JSONL history and atomic current projection.
- [x] UNKNOWN projection for missing or invalid receipts.
- [x] STALE projection for expired non-terminal heartbeat.
- [x] Codex Dispatch Queue first-producer adapter.
- [x] Focused deterministic regression suite.
- [ ] Exact-head GitHub CI.
- [ ] Authenticated review with no unresolved P0/P1.
- [ ] Additional live worker adapters.
- [ ] Battle Bridge production acceptance.
- [ ] Operator exact-head merge approval.
