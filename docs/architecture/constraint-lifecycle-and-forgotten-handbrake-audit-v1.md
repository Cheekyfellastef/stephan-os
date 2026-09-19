# Constraint Lifecycle and Forgotten Handbrake Audit V1

## Purpose

Prevent historically reasonable restrictions from becoming invisible permanent handbrakes after the hazard, architecture, provider mix, or operator authority that justified them has changed.

This doctrine extends #1903, #1606 and #1607. It does not weaken constitutional safety rules or create a second authority system.

## Core rule

A blocking constraint is not justified forever merely because old source or a regression test still contains it.

Revalidate the hazard:

1. What hazard caused this restriction to exist?
2. Does the hazard still exist?
3. Is this still the narrowest correct protection?
4. Has another mechanism superseded it?
5. Does it block only the authority surface it protects?
6. What evidence retires or narrows it?

## Lifecycle

Use these lifecycle states for material progress-blocking constraints:

```text
CONSTITUTIONAL_PERMANENT
CONDITIONAL_ACTIVE
TEMPORARY_ACTIVE
RETIREMENT_CANDIDATE
SUPERSEDED
RETIRED
UNKNOWN_REQUIRES_RECONSTRUCTION
```

Source-local annotations may use:

```text
CONSTRAINT-LIFECYCLE: CONDITIONAL_ACTIVE
```

An annotation is lifecycle metadata, not proof that the classification is correct. Current evidence still governs.

## Constraint record

A durable constraint record should identify at least:

```text
constraintId
constraintClass
canonicalOwner
introducedByGoalOrPr
introducedAt
originalHazard
protectedAuthoritySurface
scope
blockingEffect
currentPredicate
requiredEvidence
lifecycleState
reviewCadenceOrTrigger
retirementPredicate
supersededBy
lastRevalidatedAt
lastRevalidationEvidence
knownDependants
```

## Candidate signals

The first audit intentionally looks for signals rather than declaring defects:

- explicit `fail closed` language;
- manual-dispatch/operator-wait states;
- default-deny mutation/write/auto-dispatch flags;
- restart-intent-only recovery;
- provider qualification/capacity expiry;
- `WAITING_FOR_OPERATOR`, `OPERATOR_APPROVAL_REQUIRED`, or `SAFE_HOLD` states.

A candidate is not automatically stale. It must be classified against its original hazard and current architecture.

## Test doctrine

Prefer tests that encode the safety invariant rather than freezing an old inhibited implementation.

For example, test both sides of a conditional boundary:

```text
action is forbidden when required authority/evidence is absent
action becomes eligible when the exact authorised predicates are freshly proven
unrelated eligible work continues while the constrained surface remains blocked
```

Do not weaken a constitutional boundary merely to make progress easier.

## First proving cases

The controller-multiplexer fail-closed discovery is the mandatory regression case.

The next candidate families are:

1. Mission Evidence Ledger default-deny mutation/write/auto-dispatch state.
2. Legacy `WAITING_OPERATOR_APPROVAL` / `READY_FOR_MANUAL_DISPATCH` queue semantics.
3. Battle Bridge worker self-heal `restart-intent-only` behaviour.
4. OpenClaw/provider qualification expiry and renewal behaviour.

## Flywheel return

Every confirmed stale-handbrake incident should return:

- **Knowledge:** why the original restriction existed and what changed.
- **Method:** how to tell the durable safety invariant from the obsolete implementation restriction.
- **Automation:** a detector or revalidation check for the same failure class.
- **Proof:** regressions showing both useful progress and retained safety.

The intended result is that stepping on one rake removes a family of rakes from the future path.

## Audit tool

Run:

```text
node scripts/constraint-lifecycle-audit.mjs
```

Use `--strict` only when a bounded scope has been intentionally annotated/classified. The repository-wide audit is initially diagnostic so existing unclassified constraints do not block unrelated work merely because the new detector can see them.
