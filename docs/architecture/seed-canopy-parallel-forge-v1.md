# Seed Canopy Parallel Forge V1: an isolated source proposal route

Owner: #3096. Independence requested by the operator on 13 October 2026.

## Purpose

This is a small **second authoring route** for canonical Seed Canopy outcomes when the normal goal admission -> Mission Worker -> lease chain is stalled. The selection and model-backed isolated file authoring **do not invoke** that chain. It reads the same source-backed canonical high-level seed roster but does not invent live Seed Canopy pressure, change canonical goal state or count itself as a completed goal.

The first executable qualification is deliberately **documentation-only**. Source logic candidates must use a separately qualified execution sandbox before they can be built or tested by a local model; an isolated Git worktree is not an OS security sandbox.

It is NOT a second protected merge service, a second daemon, a bypass for active owner custody, or a replacement for runtime observation. A separate source authoring worktree can coexist safely only for **resource-disjoint, explicitly scoped** tasks. If source ownership overlaps, do not execute: use the existing owner and review the conflict first.

## Running on an authorized Battle Bridge checkout

Prerequisites: Node.js 20.11+, Git, an authenticated checkout with local main up to date, and an operator-controlled local Ollama endpoint on 127.0.0.1:11434 with the selected model already installed. No Remote Commander, Codex, cloud model or new paid provider is used. Default model is qwen:14b; change it only through the STEPHANOS_SEED_LOCAL_MODEL environment variable after checking local availability.

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

After independently checking that no existing PR owns the exact target path and that the issue/intent are still valid:

    node scripts/seed-canopy-parallel-builder.mjs build /absolute/path/to/request.json --execute

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

**Approve the exact bytes in a genuine local terminal** after examining the source ownership and currently open PR estate for target-path overlap:

    node scripts/seed-canopy-parallel-supervisor.mjs approve <task-id>

The supervisor prints the seed, owner, target, base, tests and SHA-256 of the approved manifest, then requires an interactive phrase. Approval binds **one** exact manifest for at most 24 hours and grants source-candidate authoring only.

Run at most one eligible task:

    node scripts/seed-canopy-parallel-supervisor.mjs run-once

The supervisor rechecks the current manifest hash immediately before launching the independent builder. Malformed or expired entries are ignored or blocked individually. An interrupted task keeps its own claim, worktree and receipt; the supervisor never auto-releases a claim or destroys an unfinished source candidate. A target-specific claim also prevents two different task IDs from editing the same path. Neither claim touches the existing core goal lease.

These are operator-invoked entrypoints today. No Task Scheduler service, automatic approvals, auto-push, independent review bypass or continuous unattended mutation has been installed or proven. A future scheduled supervisor can invoke run-once only after the local fixture, live Battle Bridge model and reboot-recovery acceptance tests are green. Any source publication must still go through the protected PR/review workflow.

## Isolated end-to-end fixture

The test at tests/seed-canopy-parallel-forge-integration.test.mjs constructs a disposable Git repository with a canonical seed fixture and a **mock loopback Ollama server**, then proves real worktree creation, one file edit, actual tests, a local commit, durable receipts, main unchanged and refusal of duplicate retries. This is a genuine Git execution proof using simulated model output, not live inference, deployment or autonomous completion.

Task success and Canopy growth remain distinct: a committed candidate is not a reviewed PR, an installed skill or a fully realised seed.
