# Codex Capacity Governor Acceptance V1

## Source acceptance

- predictive meter observation model;
- task-consumption receipts;
- P50/P80 task-cost learning;
- configurable capacity reserves;
- zero-cost route selection;
- dispatch suppression when capacity is unsafe;
- natural-reset deferral;
- earliest-expiring banked-reset planning;
- fixed Remote Codex redemption action;
- stack-velocity forecast;
- Goal Dashboard-ready human projection;
- deterministic tests and exact-head GitHub workflow.

## Live acceptance still required

After merge and canonical deployment:

1. Observe the real Codex usage summary through an authenticated supported surface.
2. Publish the four real banked resets with their displayed expiry dates.
3. Record before/after consumption for several representative tasks.
4. Prove zero-cost work is routed away from Codex.
5. Prove a task that would consume reserves is deferred or split.
6. When the policy conditions become true, redeem exactly one earliest-expiring reset.
7. Prove the meter changed and the reset bank decreased by one.
8. Publish the result to the Shared Agent Workspace.
9. Wire the dashboard projection into Landing Page Goal Dashboard V2.
10. Add the capability to the canonical Stephanos capability registry.

## No false completion

Source readiness is not live UI acceptance. Do not mark #1351 complete until real observations, consumption history, Shared Workspace publication, dashboard wiring, capability discovery, and one bounded reset redemption are proven.
