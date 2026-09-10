# Stephanos Native Research and Delegated Research Council V1

## Purpose

This slice advances #1902 under product controller #1776 by generalising the existing #1596/#1597 research-domain architecture into one provider-neutral research decision, mission, evidence-reconciliation and presentation contract for Stephanos.

It does not create a second research database, scheduler, Shared Workspace, agent registry, durable-memory store, provider router or source of programme truth.

The operating principle is:

```text
canonical knowledge first
  -> smallest qualified evidence route
  -> bounded evidence packet
  -> Stephanos reconciliation
  -> governed candidate promotion only
```

Research agents are scouts. Stephanos remains mission owner, systems expert and final operator-facing synthesizer.

## Existing architecture reused

The contract is deliberately aligned with:

- #1596 Continuous VR Discovery and Generic Research Domain Framework for provenance, freshness, licence and candidate admission;
- #1597 Stephanos Research Intelligence Platform for bounded research missions, specialist roles and canonical convergence;
- the existing `vr-research-agent` read-first/proposal-only pattern as the mature Domain 1 precedent;
- #1308 Project Intelligence for canonical systems knowledge and peer-level conversational evaluation;
- #1290 Shared Workspace for participant/evidence exchange rather than private agent truth;
- #1556 Executive Agent Governor and existing provider routing for qualified execution, not a new scheduler;
- #1645 governed memory for candidate promotion and correction;
- #1607 capability-gap deduplication;
- #1722 Conversation Canvas for operator presentation;
- #1903 Governed Self-Improvement for research-informed proposals without research becoming change authority.

## Route decision

`planStephanosResearchRouteV1()` chooses one of the canonical #1902 routes:

```text
ANSWER_FROM_CANONICAL_KNOWLEDGE
DIRECT_BOUNDED_RESEARCH
SINGLE_SPECIALIST_RESEARCH
MULTI_AGENT_RESEARCH_COUNCIL
WAIT_FOR_EXTERNAL_EVIDENCE
OPERATOR_JUDGMENT_REQUIRED
UNSUPPORTED_OR_UNSAFE
```

The planner checks canonical knowledge first. Fresh, sufficient and unconflicted canonical knowledge wins without browsing or delegation.

A narrow freshness-sensitive question uses direct bounded research when available. A broad but non-contested question uses one qualified specialist when that is sufficient. A contested, high-consequence or counterevidence-sensitive question may use a small council. The council prefers primary-source and sceptical/counterevidence roles when qualified, but agents do not vote themselves into truth.

Operator judgment and unsupported/unsafe states remain explicit routes rather than being researched into permission.

## Mission packet

`createStephanosResearchMissionV1()` creates one provider-neutral mission identity preserving:

```text
researchMissionId
parentIntentId
question
researchRoute
whyDelegated
researchers[]
knownContextRefs
sourcePriority
sourceExclusions
freshnessRequirement
licencePrivacyBoundary
contradictionsToCheck
forbiddenActions
returnBudgetClass
finalSynthesizer
```

Primary-source priority is explicit:

```text
PRIMARY_OFFICIAL
PRIMARY_REPOSITORY
AUTHORITATIVE_SPEC
LOCAL_PROOF
SECONDARY_CORROBORATION
```

Every mission forbids source mutation, merge, deployment, runtime mutation, arbitrary shell, credential/account change, spending, ungoverned knowledge promotion and private agent truth.

## Evidence reconciliation

`reconcileStephanosResearchEvidenceV1()` returns one `stephanos.research-packet.v1` packet.

It preserves researcher/provider provenance, claims, evidence references, conflicts, unknowns, freshness, licence/reuse notes, confidence basis, Stephanos synthesis, implications, candidate knowledge/method/gap updates and recommended next action.

Important rules:

- conflicting values for the same topic remain visible as `AGENT_OR_SOURCE_DISAGREEMENT`;
- conflicts are not resolved by majority vote or fluent prose;
- fresh primary evidence may become a governed knowledge candidate;
- stale evidence cannot silently overwrite fresher canonical state;
- candidate knowledge is explicitly `candidateOnly` and never auto-promoted;
- research cannot grant mutation, merge, deployment, runtime, spending or account authority.

## Provider substitution

`resumeResearchMissionWithProviderSubstitutionV1()` preserves the same research mission and research route while replacing an unavailable provider only with a qualified, available, provider-neutral alternative. If no qualified substitute exists, it fails closed instead of inventing continuity.

This is a research-contract continuity primitive, not a provider-selection engine. Existing sovereignty/provider machinery remains the execution owner.

## Conversation Canvas integration

The reconciled packet exposes a compact presentation projection:

```text
kind=RESEARCH_EXPEDITION
sourceCount
specialistCount
primaryEvidenceCount
conflictCount
whatChangedMyView
implicationForStephanos
evidenceExpandable=true
rawAgentTranscriptShownByDefault=false
```

#1722 remains the owner of rendering this projection into the professional Conversation Canvas. This research slice does not modify the existing #1801 UI branch while its exact-head review is active.

The intended operator experience is one Stephanos answer with expandable evidence, not a transcript dump from a council of agents.

## #1903 self-improvement relationship

Research may inform an `IMPROVE_STEPHANOS` proposal but does not grant change authority.

The product-side handoff is:

```text
observed gap
  -> canonical owner lookup
  -> research route only if useful
  -> reconciled evidence
  -> bounded improvement proposal
  -> alternatives / risk / rollback / authority needed
  -> existing Goal Flywheel construction machinery
  -> exact-head review / merge / runtime gates remain separate
```

No private improvement backlog or self-modifying control plane is created here.

## #1308 peer-intelligence proving cases

The module publishes ten source-level evaluation cases covering:

1. current system architecture and ownership truth;
2. provider mesh and zero-Codex continuity;
3. OpenClaw, Forge and GitHub role boundaries;
4. Battle Bridge and Ignition self-healing truth;
5. canonical-knowledge-first behavior;
6. narrow current technical direct research;
7. contested multi-agent research;
8. provider-outage substitution;
9. `IMPROVE_STEPHANOS` owner and authority classification;
10. research-led improvement with cognitive-vs-experience-debt separation.

These are deterministic source fixtures for the existing #1308 ten-question machinery. They do not claim that the first live Shared Workspace round has executed.

## Acceptance boundary

This PR can prove source contract behavior only.

It cannot prove:

- live web/GitHub research execution by Stephanos;
- a real specialist-provider dispatch;
- a real multi-agent council;
- provider outage recovery in production;
- live Shared Workspace persistence;
- rendered `RESEARCH_EXPEDITION` UI;
- governed knowledge promotion;
- the live ten-question peer-intelligence round.

Those remain later exact-main runtime and product proofs through the existing machinery and canonical owners.
