# Forge M5 Shadow Acceptance V1

Status: source-only, runtime-unproven

## Purpose

Advance #1671 from source-ready Forge M2/M3 machinery into a deterministic M5 shadow-acceptance evaluator without adding a scheduler, writer, worker, publisher, merge path or runtime executor.

M5 does not make Forge live. It consumes already-proven dual-path evidence and answers whether the sidecar has completed the required shadow-acceptance experiment safely enough to proceed toward M6 parallel-construction default.

## Acceptance contract

A passing evaluation requires exactly two distinct real goals, each executed through both canonical GitHub construction and `FOUNDRY_FORGE` using the same repository and exact canonical base head/tree.

For each goal, the evaluator requires:

- one canonical GitHub execution receipt and one canonical Forge execution receipt;
- distinct execution and lane identities;
- identical intended source tree SHA;
- identical bounded changed-file estate;
- equivalent focused test suite identity and successful outcome;
- identical artifact digest set;
- no duplicate PR, branch, mission or lane creation;
- no lost commits or overwritten refs;
- final protected GitHub integration identity bound to the accepted tree.

The evaluator also reuses the existing Forge sidecar capacity adjudicator and therefore cannot pass unless genuine fresh M2 and M3 runtime receipts prove mirror parity, isolated runner capacity, teardown and zero residual authority.

## Verdicts

The bounded verdict family is:

- `FORGE_M5_ACCEPTANCE_PASSED`
- `FORGE_M5_ACCEPTANCE_REQUIRED`
- `FORGE_M5_ACCEPTANCE_FAILED`
- `FORGE_M5_CAPACITY_NOT_PROVEN`
- `FORGE_M5_EVIDENCE_INVALID`

Synthetic fixtures, caller-authored readiness booleans, one-sided execution, stale receipts, tree drift, artifact drift, test drift, duplicate identities, changed-file drift, unprotected integration or missing GitHub authority all fail closed.

## Authority boundary

This evaluator is evidence-only. Every result keeps source mutation, branch mutation, publication, dispatch, merge, deployment, runtime mutation, Forge/Podman execution, credential access and arbitrary command authority false.

It does not install or start Forgejo, Podman, runners or services. It does not create or update a PR, merge a branch, publish capacity or route a real task. Those remain owned by the existing canonical machinery and operator gates.
