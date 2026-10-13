# Seed Canopy Parallel Forge V1: an isolated source proposal route

Owner: #3096. Independence requested by the operator on 13 October 2026.

## Purpose

This is a small **second authoring route** for canonical Seed Canopy outcomes when the normal goal admission -> Mission Worker -> lease chain is stalled. The selection and model-backed isolated file authoring **do not invoke** that chain. It reads the same source-backed canonical high-level seed roster but does not invent live Seed Canopy pressure, change canonical goal state or count itself as a completed goal.

The first executable qualification is deliberately **documentation-only**. Source logic candidates must use a separately qualified execution sandbox before they can be built or tested by a local model; an isolated Git worktree is not an OS security sandbox.

It is NOT a second protected merge service, a second daemon, a bypass for active owner custody, or a replacement for runtime observation. A separate source authoring worktree can coexist safely only for **resource-disjoint, explicitly scoped** tasks. If source ownership overlaps, do not execute: use the existing owner and review the conflict first.

## Running on an authorized Battle Bridge checkout

Prerequisites: Node.js 20.11+, Git, an authenticated checkout with local main up to date, and an operator-controlled local Ollama endpoint on 127.0.0.1:11434 with the selected model already installed. No Remote Commander, Codex, cloud model or new paid provider is used. Default model is qwen3-coder:30b; change it only through the STEPHANOS_SEED_LOCAL_MODEL environment variable. The worker now requires an exact match in Ollama's already-loaded /api/ps list, plus a readable canonical vr-resource-governor-current.json whose localModelAllowed flag is true and active is false. It rechecks immediately before inference. Missing or gaming-protected evidence blocks execution before claiming source. No extra large model may be loaded implicitly.

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

A direct `build <request.json> --execute` invocation is a guarded internal worker entrypoint; without a verified exact approval it fails closed.

The task runs **once**, in its own branch and worktree under the operator's .stephanos/seed-parallel directory, and records stage receipts under receipts/<taskId>.json.

- SELECTED: manifest validated, no build proof.
- CLAIMED: new isolated worktree and exact-base branch created.
- EDITED: local model returned a bounded, exact-target source proposal.
- TESTED: requested Node tests passed and no out-of-scope file was changed.
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

The test at tests/seed-canopy-parallel-forge-integration.test.mjs constructs a disposable Git repository with a canonical seed fixture and a **mock loopback Ollama server**, then proves real worktree creation, one file edit, actual tests, a local commit, durable receipts, main unchanged and refusal of duplicate retries. This is a genuine Git execution proof using simulated model output, not live inference, deployment or autonomous completion.

Task success and Canopy growth remain distinct: a committed candidate is not a reviewed PR, an installed skill or a fully realised seed.

## Sovereign Commander fast mailbox observation

A remote ChatGPT/iPad session does not need Remote Desktop Commander meter to **observe** Battle Bridge. Use the already-installed Sovereign relay fast carrier, which consumes the same protected GitHub issue #2808 commands through `scripts/battle-bridge-sovereign-relay-daemon.mjs`. It is not a second unrestricted endpoint or a new execution authority. The fast relay normally polls HOT at 2.5 seconds, WARM at 5 seconds and IDLE at 15 seconds; its scheduled GitHub mailbox fallback retains the same request identity and guards.

Already-admitted remote actions `visibility-snapshot` and `battle-bridge-observe` can establish machine/service/model-readiness truth. On 13 October 2026 a read-only `visibility-snapshot` request was accepted at 14:49:58.793Z and completed at 14:50:04.101Z with verdict `SOVEREIGN_COMMANDER_REMOTE_VISIBILITY_SNAPSHOT_COMPLETE`. Its in-flight relay status was `FAST_CHECKING` with two carrier failures, so that receipt alone cannot attribute the delivery to the fast carrier rather than fallback. It proved Ollama and Sovereign Commander reachable, not successful execution of Parallel Forge. The Core daemon separately remained degraded.

**Do not** route source manifests or arbitrary shell through this public mailbox. After review/merge and live local qualification, add a separately reviewed *fixed read-only* `parallel-forge-status` action to Sovereign Commander, returning only sanitised exact-identity task and source proof counters. Installing/running the builder still requires its own exact task approval and private runtime transport, with no new remote arbitrary-command power.
