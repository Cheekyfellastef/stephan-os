# Engineering Incident, Method and Regression Memory V1

Status: source-built candidate under #1959 / #1956

## Purpose

Stephanos already produces valuable engineering evidence in issues, PRs, tests, reviews and runtime receipts. This contract turns bounded proven failures, repairs, counterexamples and reusable methods into records suitable for the existing #1645 memory fabric and #1607 Method Library.

It is not a second memory store, incident tracker, scheduler or reflection engine.

## Record classes

```text
ENGINEERING_INCIDENT
ROOT_CAUSE_FINDING
SUCCESSFUL_REPAIR
FAILED_REPAIR
REGRESSION_CASE
REUSABLE_METHOD
COUNTEREXAMPLE
AUTOMATION_CANDIDATE
SUPERSEDED_METHOD
```

Each record keeps problem class, component/owner references, time, optional exact source head/base, symptom, root cause, repair or method, prerequisites, forbidden shortcuts, failure modes, counterexamples, test/proof evidence, runtime evidence, confidence basis, freshness, supersession, domains, privacy and status.

## Evidence and truth boundaries

- A symptom is not automatically a root cause.
- A proposed repair is not automatically successful.
- Root-cause and repair records require attributable proof.
- Failed repairs remain visible and cannot become preferred methods.
- Superseded methods remain historical while current methods are selected for new work.
- Regression records preserve behavioural intent and proof references, not only a test filename.
- Unrestricted transcripts and raw logs are not admitted.
- Sensitive material may be represented only as explicitly omitted bounded state.

## Coding memory pack

`stephanos.engineering-coding-memory-pack.v1` selects relevant records for one problem/component scope.

Selection order is:

1. current reusable methods and successful repairs;
2. incidents, root causes, failed repairs, regressions and counterexamples;
3. inert automation candidates;
4. remaining relevant history within the declared count and byte bounds.

Failed or superseded repairs are never returned as preferred current methods. They remain available to prevent repetition.

## Authority boundary

Records and packs grant no source mutation, approval, merge, deployment, runtime mutation, memory mutation, automation execution, account access, spending, provider selection or arbitrary command authority.

An automation candidate is only a candidate for #1607 adjudication.

## Intended composition

```text
PR / test / review / runtime evidence
  -> Engineering Incident or Method record
  -> existing #1645 governed memory and supersession
  -> compact coding memory pack
  -> #1957 repository engineering knowledge pack
  -> qualified coding worker
  -> exact proof and completion write-back
```

## Initial proof

The deterministic tests cover proven repair admission, unsupported root-cause rejection, failed-repair visibility without preference, method supersession, sensitive raw-content rejection, inert automation candidates, later incident/regression retrieval and authority-widening rejection.
