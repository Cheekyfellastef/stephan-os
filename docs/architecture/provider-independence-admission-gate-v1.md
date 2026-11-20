# Provider Independence Admission Gate V1

## Purpose

This source slice implements the deterministic admission policy required by issue #1900 under #1898/#1899. It does not create a scheduler, provider router, reviewer, goal registry or execution plane.

The gate evaluates a structured provider-dependency declaration against already-proven non-Codex parity evidence. It deliberately does not scan prose for the word `Codex`; provider dependence is admitted or rejected from an explicit contract and task-class qualification evidence.

## Core invariant

A Codex or Work agentic provider may remain useful optional capacity, but a new critical-path dependency cannot be admitted when it would make that provider the only viable route.

Accepted bounded modes are:

- `PROVIDER_INDEPENDENT`
- `OPTIONAL_SPECIALIST_WITH_QUALIFIED_FALLBACK`
- `NON_CRITICAL_OBSERVABILITY_ONLY`
- `TEMPORARY_BOUNDED_EXCEPTION_WITH_EXPIRY_AND_OWNER`
- `HARD_EXTERNAL_BOUNDARY_WITH_UNRELATED_WORK_ISOLATION`

`CODEX_ONLY_CRITICAL_PATH` is explicitly represented so deterministic fixtures can prove it is rejected.

## Qualified fallback evidence

A non-Codex fallback counts only when its exact task-class route is active and has one of the accepted qualification states, proof refs, and the same portable-checkpoint and execution-receipt contracts as the dependency being admitted.

Caller declarations do not make a route qualified. If a declared fallback is missing, inactive, wrong-task-class, changed checkpoint contract, changed receipt contract or is being retired, the gate fails closed.

Retiring the last qualified non-Codex route produces `BLOCK_FALLBACK_REMOVED_WITHOUT_REPLACEMENT`.

## Temporary concentration exceptions

A temporary provider concentration exception is accepted only as `TEMPORARY_EXCEPTION_ACTIVE`, never as parity. It must be owned, operator-referenced, have a concrete fallback build goal, keep unrelated work unblocked and expire within 30 days. Expired or malformed exceptions block.

## Hard external boundaries

A genuine hard external boundary may pass only when the exact capability is isolated so unrelated work continues. The result keeps concentration risk visible and does not pretend that provider parity exists.

## Authority boundary

Every result fixes the following to false:

- source mutation
- work dispatch
- provider qualification
- merge
- deployment
- Windows runtime mutation
- OpenClaw mutation
- spending/account action
- lease seizure

This gate is evidence/policy only. #1556/#1694 may consume its verdict later through separately governed integration work.

## First-slice proof

The deterministic fixture suite covers:

- optional Codex specialist with exact qualified GitHub fallback;
- Codex-only exact-head review rejection;
- retirement of the last OpenClaw/Forge-style fallback;
- no raw-string blocking from prose that merely mentions Codex;
- Work-only critical product dependency rejection;
- explicit isolated hard external boundary;
- live and expired temporary exceptions;
- provider swap with checkpoint/receipt continuity;
- changed capability-card contract invalidating fallback proof;
- malformed/accessor evidence rejection;
- zero authority widening on every verdict.

## Follow-on integration boundary

This M1 source contract is not yet a repository-wide CI gate. After exact-head CI and independent provider-neutral review, a later bounded integration should make the existing goal/architecture admission and sensitive provider-change paths consume this pure evaluator without creating another scheduler or review system.
