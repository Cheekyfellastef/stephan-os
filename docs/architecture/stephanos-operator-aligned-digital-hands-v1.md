# Stephanos Operator-Aligned Digital Hands V1

## Purpose

Stephanos is intended to become both:

1. a governed knowledge/decision digital twin of Stephan; and
2. Stephan's digital hands across the existing agent and system fabric.

These are joined, not separate aspirations.

The knowledge twin answers **what does the operator currently know, prefer, intend and regard as superseded?**

The digital-hands alignment contract answers **is this proposed action consistent with that current operator context, and which existing authority gate must handle it?**

## Architecture

```text
Stephan
  ↓ intent / teaching / correction
Shared conversation + Operator Knowledge Twin
  ↓ current non-superseded alignment evidence
Operator-Aligned Digital Hands
  ↓ bounded aligned proposal
#2416 Stephanos Executive Command Plane
  ↓
Goal Flywheel / qualified specialists / canonical systems
  ↓
existing continuity + leases + review + approvals + proof
```

This source does not create a new executor.

## Alignment rules

Every proposed action must bind:

- one explicit operator intent;
- one valid current Operator Knowledge Twin;
- one exact action identity and class;
- one canonical target system;
- source/provenance references.

The alignment view considers only current operator-authored knowledge. Guidance already superseded by a later correction is excluded from the current alignment basis.

Explicit negative operator guidance can block a conflicting proposal.

## Action classes

```text
READ_ONLY_RESEARCH
PLAN
DELEGATE_BOUNDED_WORK
PREPARE_CHANGE
MUTATE_SOURCE
MERGE
DEPLOY
EXTERNAL_ACCOUNT_ACTION
SPEND_MONEY
```

Read-only/planning/bounded-delegation work may proceed only to the existing executive command planner.

Reserved mutation classes remain operator-approval gated:

```text
MUTATE_SOURCE
MERGE
DEPLOY
EXTERNAL_ACCOUNT_ACTION
SPEND_MONEY
```

Alignment never becomes approval.

## Authority

The alignment contract cannot execute commands, write memory, mutate source/runtime/accounts, approve, merge, deploy, spend, seize leases, bypass approvals or create a parallel controller.

Every ready output requires dispatch through the existing canonical fabric.

## Relationship to #2416

#2416 **Put Stephanos above the agent fabric with an executive command plane** already provides the executive delegation machinery.

This contract is deliberately an upstream alignment joint for that plane.

A future integration should require a valid `stephanos.operator-aligned-digital-hands.v1` receipt before an operator-facing Stephanos request is promoted into an executive delegation. The command plane remains responsible for qualification, flywheel truth, canonical target discovery and existing approval requirements.

## Acceptance

```text
STEPHANOS_OPERATOR_ALIGNED_DIGITAL_HANDS_CONTRACT_READY
CURRENT_OPERATOR_KNOWLEDGE_GUIDES_DELEGATION
SUPERSEDED_GUIDANCE_DOES_NOT_STEER_CURRENT_ACTION
EXPLICIT_CONFLICTING_GUIDANCE_BLOCKS_DISPATCH
RESERVED_ACTIONS_REMAIN_OPERATOR_APPROVAL_GATED
ALIGNED_HANDS_USE_EXISTING_EXECUTIVE_AND_EXECUTION_FABRIC
NO_SECOND_EXECUTOR_OR_AUTHORITY_PLANE
```
