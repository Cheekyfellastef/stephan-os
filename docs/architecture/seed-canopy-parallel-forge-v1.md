# Seed Canopy Parallel Forge V1: an isolated source proposal route

Owner: #3096. Independence requested by the operator on 13 October 2026.

## Purpose

This is a small **second authoring route** for canonical Seed Canopy outcomes when the normal goal admission -> Mission Worker -> lease chain is stalled. The selection and model-backed isolated file authoring **do not invoke** that chain. It reads the same source-backed canonical high-level seed roster but does not invent live Seed Canopy pressure, change canonical goal state or count itself as a completed goal.

The first executable qualification is deliberately **documentation-only**. Source logic candidates must use a separately qualified execution sandbox before they can be built or tested by a local model; an isolated Git worktree is not an OS security sandbox.

It is NOT a second protected merge service, a second daemon, a bypass for active owner custody, or a replacement for runtime observation. A separate source authoring worktree can coexist safely only for **resource-disjoint, explicitly scoped** tasks. If source ownership overlaps, do not execute: use the existing owner and review the conflict first.

## Running on an authorized Battle Bridge checkout

**Current deployment status: NOT COMMISSIONED.** The heavyweight llama.cpp
model route remains **HELD — RESIDENT_ROUTER_GOVERNOR_CUSTODY_UNIMPLEMENTED**.
A separate opt-in **CANONICAL_INVENTORY_V1** deterministic path now prepares
documentation-only source proposals without contacting llama.cpp or Ollama.
This is source code in PR #3097, not an installed or live Battle Bridge worker.
It retains the same owner-authenticated exact-manifest approval, isolated
Git branch/worktree, canonical governor check, source/path scope, tests,
commit verification and protected review/merge restrictions. It is neither
automatic seed admission nor proof of goal completion.

For an operator-chosen **new documentation file** (expectedTargetSha256: null),
set `"generationMode": "CANONICAL_INVENTORY_V1"` in the exact owner-approved
manifest. The renderer uses only the canonical seed title, owner, source,
declared rung and approved intent to create an evidence-gathering checklist.
It does not invent live measurements, run a model, modify existing files or
admit executable code. Any other generationMode fails closed. This avoids
the independent llama.cpp GPU-residency problem for this narrow class only;
it does NOT qualify the machine's Git/Windows source-writer safety or allow
an unattended service. After protected merge, a separately approved first
run-once with fresh OS custody and local proof is mandatory.

**Existing model-based route:**
The source intentionally disables production model execution before endpoint
access, governor reconciliation, task claim or worktree creation. The canonical
Windows governor owns Ollama eviction, not the independent llama.cpp router.
HTTP cancellation, `autoload=false`, loaded-model argv and fresh idle snapshots
cannot prove zero GPU/VRAM residency on a gaming transition. No caller JSON,
operator approval file or environment variable overrides this architectural hold.

The following route describes the retained experimental interface only. Before
enabling it, #3096 must supply a separately reviewed canonical router PID/model
residency lease with verified zero-residency acknowledgement on interruption, or
a qualified bounded CPU-only owned child and verified process-tree cessation.
The real host must prove game-transition release and unchanged gaming performance.
The integration test explicitly modifies copies in an ephemeral fixture to mock
custody and GitHub approval; its source edit/tests/commit receipts are sandbox
proof only. This PR does not install, start, evict or terminate any real model.

