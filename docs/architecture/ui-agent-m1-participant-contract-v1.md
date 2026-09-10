# Stephanos User Interface Agent M1 Participant Contract V1

## Purpose

This slice advances issue #1722 and umbrella product programme #1776 by registering the User Interface Agent as a governed, read-first Stephanos specialist and Shared Workspace participant.

It intentionally stops before implementation authority, production eligibility, design-system mutation, UI source changes or visual claims.

## Canonical identity

```text
participantId=user-interface-agent
agentClass=USER_INTERFACE_AND_EXPERIENCE_SPECIALIST
qaCapability=CAN_ASK_AND_ANSWER
lifecycleState=READ_ONLY_CANDIDATE
```

The participant is one specialist organ under Stephanos. It is not a second product manager, scheduler, dispatcher, agent registry, memory system or design authority.

## M1 capability boundary

The participant advertises knowledge in:

```text
ui
ux
visual-language
interaction-design
responsive-design
accessibility
motion
spatial-ui
```

M1 permits advisory task classes only:

```text
UI_RESEARCH
UI_AUDIT
UI_DESIGN
UI_REVIEW
EXPERIENCE_PROOF_PLANNING
```

`UI_IMPLEMENTATION` is deliberately absent from the M1 accepted-task set. Later implementation eligibility must be granted through the existing Executive Agent Governor and one bounded governed task contract after evaluation.

## Authority invariants

Participation grants no source or runtime authority.

```text
trustedBuilder=false
mergeAuthority=false
arbitraryShellAllowed=false
mutationAuthority=NONE_BY_PARTICIPATION
implementationAuthority=GOVERNED_TASK_CONTRACT_REQUIRED
deploymentAuthority=false
productAuthority=false
personalDataAuthority=false
selfPromotionAllowed=false
```

The existing Shared Workspace validator remains authoritative and rejects merge or arbitrary-shell widening. The M1 readiness function also fails closed if participant mutation authority or lifecycle state is widened.

## Shared Workspace projection

M1 can produce:

1. the existing `agent_capability` record kind, extended with the UI Agent's role-specific metadata;
2. the existing `participant_status` record kind bound to issue #1722 and a correlation ID;
3. a deterministic readiness projection that may advance only to M2.

The status body reports the agent class, Q&A capability, lifecycle state, authority boundary and next milestone. It does not claim that the agent is live in a model runtime or that any UI implementation has been performed.

## Next milestone

When the M1 contract is reviewed and accepted, #1722 M2 should inventory the current user-facing surface estate and existing shared visual primitives before proposing a new design component.

Required M2 outcome:

```text
M2_INVENTORY_USER_FACING_SURFACES_AND_SHARED_VISUAL_PRIMITIVES
```

The inventory should cover the landing page, AI Console, Goal Dashboard, Music Intelligence, VR Research/VR Link, Sovereignty, Wealth/Octopus, Privacy, autonomous-build controls, desktop, tablet, phone, text and future spatial surfaces where present in source truth.

## Proof boundary

Focused source proof for this slice is:

```bash
node --test shared/agents/uiAgentParticipantV1.test.mjs
```

The tests prove canonical identity, `CAN_ASK_AND_ANSWER`, knowledge-domain and advisory-task declarations, valid Shared Workspace capability/status records, read-only lifecycle, explicit absence of implementation eligibility, merge-authority rejection and fail-closed mutation-authority widening.

Hosted CI and independent exact-head review remain required. No browser, iPad, Quest, Windows Edge or visual proof is claimed by M1 because this slice changes no user-facing surface.

## Non-duplication

This slice reuses:

- #1290 Shared Agent Workspace record contracts;
- #1556 Executive Agent Governor lifecycle doctrine;
- #1722 as the canonical product goal;
- #1776 as the product programme controller.

It creates no second scheduler, product backlog, agent registry, design system, implementation lane, proof system or merge path.
