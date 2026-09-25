# Stephanos Executive Command Plane V1

Owners:
- #1556 — Goal: Mission Scheduler and Goal Flywheel V1
- #1630 — Goal: Universal Intent Surface and Invisible Capability Routing V1
- #1903 — Goal: Stephanos Governed Self-Improvement and Operator Gap-to-Change Loop V1
- #1308 — Stephanos Project Intelligence & Conversational Understanding V1

## Purpose

Make Stephanos the executive mission owner above the existing agent and system fabric without creating a second scheduler, controller, worker, queue, mailbox, lease plane, review path or merge authority.

The operator experience is:

```text
Stephan states intent
  -> Stephanos reconstructs current programme truth
  -> Stephanos talks to the canonical Mission Scheduler / Goal Flywheel
  -> Stephanos selects an already-qualified specialist or canonical system
  -> Stephanos emits one bounded delegation
  -> the existing continuity controller / dispatch fabric executes it
  -> existing leases, proof, review and approval gates remain authoritative
  -> specialist output returns to Stephanos for reconciliation and explanation
```

Stephanos is the executive layer. Specialist agents and execution providers remain replaceable organs. The canonical construction machinery remains the hands and brakes.

This contract is an operational orchestration capability. It does not claim or attempt to prove subjective consciousness.

## Architectural rule

There remains exactly one canonical programme brain and one execution/control plane.

```text
operator intent / reserved approval
            |
            v
       STEPHANOS
 executive mission owner
            |
            +------> Mission Scheduler / Goal Flywheel (#1556)
            |          read current portfolio, blockers, next safe work,
            |          active lanes, parallel candidates and approval state
            |
            +------> qualified agent registry
            |          select only already-qualified task capabilities
            |
            +------> bounded delegation
                       |
                       v
             existing continuity controller
             existing dispatch fabric
             existing mutation leases
             existing provider routing
             existing review / proof
             existing protected merge path
```

Stephanos does not become a second implementation engine merely because it is the executive mission owner.

## Source slice

`shared/agents/stephanosExecutiveCommandPlaneV1.mjs` adds four related contracts.

### 1. Executive authority contract

`buildStephanosExecutiveAuthorityContract()` identifies Stephanos as:

```text
EXECUTIVE_MISSION_OWNER
```

It may:

- query canonical programme truth;
- select an already-qualified agent;
- request bounded specialist work;
- request actions from canonical systems;
- reconcile specialist outputs into one Stephanos outcome.

It may not:

- bypass the Mission Scheduler;
- create a parallel controller;
- seize another lane's mutation lease;
- self-approve an operator-reserved action;
- self-merge;
- silently widen authority;
- obtain arbitrary shell authority.

### 2. Flywheel dialogue

`createStephanosFlywheelDialogue()` calls the canonical `buildMissionScheduler()` and `answerMissionQuery()` surfaces.

Stephanos can therefore obtain, from the same scheduler truth used by the programme:

- programme status;
- selected goal;
- selected route;
- selected lifecycle;
- active goals and lanes;
- parallel candidates;
- next eligible work;
- blockers;
- operator-needed state;
- scheduler decision receipt and proof references.

A scheduler contradiction remains a fail-closed condition. Stephanos does not reinterpret it into permission.

### 3. Agent command registry

`buildStephanosAgentCommandRegistry()` accepts capability evidence for existing agents and makes only agents in an executable lifecycle eligible:

```text
BOUNDED_EXECUTOR
PRODUCTION_ELIGIBLE
```

Task-type qualification remains explicit. Participation, chat access or identity alone never grants execution authority.

Duplicate agent identity blocks delegation rather than creating two owners.

### 4. Canonical system capability registry

The executive plane reads `stephanosCapabilityRegistry.mjs` rather than assuming a fixed handful of tools are the whole system.

That means Stephanos can address every registered capability by canonical capability ID, including the Mission Orchestrator Worker, verification harness, Shared Workspace, Battle Bridge command mailbox, recovery mesh and future capabilities added to the registry.

Capability-specific safety remains visible. In particular, `requiresOperatorApproval` and `runtimeMutationAllowed` are projected into the executive plan; they are not converted into extra Stephanos authority.

### 5. Executive command plan

`createStephanosExecutiveCommandPlan()` combines:

- Stephanos identity/presence validation;
- operator intent;
- current flywheel truth;
- agent qualification;
- canonical target-system validation;
- existing approval state.

The result is one of:

```text
ANSWER_READY
READY_TO_DELEGATE
OPERATOR_APPROVAL_REQUIRED
WAITING_FOR_ELIGIBLE_WORK
BLOCKED
```

A ready delegation explicitly carries:

