# Main-Movement-Tolerant Operator Authorization V1

## Problem

Protected merge authorization currently binds operator judgment and technical execution evidence to the same exact `main` SHA. On a fast-moving repository an unrelated protected merge can therefore invalidate Stephan's authorization even when the approved PR head, tree, changed-file estate and authority class have not changed.

That converts evidence freshness into repeated operator courier work.

## Principle

Operator judgment freshness and technical evidence freshness are different things.

V1 keeps the operator decision pinned to the immutable source change while allowing the protected execution base to move only through a tightly bounded compatibility proof:

```text
operator judgment
  = repository + PR + branch + exact source head + exact source tree
    + exact approved changed-path estate + authority class
    + authorizationBase

technical execution evidence
  = exact current protected main + current mergeability + required checks
    + fresh independent review + zero unresolved threads
```

`authorizationBase` is the protected-main base observed when the operator made the decision. It is a base-floor and ancestry anchor. It is not permission to execute against stale evidence.

`executionBase` is the exact current protected `main` used by the eventual protected execution attempt.

## Compatible base movement

The same operator judgment may remain reusable only when all of the following are proven:

1. repository, PR, branch, source head and source tree are unchanged;
2. the exact approved changed-path estate is unchanged;
3. the authority/risk class is unchanged;
4. `authorizationBase` is the exact merge base of current protected `main` and current main is a strict descendant, or current main is still the authorization base;
5. intervening main changes touch none of the approved changed paths;
6. fresh current-base required checks, independent review, mergeability and zero-thread proof are obtained before protected execution.

Path overlap is deliberately conservative in V1. A future semantic compatibility proof may safely admit more cases, but V1 does not guess.

## What still invalidates operator judgment

Fresh operator judgment or an explicitly governed convergence is required when any of these occur:

- source head moves;
- source tree moves;
- branch or PR identity moves;
- changed-file estate widens or changes;
- authority class widens or changes;
- current main is not a normal descendant of the authorization base;
- intervening main touches an approved changed path;
- authorization provenance is malformed or revoked.

Technical evidence failure does not silently invalidate the human decision, but it still blocks execution. A red check, non-clean fresh review, mergeability failure or unresolved thread yields `AUTHORIZATION_REUSABLE_FRESH_EVIDENCE_REQUIRED`, never merge success.

## Authority ceiling

The deterministic evaluator grants no merge, deployment or runtime authority. It cannot force-push, rebase/reset, modify rulesets, approve a protected environment, call the raw merge endpoint or manufacture fresh review evidence.

The existing `operator-merge-approval-gate.yml`, #1802 dispatch path, protected environment and personal-repository/merge-group machinery remain the only execution authority. This contract is intended to let that existing machinery distinguish stale technical evidence from an actually stale operator decision.

## Integration target

The protected dispatch contract should carry both:

```text
authorization_base = base bound to the original operator decision
expected_base      = fresh exact current main used for this execution attempt
```

When they differ, the trusted workflow must reconstruct the compatibility proof from GitHub before accepting the original authorization provenance. It must never trust a caller-supplied `compatible=true` assertion.

Fresh independent review identifiers/digests remain bound to `expected_base`; they are technical evidence and may be refreshed without rewriting the operator's decision when compatibility proof passes.

## Acceptance

V1 is complete only when the existing protected workflow can prove both canaries:

```text
UNCHANGED_CHANGE + DISJOINT_DESCENDANT_MAIN
  -> operator authorization remains valid
  -> technical evidence refreshes
  -> no ceremonial reapproval

UNCHANGED_CHANGE + OVERLAPPING_OR_DIVERGED_MAIN
  -> fail closed
  -> no merge
  -> fresh judgment/convergence required
```

No second merge system, approval store, scheduler, mailbox or ruleset bypass is introduced.
