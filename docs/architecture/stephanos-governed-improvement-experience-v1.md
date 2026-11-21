# Stephanos Governed Improvement Experience V1

## Purpose

This source-only product slice advances #1903 under canonical product controller #1776.

It gives Stephanos a deterministic conversational contract for understanding requests such as:

```text
Improve this.
This keeps breaking; make it self-healing.
Make this easier.
Stephanos should know this.
Why is this still dependent on Codex?
```

The contract does not implement a second self-improvement controller. Construction execution remains owned by the existing Goal Flywheel and qualified construction/review machinery.

## Existing-owner-first

Before new work is admissible, durable state must establish whether a canonical owner already exists.

The improvement record therefore carries:

```text
ownerLookupComplete
currentCanonicalOwner
relatedGoalsAndPrs
newGoalCandidateAllowed
```

A new-goal candidate is possible only when owner lookup is complete and no owner exists. If an owner exists, `planStephanosImprovementExperienceV1()` returns `ATTACH_TO_EXISTING_GOAL`.

This is the product-side enforcement of #1903's rule that one complaint must not become a duplicate programme.

## Improvement record

`buildStephanosImprovementRecordV1()` records the operator outcome and evidence separately from proposed change authority.

It includes:

```text
improvementId
gapSource
gapSummary
operatorOutcome
observedEvidenceRefs
currentCanonicalOwner
relatedGoalsAndPrs
currentArchitectureState
rootCauseState
researchRequired
researchRoute
researchRefs
candidateChanges
recommendedChange
whyThisChange
expectedBenefit
blastRadius
riskClass
reversibility
resourceScopes
authorityRequired
operatorAuthorizationState
implementationOwner
requiredReview
requiredProof
rollbackPlan
status
```

Unknown root cause remains unknown. Research references can inform the proposal without becoming authority.

## Natural-language intake

`classifyOperatorImprovementIntentV1()` recognises broad product intent classes without pretending to identify the canonical owner from wording alone.

Examples:

- repeated breaking/self-healing language -> reliability gap;
- easier/fewer-clicks/UI language -> experience debt;
- `Stephanos should know this` -> knowledge/retrieval gap;
- Codex/provider/fallback language -> provider-sovereignty gap;
- generic `improve this` -> operator-reported gap.

Canonical ownership must still come from durable state.

## Peer-intelligence evaluation handoff

`classifyPeerEvaluationOutcomeV1()` enforces the #1308/#1722 split:

```text
cognitively incorrect answer
  -> COGNITIVE_CAPABILITY_GAP
  -> #1308 / #1607 / #1721

cognitively correct but hard-to-use answer
  -> EXPERIENCE_DEBT
  -> #1722
```

This prevents a polished interface from hiding a reasoning gap and prevents a correct answer from being misclassified as cognitively weak merely because presentation is poor.

## Research relationship

When diagnosis or design choice is uncertain, the record may carry a #1902 research route and evidence references:

```text
NO_RESEARCH_NEEDED_KNOWN_REPAIR
DIRECT_BOUNDED_RESEARCH
SPECIALIST_RESEARCH
MULTI_AGENT_RESEARCH_COUNCIL
EXPERIMENT_REQUIRED
OPERATOR_JUDGMENT_REQUIRED
```

Research remains evidence. It does not grant source, merge, deployment, runtime, account or spending authority.

## Authorization separation

The contract recognises the #1903 authorization classes individually and never treats one as implying another:

```text
PROPOSAL_ONLY
SOURCE_IMPLEMENTATION_AUTHORIZED
BOUNDED_REPAIR_AUTHORIZED
NEW_GOAL_SCOPE_AUTHORIZED
EXACT_HEAD_MERGE_AUTHORIZED
DEPLOYMENT_AUTHORIZED
WINDOWS_RUNTIME_MUTATION_AUTHORIZED
OPENCLAW_MUTATION_AUTHORIZED
SPENDING_OR_EXTERNAL_ACCOUNT_AUTHORIZED
```

`authorizationAllowsImprovementStepV1()` is intentionally exact-class. Source implementation authority does not become merge authority; merge does not become deployment; Windows does not become OpenClaw; proposal does not become spending/account access.

## Conversation Canvas presentation

`createImproveStephanosPresentationV1()` emits a compact `IMPROVE_STEPHANOS` projection containing:

```text
gap
why it matters
evidence
root cause state
research route / evidence
existing owner
recommended proposal
alternatives
expected benefit
risk / blast radius / reversibility / rollback
authority needed
authorization state
progress / next action
required and completed proof
```

It is summary-first with progressive disclosure. Raw construction transcripts are not part of the default operator experience. #1722 remains the rendering owner; this slice does not modify the active #1801 Conversation Canvas branch while its exact-head assurance is running.

## Recurring failure rule

A regression or repeated machinery failure should attach its new evidence to the existing owner and become a self-healing/automation acceptance requirement where appropriate. The product contract does not open a replacement recovery system.

## Construction boundary

The immutable authority boundary is:

```text
product contract may explain/propose/classify: yes
product contract may create scheduler/build worker: no
product contract may mutate source: no
product contract may merge/deploy: no
product contract may mutate Windows/OpenClaw: no
product contract may spend/change external account: no
product contract may widen agent authority: no
```

After appropriate authorization, existing provider-neutral construction machinery performs the bounded implementation, independent exact-head proof and later protected gates.

## Acceptance boundary

This source can prove classification, deduplication, proposal shape, authority semantics and Canvas presentation data only.

It does not claim:

- live conversational routing from the served UI;
- automatic canonical-owner lookup against live GitHub/Shared Workspace;
- live #1902 research execution;
- source implementation by the Goal Flywheel;
- merge/deployment/runtime completion;
- rendered desktop/iPad/phone `IMPROVE_STEPHANOS` acceptance.

Those remain later proofs through #1308, #1722, #1902, #1903 and existing construction/runtime machinery.