Prerequisites: Node.js 20.11+, Git, an authenticated checkout with local main up to date, the canonical Windows Gaming Resource Governor, and a **separately qualified, already running llama.cpp router** bound to 127.0.0.1:8080 (or the explicitly configured `STEPHANOS_SEED_LOCAL_PORT`). The router must have the selected `qwen3-coder:30b` model **already loaded**. Unlike Ollama's `/api/generate`, llama.cpp supports `/v1/completions?autoload=false`: a request for a subsequently evicted model must **fail rather than load it**. `GET /models` must attest the exact model as `status.value: "loaded"`. The launcher/operational qualification of this model server is **not** supplied or proven by this PR; do not treat Ollama on port 11434 as a replacement. The default model can be changed through `STEPHANOS_SEED_LOCAL_MODEL` only for an approved manifest. The worker performs a live Windows Reconcile before and immediately prior to inference, checks governor state every 500ms during inference, and performs a separate live Windows Reconcile every 15 seconds so a healthy idle governor need not continuously rewrite its snapshot. Any gaming/VR protection, stale/unknown state or failed live reconcile aborts inference. A configured router must additionally disable sleeping model workers (no `--sleep-idle-seconds`), since waking a sleeping child can load model memory even when the router request has `autoload=false`. This host runtime setting, actual cancellation time and gaming-transition VRAM release all require a separate Battle Bridge acceptance trial. Cancellation is best-effort for an already executing process; governor remains the eviction owner. No remote paid inference provider is introduced. Without the qualified local router, execution fails closed and no source change is claimed.

Read source-backed seed candidates:

    node scripts/seed-canopy-parallel-builder.mjs list

Draft a seed's first goal without falsely claiming that a runtime gap was observed:

    node scripts/seed-canopy-parallel-builder.mjs plan stephanos-full-sovereignty-every-function

### First bounded source build

Prepare a JSON request file *outside the repository*, replacing BASE_SHA with the exact output of git rev-parse refs/heads/main. The source scope, canonical existing owner and test selection must be reviewed first. This example creates **one new architecture document**, not an arbitrary patch to shared runtime code.

{
  "schemaVersion": "stephanos.seed-parallel-build-request.v1",
  "seedId": "stephanos-full-sovereignty-every-function",
  "ownerIssue": "#3026",
  "contractSource": "shared/runtime/fullSovereigntySeedV1.mjs",
  "taskId": "sovereignty-external-edge-inventory",
  "intent": "Draft a source-backed acceptance checklist for the first external dependency inventory rung, clearly separating proven local capabilities from unknown external dependencies.",
  "targetPath": "docs/architecture/sovereignty-external-edge-acceptance.md",
  "expectedTargetSha256": null,
  "baseSha": "BASE_SHA",
  "testPaths": ["shared/runtime/fullSovereigntySeedV1.test.mjs"],
  "reviewAuthority": "PROTECTED_REVIEW_REQUIRED",
  "sourceScopeApproval": "EXACT_TARGET_ONLY",
  "mergeAllowed": false,
  "deployAllowed": false
}

After independently checking that no existing PR owns the exact target path and that the issue/intent are still valid, **do not execute the builder directly as the first step**. Copy the exact request into the supervisor's local inbox, run `supervisor approve <task-id>` in a genuine interactive operator terminal, and then run `supervisor run-once`, as documented below.

    node scripts/seed-canopy-parallel-supervisor.mjs inbox
    node scripts/seed-canopy-parallel-supervisor.mjs approve <task-id>
    node scripts/seed-canopy-parallel-supervisor.mjs run-once

After independently qualified merge and the first operator-approved physical pilot,
the same supervisor also supports a **bounded foreground fail-forward inventory
batch** (at most two tasks per invocation):

    node scripts/seed-canopy-parallel-supervisor.mjs run-inventory-batch

Only **individually GitHub-owner-approved** `CANONICAL_INVENTORY_V1` new
documentation targets enter this batch. Each selected task is revalidated
and started through the existing fixed worker, with fresh source, gaming and
Git custody checks. A blocked task retains its claim/receipt; the next
independently approved, disjoint task may still run. The batch reports
**individual child exit codes**, not unverified successful builds. Neither
process exit zero nor batch completion means review, merge, deployment or
live seed completion. Any blocked attempt makes the overall batch return
nonzero while preserving independent receipts. This command is NOT an
unattended controller, a background service, or permission to override the
original R7 lease. No heavy-model task is admitted by this route.



