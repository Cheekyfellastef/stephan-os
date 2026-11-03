# Stephanos Governed Improvement Proposal V1

Goal: #1903 — Stephanos Governed Self-Improvement and Operator Gap-to-Change Loop V1

## Purpose

This is the first inert construction slice for governed Stephanos self-improvement. It deliberately does **not** create another gap detector, scheduler, improvement backlog, source writer, research engine or approval system.

The input is an already-evidenced gap plus a canonical architecture/ownership snapshot and a bounded diagnosis/proposal. Existing systems remain authoritative:

- #1841 / #1721 and #1607 own ambient question-gap intake, stable gap signatures and existing-goal-first deduplication;
- #1832/#1849 and existing recovery machinery own machine-detectable runtime failure intake and bounded recovery handoff;
- #1902 owns direct/delegated research when root cause is not yet known;
- #1556 owns mission/provider routing;
- existing execution receipts, leases, exact-head review and protected merge machinery own construction and admission.

This adapter's only job is to turn a **known, canonical gap** into a compact improvement proposal or an exact fail-closed next state.

## Required flow

```text
canonical gap evidence
  -> current architecture + owner snapshot
  -> root-cause state
  -> bounded candidate change
  -> THIS PLANNER
  -> proposal ready for existing owner
     | research required through #1902
     | existing writer already owns resource
     | new-goal scope needs operator authorization
     | high-risk authority change needs operator judgment
     | safe hold
```

The planner does not execute any of those next states.

## Existing-owner-first

An existing owner is represented by one goal reference and one or more component references. When present and valid, the proposal stays attached to that owner.

When no owner exists, the planner may recommend one bounded proposal identity but returns:

```text
NEW_GOAL_SCOPE_AUTHORIZATION_REQUIRED
goalCreationAllowed=false
```

This preserves #1903's rule that a discovered gap cannot create its own durable product scope.

## Research-before-change

When `rootCauseState=UNKNOWN`, no proposal is admitted. The planner requires one explicit bounded #1902 research route:

- `DIRECT_BOUNDED_RESEARCH`
- `SPECIALIST_RESEARCH`
- `MULTI_AGENT_RESEARCH_COUNCIL`
- `EXPERIMENT_REQUIRED`

Research remains evidence only and cannot grant implementation authority.

## Authority classes

The source distinguishes these authorities rather than collapsing a broad “improve it” instruction into later consequential permission:

```text
BOUNDED_SOURCE_CHANGE
  -> SOURCE_IMPLEMENTATION_AUTHORIZATION_REQUIRED

KNOWN_REVERSIBLE_REPAIR
  -> BOUNDED_REPAIR_AUTHORIZATION_REQUIRED

NEW_GOAL_SCOPE
  -> NEW_GOAL_SCOPE_AUTHORIZATION_REQUIRED

EXACT_HEAD_MERGE
  -> EXACT_HEAD_MERGE_AUTHORIZATION_REQUIRED

DEPLOYMENT
  -> DEPLOYMENT_AUTHORIZATION_REQUIRED

WINDOWS_RUNTIME_MUTATION
  -> WINDOWS_RUNTIME_MUTATION_AUTHORIZATION_REQUIRED

OPENCLAW_MUTATION
  -> OPENCLAW_MUTATION_AUTHORIZATION_REQUIRED

SPENDING_OR_EXTERNAL_ACCOUNT
  -> SPENDING_OR_EXTERNAL_ACCOUNT_AUTHORIZATION_REQUIRED

AUTHORITY_OR_CONSTITUTION_CHANGE
  -> HIGH_RISK_OPERATOR_JUDGMENT_REQUIRED
```

The planner itself always emits:

```text
implementationAllowed=false
goalCreationAllowed=false
dispatchAllowed=false
mergeAllowed=false
deploymentAllowed=false
runtimeMutationAllowed=false
authorityWideningAllowed=false
```

## Duplicate-writer protection

If a current writer owns any resource scope requested by the proposal, the planner returns:

```text
EXISTING_IMPLEMENTATION_OWNER_ACTIVE
```

It does not seize the resource, dispatch a second worker or invent a new branch.

## Self-authority boundary

Any proposal that declares `attemptsAuthorityWidening=true`, or is itself an authority/constitutional change, is held for explicit high-risk operator judgment.

This slice cannot:

- grant Stephanos mutation authority;
- promote an agent trust tier;
- weaken independent review;
- remove exact-head merge/runtime approval;
- create arbitrary shell/browser/filesystem access;
- alter privacy/financial/legal authority;
- bypass #1900 provider-independence policy;
- redefine Stephanos identity or constitutional law.

## Hostile input boundary

The complete input is recursively snapshotted as data-only before semantic validation. The adapter rejects accessors, functions, symbols, sparse/custom arrays, custom object prototypes, prototype-shaping keys, non-finite values and oversized/deep structures.

Unknown top-level or nested fields fail closed, so a caller cannot smuggle `executeNow`, approval or hidden authority alongside a valid proposal.

## Initial acceptance

Focused tests cover:

- operator-reported gap -> existing owner;
- Stephanos-detected gap -> same canonical path;
- unknown root cause -> #1902 research;
- overlapping writer -> duplicate suppression;
- unowned gap -> new-goal authorization without creation;
- distinct source/merge/runtime/OpenClaw/spending authority;
- explicit rejection of self-authority widening;
- missing evidence;
- unknown-field authority smuggling;
- accessor, sparse-array and custom-array hostile inputs.

This is source-only. It creates no issue, branch, worker, research task, approval, merge, deployment, Windows/OpenClaw mutation, spending action or runtime proof.

## Completion truth

This M1 planner is not #1903 completion. Later slices must connect real canonical gap records, actual authorization receipts, provider-neutral implementation, independent review and end-to-end proof without creating duplicate machinery.
