# Rescue Builder Island V1: separation and first safe preflight

Owner: #3103 — Rescue Island: two independent proof-gated builders outside Goal Conveyor

## Current execution admission

The first-commit export is held with
`RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED` before claims or execution.
A disposable source-swap reproduction demonstrated that final tree checks
cannot contain code executed after a same-principal writer changes a verified
test. See [execution custody requirements](rescue-island-execution-custody.md)
for the full estate and original-writer exclusion needed before activation.
Construction tests are uncommissioned fixtures; they do not authorize pickup.

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

### Canonical ownership contract after structural review

Each claim in all three inventories must include `ownerIssueNumber`; changing
task IDs or selecting a different file never permits duplicate goal ownership.
The independently observed `scopeResolutions` maps every candidate and claimed
scope to a repository-contained canonical relative path, including symlink and
junction aliases. Missing, ambiguous or escaping resolutions are held. Compare
canonical equality and ancestor/descendant scopes, and reject generated dist
ancestors as candidate scopes as well as dist itself and any node_modules segment.
The isolated runner observation binds `worktreeHead` to the exact base and
`worktreeBranch` to the candidate branch. Every claim also carries a branch and
`worktreeIdentity` (digest of the independently resolved physical worktree path,
case-folded on Windows). Reject either identity collision even for different
tasks, issues and disjoint source paths. The future verifier must bind the
candidate identity to its actual/prospective physical directory, not accept a
caller-selected digest. A clean checkout alone is insufficient.
These are structural requirements for the future authenticated adapter; the
classifier itself does not perform a filesystem scan or authenticate its input.

### Typed identity design review and convergence invariant

Repeated fixes to claim digests exposed one shared defect class: regular
expressions coerce their operands, while equality and collision checks assume
primitive strings. Candidate and observation fields had the same defect as
the previously repaired claim inventory. Fixing each offending value separately
would leave the contract inconsistent.

All regex-validated task IDs and hashes now cross one primitive-string predicate
before format validation, comparison, canonicalization or receipt emission.
Matching object references are never identity proof; malformed task IDs are
omitted from result receipts. Path and branch checks already require strings.
The adversarial matrix exercises every candidate/observation ID or hash format
boundary with missing values, primitives of the wrong type, arrays, boxed strings,
throwing coercion methods and symbols, including matching forged references.
The invariant is HELD without coercion, exceptions or execution authority.

This is source validation only. It adds no authenticated approval or ownership
adapter and cannot qualify production pickup. The complete preflight still needs
independent exact-head review; these tests do not constitute that review.

## Next independently reviewed slice, before any actual source mutation

1. Qualify an existing source-builder library for reuse without importing its canonical queue/lease consumer. Audit it for implicit controller calls, source dirt handling and process model custody.
2. Build the Island-owned authenticated narrow inbox and fixed run-once adapter on an isolated clean worktree. Obtain an external, independently read ownership inventory for exact task/path and signed original-owner approval. It must remain impossible for task JSON to authorize itself.
3. At a known current main head, select a small real goal not already owned anywhere, prove source-independent claim and physical process start, write only the allowlisted path, run focused Node tests, and verify the resulting tree/parent/scope after commit hooks.
4. Publish typed SELECTED, CLAIMED, PHYSICAL_PICKUP, EDITED, TESTED and ISOLATED_COMMITTED receipts, then use existing independent PR review and protected merge. Only an externally validated receipt proves progress.
5. After the first qualifying run, create rescue-island-02 as a separate physical executor with its own queue, worktree, claim and CPU budget. Verify concurrent resource-disjoint builds, interruption/restart recovery, gaming transition and source collision exclusion.
6. Only then qualify bounded unattended Island refill. Dashboard consumes Island receipts as *observer*, not owner, and must not aggregate its counts into canonical 0/15.

No authority is inferred from a new issue, branch, unit test, checked status, a free canonical lane slot, or a read-only preflight. All eight pre-existing dirty Battle Bridge entries remain untouched.


## #3109 physical path observer slice (read-only)

`shared/agents/rescueIslandPhysicalScopeObservationV1.mjs` supplies an actual
filesystem readback for a bounded candidate/claim path set. It requires a physical
canonical checkout with a real .git directory, a path allowlist, and no existing
symlink/junction/redirected ancestor, escaping physical path, case-colliding
path, or regular-file ancestor. A missing target records only the last existing
ancestor: the final source write must recheck and bind a no-follow handle.

The observer returns `LOCAL_READ_ONLY_UNAUTHENTICATED`, **never**
`INDEPENDENT_READ_ONLY`: it does not prove who gathered the paths, whether
all three claimant inventories were complete, a stable write handle, the
original r7 writer exclusion, fresh gaming capacity, operator approval or
machine-signed authority. No registration as a worker, daemon or remote action.
A future trusted Island host must gather the complete canonical/Seed/Island
claims itself, supply their exact paths, run the observer under an independently
reviewed OS identity, and recheck after approval immediately before a held
one-shot builder; no caller may simply relabel its output as authenticated.

Focused test:
`node --test shared/agents/rescueIslandPhysicalScopeObservationV1.test.mjs`.
Tests cover existing and missing files, path coercion/traversal, physical
symlink aliases including internal aliases, redirects appearing after a prior
safe scan, non-directory ancestors and missing .git. This source slice does
not satisfy the separate #3109 first physical pickup acceptance criteria.


## #3109 fixed Sovereign Commander physical-boundary probe

The optional source-owned `rescue-island-readonly-boundary` action runs only
`scripts/rescue-island-boundary-probe.mjs` at the canonical installed source
head. It takes no arguments or task-controlled paths, performs no Git writes,
tests, owner approvals, process launches or filesystem mutations, and returns
a bounded, non-secret OS source-scope check. The transport must still verify
its exact current-main and authenticated MCP source identity.

A successful readback confirms only that three hard-coded Island source paths
had canonical, unredirected ancestors at the instant scanned. It is **not**
the physical SELECT/CLAIM/PICKUP/EDIT/TEST/COMMIT proof, nor signed custody
of the Windows source writers or CPU/gaming budget. All resulting execution,
merge, canonical-lease release and Seed Forge access flags remain false. The
runtime is not commissioned merely because the PR merges or the action
returns DONE. A separate Windows-specialist-reviewed Island-owned host must
prove all three claim inventories and secure the target write before
the existing bounded first-commit engine is exposed.