A direct `build <request.json> --execute` invocation is a guarded internal worker entrypoint; without a verified exact approval it fails closed.

The task runs **once**, in its own branch and worktree under the operator's .stephanos/seed-parallel directory, and records stage receipts under receipts/<taskId>.json.

- SELECTED: manifest validated, no build proof.
- CLAIMED: new isolated worktree and exact-base branch created.
- EDITED: local model returned a bounded, exact-target source proposal.
- TESTED: requested Node tests passed and no out-of-scope file was changed. Before every CPU-intensive local Node test, the worker requires a current, NORMAL, gaming-inactive governor snapshot and watches that state every 500 ms while the test is running; if the state becomes active, stale or unavailable it terminates that approved test child and marks the task BLOCKED. A descendant spawned by a test is not independently guaranteed terminated by Node's `child.kill()`, so a live Windows process-tree acceptance test is still required before fleet-wide gaming protection can be called complete.
- COMMITTED: new local-branch source commit exists, with exact SHA.
- BLOCKED: any check, model, test, claim or source boundary failed. A failed task does not seize a global conveyor lease or stop other unrelated seed tasks.

The runner does **not** push, open a PR, merge, deploy, mutate main, touch the runtime, loosen security, take credentials or release a stuck old lease. Publication and exact-head independent review must follow the canonical protected procedure.

## Non-claims and next qualification

This PR proves source implementation and (when green) source tests. It does NOT prove live Battle Bridge task execution, unattended scheduling, successful local model output, correct current agent skills or unprompted goal completion. The build runner needs a real local on-machine trial with a fresh receiver-side receipt, followed by actual PR publication and independent review. Only then should we consider a supervised periodic run and a Canopy status card, still fail-closed if owner/source evidence is ambiguous.

When many seed tasks exist, never run multiple tasks against the same target file. Use distinct task IDs and per-goal worktrees. Retry by a fresh task ID **only after** inspecting any previous worktree and preserved receipt; never silently discard an unfinished source artifact.

The operator should see this route as **Parallel Forge / Source proposal**, with claim, local model, test, source publication, review, and merge shown separately. Do not display all-green until all required independent receipts exist.


## Independent supervisor: no old controller or conveyor dependency

The standalone supervisor is an executable entrypoint. It reads a small operator-owned inbox instead of enrolling another logical goal controller:

    node scripts/seed-canopy-parallel-supervisor.mjs inbox
    node scripts/seed-canopy-parallel-supervisor.mjs status

The first command prints the absolute local stateRoot. Create its inbox folder and place a narrowly scoped JSON manifest at:

    <stateRoot>/inbox/<task-id>.json

The file must have the exact request schema shown above and a filename matching its taskId. Do not put passwords, bearer tokens or general shell instructions in manifests.

**Request externally authenticated approval first.** The local `approvals/<taskId>.json` file is only a pointer and can never authorise execution itself. Using the owner's authenticated GitHub account, create a comment on [canonical goal #3096](https://github.com/Cheekyfellastef/stephan-os/issues/3096) with the exact fenced `stephanos-seed-parallel-owner-approval` JSON created by `makeParallelSeedExactApprovalV1`: taskId, seedId, ownerIssue, targetPath, baseSha, manifestSha256, issuedAtUtc, expiresAtUtc (no more than 24 hours), and the fixed source-proposal-only scope. The comment must be truly authored by `Cheekyfellastef` with GitHub OWNER association, belong to issue #3096, and remain fresh. This is an authenticated bootstrap route through GitHub, not yet fully meter-independent offline authority.

**Bind the owner comment in a genuine local terminal** after examining the exact task, owner issue title (or explicit unavailable status), source ownership and target-path PR overlap:

    node scripts/seed-canopy-parallel-supervisor.mjs approve <task-id>

