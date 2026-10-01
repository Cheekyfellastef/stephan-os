# Main-Movement-Tolerant Operator Authorization V1

## Problem

Protected merge authorization currently couples operator judgment and technical execution evidence to one exact `main` SHA. On a fast-moving repository an unrelated protected merge can therefore invalidate Stephan's authorization even when the material change he approved is unchanged.

That converts evidence freshness into repeated operator courier work.

## Principle

Operator judgment freshness and technical evidence freshness are different things.

The operator decision binds the material change:

```text
repository + PR + branch
+ authorized source head/tree
+ exact approved changed files and after-blob identities
+ authority/risk class
+ authorizationBase
```

Technical execution evidence binds whatever exact tuple is actually presented to the protected merge machinery:

```text
execution head/tree + exact current protected main
+ required checks + fresh independent review
+ mergeability + zero unresolved threads
```

`authorizationBase` is the protected-main base observed when the decision was made. It is an ancestry/base-floor anchor, not permission to execute against stale evidence.

## Route A: unchanged exact head

When repository configuration can integrate the unchanged approved head against a newer protected main, the same operator judgment may remain reusable only when:

1. repository, PR, branch, source head and source tree are unchanged;
2. authority class is unchanged;
3. `authorizationBase` is the exact merge base of current protected `main` and current main is a descendant;
4. intervening main changes touch none of the approved paths;
5. fresh exact current-head/current-base checks, independent review, mergeability and zero-thread proof succeed.

## Route B: personal-repository preservation convergence

The live personal-repository ruleset currently has no merge-queue rule, so V1 must not pretend merge-group integration is available everywhere.

For the existing preservation-convergence path, operator judgment may survive a **new exact head** only when the new head is proven evidence-equivalent to the material change already approved. Arbitrary head reuse remains forbidden.

The required convergence proof is deliberately strict:

- same canonical PR and branch;
- old authorization base -> current main is exact forward ancestry;
- intervening main paths are disjoint from the approved paths;
- exactly two convergence parents, ordered as prior approved head then exact current main;
- ordinary non-force history, with no rebase/reset claim;
- current PR estate relative to current main contains exactly the approved paths and no extras;
- every approved path has exactly the same approved after-blob SHA;
- authority class is unchanged;
- fresh exact-new-head/current-base checks, independent review, mergeability and zero-thread proof succeed.

The resulting merge remains exact-head bound to the **new** convergence head. The durable receipt must state that operator judgment was carried by evidence-equivalent preservation convergence rather than claiming the old SHA was executed.

## Fail-closed cases

Fresh operator judgment or governed repair/convergence is required for any of:

- intervening main overlap with an approved path;
- non-descendant/diverged base;
- arbitrary or unexplained source-head movement;
- wrong convergence parent lineage;
- changed approved feature blob;
- hidden extra changed path;
- authority/risk widening;
- malformed/revoked authorization provenance.

A red check, stale/dirty review, mergeability failure or unresolved thread blocks execution even when the operator judgment itself remains reusable. The correct state is `AUTHORIZATION_REUSABLE_FRESH_EVIDENCE_REQUIRED`, never success.

## Existing machinery only

This policy does not create another merge system or grant merge authority. The integration target remains the existing #1802 path:

```text
authorization_base = base floor bound to operator judgment
expected_base      = fresh exact current main for this attempt
```

Trusted GitHub-side machinery must reconstruct compatibility itself. No caller-supplied `compatible=true` assertion is authoritative.

Fresh review run/artifact identities are technical evidence and therefore bind the current execution head/base. They may refresh without requiring a new human decision only when the material-change compatibility proof above succeeds.

## Authority ceiling

The evaluator grants no ready, merge, deployment, runtime, provider, credential, ruleset or environment authority. It cannot force-push, rebase/reset, approve a protected environment or call a raw merge fallback.

## Acceptance

```text
SAME MATERIAL CHANGE + DISJOINT MAIN MOVEMENT
  -> operator judgment remains valid
  -> fresh technical evidence required
  -> no ceremonial reapproval

CANONICAL PRESERVATION CONVERGENCE + IDENTICAL FEATURE BLOBS
  -> operator judgment may carry to new exact head
  -> fresh new-head/current-base proof required

OVERLAP / DIVERGENCE / FEATURE CHANGE / EXTRA PATH / AUTHORITY WIDENING
  -> fail closed
  -> fresh operator judgment or repair required
```

No second merge system, approval store, scheduler, mailbox or ruleset bypass is introduced.
