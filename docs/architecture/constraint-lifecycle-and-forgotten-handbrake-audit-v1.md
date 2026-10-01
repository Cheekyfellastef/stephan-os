# Constraint Lifecycle and Forgotten Handbrake Audit V1

## Purpose

Prevent historically reasonable restrictions from becoming invisible permanent handbrakes after the hazard, architecture, provider mix, or operator authority that justified them has changed.

Also detect flywheel discontinuities where a capability, planner, admission module, lesson synthesizer, or handoff exists and is tested but never reaches a production consumer.

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

A flywheel stage is not considered connected merely because its source and tests exist. For a non-terminal stage, trace at least one production consumer or durable downstream admission path. If the stage intentionally terminates, that terminal role should be explicit.

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

The audit intentionally looks for signals rather than declaring defects:

- explicit `fail closed` language;
- manual-dispatch/operator-wait states;
- default-deny mutation/write/auto-dispatch flags;
- provider qualification that remains denied admission authority;
- restart-intent-only recovery;
- provider qualification/capacity expiry;
- `WAITING_FOR_OPERATOR`, `OPERATOR_APPROVAL_REQUIRED`, or `SAFE_HOLD` states;
- flywheel-facing exported modules with no production importer.

A candidate is not automatically stale or broken. It must be classified against its original hazard, intended terminal role, and current architecture.

## Flywheel continuity rule

Treat this pattern as a first-class audit candidate:

```text
producer exists
+ contract exists
+ tests exist
+ useful output exists
+ no production consumer/admission/re-entry path
= FLYWHEEL_CONTINUITY finding
```

Examples include a gap detector that never persists a gap, a proposal planner that never reaches scheduler admission, reflective lessons that never reach governed method promotion, an admission evaluator with no live caller, or an execution handoff that no dispatcher consumes.

The detector is deliberately conservative. It does not auto-wire a module, grant authority, or delete an intentional leaf. It asks the owning programme to prove the downstream consumer or explicitly classify the endpoint as terminal.

## Test doctrine

Prefer tests that encode the safety invariant rather than freezing an old inhibited implementation.

For example, test both sides of a conditional boundary:

```text
action is forbidden when required authority/evidence is absent
action becomes eligible when the exact authorised predicates are freshly proven
unrelated eligible work continues while the constrained surface remains blocked
```

For flywheel continuity, test the full arrow rather than only the producer:

```text
producer emits bounded result
consumer accepts the exact result
canonical state changes only through its existing authority boundary
downstream scheduler/knowledge/method path can observe the admitted result
replay is idempotent and conflicting truth still fails closed
```

Do not weaken a constitutional boundary merely to make progress easier.

## First proving cases

The controller-multiplexer fail-closed discovery is the mandatory regression case.

The first candidate families are:

1. Mission Evidence Ledger default-deny mutation/write/auto-dispatch state.
2. Legacy `WAITING_OPERATOR_APPROVAL` / `READY_FOR_MANUAL_DISPATCH` queue semantics.
3. Battle Bridge worker self-heal `restart-intent-only` behaviour.
4. OpenClaw/provider qualification expiry and renewal behaviour.
5. Ambient Question-to-Goal Gap Intake with no production consumer.
6. Governed Improvement Proposal Planner with no production consumer.
7. Reflective Memory with no production promotion/consumer path.
8. Provider Independence Mission Admission with no production caller.
9. Native Research execution handoff with no production dispatcher consumer.

## Flywheel return

Every confirmed stale-handbrake or continuity-gap incident should return:

- **Knowledge:** why the original restriction or disconnected endpoint existed and what changed.
- **Method:** how to tell the durable safety invariant from the obsolete implementation restriction, or a real production handoff from a source-only endpoint.
- **Automation:** a detector or revalidation check for the same failure class.
- **Proof:** regressions showing both useful progress and retained safety, including the downstream consumer when the lesson is about continuity.

The intended result is that stepping on one rake removes a family of rakes from the future path.

## Audit tool

Run:

```text
node scripts/constraint-lifecycle-audit.mjs
```

Use `--strict` only when a bounded scope has been intentionally annotated/classified. The repository-wide audit is initially diagnostic so existing unclassified constraints and continuity candidates do not block unrelated work merely because the new detector can see them.