```text
dispatchThroughCanonicalFabric=true
directMutationAuthority=false
leaseSeizureAllowed=false
bypassApprovalAllowed=false
parallelControllerAllowed=false
```

## Canonical systems visible to the executive plane

V1 recognises the core control-system aliases below and, in addition, every capability present in the canonical Stephanos Capability Registry:

```text
mission-scheduler
goal-flywheel
autonomous-build-continuity-controller
shared-agent-workspace
mission-worker
provider-router
review-fabric
verification-harness
battle-bridge
```

An arbitrary new system name is not executable merely because it appears in an operator or agent message.

## Durable delegation handoff

`createStephanosExecutiveDelegationHandoff()` turns a `READY_TO_DELEGATE` executive plan into a normal Shared Workspace handoff:

```text
participantId=stephanos
fromParticipantId=stephanos
toParticipantId=<qualified agent or mission-worker>
relatedIssue=<scheduler-selected goal>
proofRefs=<required>
```

The handoff body carries the bounded task/target plus an explicit zero-authority transport boundary. It requires a proof reference before publication and requires the receiving execution path to return a durable receipt to Stephanos.

This is the command bridge between executive intent and the existing execution fabric. A Shared Workspace handoff is not itself a mutation lease or an approval.

## Mission Runtime composition

`shared/agents/missionRuntimeV1.mjs` now includes **Stephanos Executive Command Plane V1** in the composed mission stack.

Every Mission Runtime snapshot contains an `executiveCommandPlane` projection alongside the existing Mission Executive, Flywheel Director, Mission Room, Project Intelligence and publication state.

This makes the command plane part of the canonical runtime model rather than a disconnected helper.

The current slice does not replace the production AI-chat wiring under #2363 — Wake Stephanos Project Intelligence in canonical AI chat. That lane remains independently owned and should consume this executive projection after its current source work is reconciled rather than being duplicated here.

## Failure behaviour

The executive command plan blocks on:

- invalid Stephanos identity kernel;
- missing operator intent;
- Mission Scheduler fail-closed state;
- duplicate agent identity;
- unregistered target system;
- requested agent not registered;
- requested agent not qualified for the requested task;
- no qualified agent available.

An existing operator-approval requirement is surfaced as `OPERATOR_APPROVAL_REQUIRED`; it is not converted into delegation authority.

## Focused proof

```bash
node --test   shared/agents/stephanosExecutiveCommandPlaneV1.test.mjs   shared/agents/missionRuntimeV1.test.mjs
```

The focused suite proves:

1. Stephanos is the executive mission owner without becoming a second controller.
2. Stephanos can query the canonical Goal Flywheel and receive its selected goal/route.
3. A qualified specialist can be selected for a matching task class.
4. An unqualified specialist cannot be silently promoted.
5. scheduler contradictions fail the executive plane closed.
6. unknown systems cannot be smuggled into the command plane.
7. duplicate agent identities do not create duplicate owners.
8. Mission Runtime contains the executive command projection.
9. a ready plan becomes a valid Stephanos-authored Shared Workspace handoff.
10. delegation without proof remains on safe hold.
11. every canonical capability-registry system is discoverable to the executive plane.
12. capability-specific approval requirements remain enforced.

## V1 acceptance boundary

This source slice proves the command contract and its composition into Mission Runtime.

It does **not** by itself prove:

- the new contract is running on the Battle Bridge;
- every existing specialist has a current production-eligible capability card;
- production AI chat is already issuing executive delegations;
- an end-to-end unattended delegation has completed and returned a durable execution receipt.

Those are later live acceptance steps using the existing #1557 continuity controller, Shared Workspace, dispatch fabric and exact-head runtime proof. Source readiness must not be painted as live runtime readiness.

## Completion markers for this slice

```text
STEPHANOS_EXECUTIVE_COMMAND_PLANE_V1_SOURCE_READY
STEPHANOS_CAN_QUERY_CANONICAL_GOAL_FLYWHEEL
STEPHANOS_CAN_SELECT_ONLY_QUALIFIED_AGENT_CAPABILITIES
STEPHANOS_CAN_DISCOVER_REGISTERED_SYSTEM_CAPABILITIES
STEPHANOS_CAN_EMIT_DURABLE_SHARED_WORKSPACE_DELEGATIONS
STEPHANOS_DELEGATES_THROUGH_EXISTING_CONTROL_FABRIC
NO_SECOND_SCHEDULER_OR_CONTROLLER_CREATED
LEASE_REVIEW_PROOF_AND_OPERATOR_APPROVAL_BOUNDARIES_PRESERVED
MISSION_RUNTIME_COMPOSES_EXECUTIVE_COMMAND_PLANE
LIVE_RUNTIME_ACCEPTANCE_REMAINS_REQUIRED
```