The supervisor prints the seed, owner issue (with title truth), target, base, tests and SHA-256 of the manifest; it requires an interactive phrase and then the numeric owner-authored GitHub comment ID. The supervisor independently fetches and validates the GitHub owner/issue/proof before writing a local reference. The actual worker independently re-fetches that same owner comment immediately before source mutation. Forged or stale local files fail closed; GitHub 403/offline blocks only that task. A valid comment binds **one** exact manifest for no more than 24 hours and grants source-candidate authoring only.

Run at most one eligible task:

    node scripts/seed-canopy-parallel-supervisor.mjs run-once

The supervisor rechecks the current manifest hash immediately before launching the independent builder. Malformed or expired entries are ignored or blocked individually. An interrupted task keeps its own claim, worktree and receipt; the supervisor never auto-releases a claim or destroys an unfinished source candidate. A target-specific claim also prevents two different task IDs from editing the same path. Neither claim touches the existing core goal lease.

These are operator-invoked entrypoints today. No Task Scheduler service, automatic approvals, auto-push, independent review bypass or continuous unattended mutation has been installed or proven. A future scheduled supervisor can invoke run-once only after the local fixture, live Battle Bridge model and reboot-recovery acceptance tests are green. Any source publication must still go through the protected PR/review workflow.

## Isolated end-to-end fixture

The test at tests/seed-canopy-parallel-forge-integration.test.mjs constructs a disposable Git repository with a canonical seed fixture and a **mock loopback llama.cpp router** that accepts only `/v1/completions?autoload=false`, then proves real worktree creation, one file edit, actual tests, a local commit, durable receipts, main unchanged and refusal of duplicate retries. This is genuine Git execution proof using simulated model output, not live inference, deployment or autonomous completion.

Task success and Canopy growth remain distinct: a committed candidate is not a reviewed PR, an installed skill or a fully realised seed. The supervisor exposes `localCommitReadbackMatchedUntrusted` when a physical local Git commit matches the expected receipt, but **does not** call that independent proof: the Git branch and receipt are writable by the same account. `candidateCommitted` and `localSourceCandidateProven` stay false with typed `INDEPENDENT_CANDIDATE_PROVENANCE_NOT_COMMISSIONED` until an independently protected host signs and authenticates the exact candidate. `liveBuildProven` also remains false until separately authenticated unattended build evidence exists. No software-only local receipt, even with valid owner approval, can bypass this custody requirement.

## Sovereign Commander fast mailbox observation

A remote ChatGPT/iPad session does not need Remote Desktop Commander meter to **observe** Battle Bridge. Use the already-installed Sovereign relay fast carrier, which consumes the same protected GitHub issue #2808 commands through `scripts/battle-bridge-sovereign-relay-daemon.mjs`. It is not a second unrestricted endpoint or a new execution authority. The fast relay normally polls HOT at 2.5 seconds, WARM at 5 seconds and IDLE at 15 seconds; its scheduled GitHub mailbox fallback retains the same request identity and guards.

Already-admitted remote actions `visibility-snapshot` and `battle-bridge-observe` can establish machine/service/model-readiness truth. On 13 October 2026 a read-only `visibility-snapshot` request was accepted at 14:49:58.793Z and completed at 14:50:04.101Z with verdict `SOVEREIGN_COMMANDER_REMOTE_VISIBILITY_SNAPSHOT_COMPLETE`. Its in-flight relay status was `FAST_CHECKING` with two carrier failures, so that receipt alone cannot attribute the delivery to the fast carrier rather than fallback. It proved Ollama and Sovereign Commander reachable, not successful execution of Parallel Forge. The Core daemon separately remained degraded.

**Do not** route source manifests or arbitrary shell through this public mailbox. After review/merge and live local qualification, add a separately reviewed *fixed read-only* `parallel-forge-status` action to Sovereign Commander, returning only sanitised exact-identity task and source proof counters. Installing/running the builder still requires its own exact task approval and private runtime transport, with no new remote arbitrary-command power.
