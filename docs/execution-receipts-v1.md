# Execution Receipts V1

Issue: #1568 — Canonical execution receipts for all implementation workers

## Purpose

Execution state is never inferred from silence, GitHub activity, or an acknowledgement reaction. A worker is queued, accepted, running, stalled, terminal, or unknown only when a valid exact-task receipt proves that state.

## Canonical state flow

```text
queued -> accepted -> started -> progress -> completed
                              \-> stalled -> progress|failed|cancelled
                              \-> failed|cancelled
```

Terminal states cannot transition again. Conflicting terminal receipts fail closed.

## Required identity binding

Every receipt binds to:

- repository;
- issue/goal;
- PR when present;
- canonical branch;
- exact source head;
- worker identity and worker type;
- execution identity;
- single-active-lane lease key;
- monotonic sequence and predecessor receipt;
- timestamp and heartbeat expiry;
- proof references;
- blocker and operator-action state;
- expected next transition.

## Shared Workspace paths

```text
receipts/execution-receipts.jsonl
receipts/<leaseKey>.json
```

The JSONL file is the durable history. The lease-key JSON file is the compact current projection. Both use the existing Shared Agent Workspace record store and its path, secret, proof-reference, and atomic-write guardrails.

## First producer

`codex-dispatch-queue` is the first source adapter. The same contract is available to Remote Codex, Battle Bridge Codex, OpenClaw, GitHub-first workers, monitors, and the orchestration engine.

## Fail-closed behaviour

- No receipt projects `UNKNOWN`.
- Invalid receipts project `UNKNOWN` with an exact refusal reason.
- Expired non-terminal heartbeat projects `STALE`.
- Duplicate active execution IDs for one lease project `DUPLICATE_ACTIVE_EXECUTION_LEASE`.
- Cross-repository, issue, branch, execution, or expected-head mismatches are rejected.
- Out-of-order sequences and predecessor mismatches are rejected.
- Missing proof references are rejected.

## Focused proof

```bash
node --test shared/agents/executionReceiptV1.test.mjs
```

The first slice is source-only. Live worker adapters must emit these receipts before any cockpit, chat, monitor, or controller may claim a worker is running or complete.
