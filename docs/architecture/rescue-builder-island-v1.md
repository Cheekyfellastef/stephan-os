# Rescue Builder Island V1: separation and first safe preflight

Owner: #3103 — Rescue Island: two independent proof-gated builders outside Goal Conveyor

## What this is and is not

This is the **third** construction system. It is deliberately different from:

- The original Goal Conveyor (#2961 / #2002), including surge Builders 9–13 (#3006), which use canonical scheduler/Mission Worker/lease admission and are still subject to its held source-writer custody.
- The independent Seed Canopy Parallel Forge (#3096 / PR #3097), whose seed-only requests, worktrees, approval and model executor must not be used as Rescue Island intake or dispatch.

Rescue Island is a separate, narrowly scoped way to produce operator-approved, previously unclaimed **ordinary goal** source proposals. It must never rescue by duplicating a currently claimed task. Source code libraries can be reused, but neither original nor seed runtime state, queue, active lease, controller or worker can be cloned.

## Stage 1 actually implemented in this PR

The pure source module in shared/agents/rescueIslandPreflightV1.mjs is a **read-only structural classifier**. It recognizes only two distinct rescue worker IDs, a dedicated intake namespace, an exact base SHA, issue number/title, source scope, fresh observations, independently inventoried task/path ownership, an isolated worktree and fresh CPU-only gaming-safe runner posture.

It fails closed for:
- missing/unknown canonical, seed, or Island claim inventory, task ID or path overlap, case changes and ancestor/descendant overlaps;
- stale or mismatched source head, missing signed/independently verifiable ownership *later*, or missing actual issue title;
- GPU/inference use until gaming-model custody is physically qualified, active/unknown gaming state or CPU budget uncertainty;
- second worker without first-worker actual material evidence;
- unbounded task class, path traversal/generated dist, elevated shell, protected merge/deploy or existing canonical lease-bypass requests.

**Important:** The caller can forge all input fields to this classifier. A green-looking structural outcome therefore says only STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED. It never authorises a run, claim, source write, merge or deployment. Real authorization requires a *separate* reviewer-approved runtime verifier, authenticated proof origin, signed scope/approval and a single process owner. Do not skip that layer.

This PR adds no active worker, process, service, scheduler, polling loop, mailbox operation, Git mutation or external API call; it does not repair the original lease or commission Seed Forge.

Focused tests: node --test shared/agents/rescueIslandPreflightV1.test.mjs

## Next independently reviewed slice, before any actual source mutation

1. Qualify an existing source-builder library for reuse without importing its canonical queue/lease consumer. Audit it for implicit controller calls, source dirt handling and process model custody.
2. Build the Island-owned authenticated narrow inbox and fixed run-once adapter on an isolated clean worktree. Obtain an external, independently read ownership inventory for exact task/path and signed original-owner approval. It must remain impossible for task JSON to authorize itself.
3. At a known current main head, select a small real goal not already owned anywhere, prove source-independent claim and physical process start, write only the allowlisted path, run focused Node tests, and verify the resulting tree/parent/scope after commit hooks.
4. Publish typed SELECTED, CLAIMED, PHYSICAL_PICKUP, EDITED, TESTED and ISOLATED_COMMITTED receipts, then use existing independent PR review and protected merge. Only an externally validated receipt proves progress.
5. After the first qualifying run, create rescue-island-02 as a separate physical executor with its own queue, worktree, claim and CPU budget. Verify concurrent resource-disjoint builds, interruption/restart recovery, gaming transition and source collision exclusion.
6. Only then qualify bounded unattended Island refill. Dashboard consumes Island receipts as *observer*, not owner, and must not aggregate its counts into canonical 0/15.

No authority is inferred from a new issue, branch, unit test, checked status, a free canonical lane slot, or a read-only preflight. All eight pre-existing dirty Battle Bridge entries remain untouched.
