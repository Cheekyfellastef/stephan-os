# Stephanos Spatial Bridge Doctrine

**Status:** Durable design doctrine, implementation deferred  
**Recorded:** 2026-07-13  
**Primary owner:** Stephan Callear  
**Retrieval tags:** `vr`, `spatial-surface`, `captain-model`, `quest-3`, `intent-engine`, `battle-bridge`, `approval-gates`, `verification`, `starship-bridge`

## Purpose

This document preserves the operating and safety decisions for a future Stephanos spatial surface. It is a design contract for later iteration, not authority to begin the spatial build before the underlying Stephanos intelligence, continuity, execution, approval, and verification systems are mature.

The spatial surface is intended to make Stephanos easier to inhabit, understand, and command. It must not become a second Stephanos, a separate memory system, or a bypass around the platform's safety machinery.

## Captain operating model

Stephan is already operating as the captain of Stephanos.

The captain supplies:

- intent
- judgment between meaningful alternatives
- authority for bounded actions
- acceptance or rejection of completion evidence

Stephanos supplies:

- interpretation of intent
- goal and dependency discovery
- capability-gap identification
- planning and decomposition
- builder, researcher, verifier, and runtime coordination
- Battle Bridge, OpenClaw, Codex, connector, and local-service routing
- safe execution within granted authority
- rollback planning
- proof collection
- continuity and retrieval
- escalation only when genuine judgment or permission is required

The governing principle is:

> The captain commands the ship. The captain does not carry messages between decks or perform repeatable engineering rituals.

Every repeatable, deterministic, bounded, and safely verifiable manual operator action is automation debt. The preferred interaction is spoken or written intent followed by verified completion.

## Spatial surface role

The spatial surface does not make Stephanos intelligent. It makes Stephanos's existing intelligence, state, relationships, simulations, evidence, and proposals visible and navigable in space.

It should provide:

- a persistent mental map of missions and systems
- peripheral awareness without notification overload
- visible relationships between goals, dependencies, evidence, and simulations
- gaze, selection, controller, and voice context for intent
- safe previews before consequential actions
- a coherent captain, department, subsystem, and engineering hierarchy
- continuity of unfinished thought stacks across sessions

The headset is a command surface, not the source of truth.

## Visual doctrine

The first spatial version should use an original Stephanos interpretation of a far-future starship bridge, strongly influenced by the calm, advanced, mission-first character of a 32nd-century bridge without reproducing a specific copyrighted set or interface.

Desired qualities:

- panoramic and seated-first
- elegant, calm, high-trust, and information-rich
- thin precise borders and layered luminous surfaces
- subtle animation with reduced-motion safeguards
- summary-first hierarchy
- meaningful use of depth and peripheral space
- alerts that enter attention only when thresholds are crossed
- no floating-window clutter or decorative crew avatars

The bridge metaphor is functional:

- **Captain position:** intent, judgment, approvals, mission status
- **Navigation / mission direction:** goals, trajectories, dependencies, next actions
- **Operations:** live agents, workflows, connectors, and runtime status
- **Science / analysis:** research, evidence strength, contradictions, simulations, unknowns
- **Engineering:** Battle Bridge, OpenClaw, Codex, diagnostics, rollback, and verification
- **Octopus view:** connected financial, project, system, and life variables with scenario propagation

## Single-brain rule

Desktop, phone, tablet, voice, and spatial surfaces must all use the same canonical Stephanos state.

The spatial client must not own independent copies of:

- goals
- memory
- approvals
- agent state
- execution queues
- evidence
- completion verdicts
- authority policy

A headset may disconnect or disappear without losing mission state, approval history, execution state, or proof. This is the primary architectural readiness test.

## Safe connection architecture

The intended path is:

```text
Quest 3 spatial client
        ↓
Authenticated surface gateway
        ↓
Stephanos integration spine and canonical state
        ↓
Intent and contextual-reference interpretation
        ↓
Proposal, capability, and risk classification
        ↓
Approval policy and exact-action authorization
        ↓
OpenClaw / Codex / Battle Bridge / connectors
        ↓
Verification harness and evidence ledger
        ↓
Result returned to every Stephanos surface
```

The Quest must never connect directly to PowerShell, arbitrary shell execution, Git mutation, files, OpenClaw mutation routes, game launchers, or external accounts.

## Spatial context contract

A spatial utterance such as “fix that” is not actionable by itself. Stephanos must receive a structured context packet containing at least:

- authenticated user and device session
- selected or gazed-at object identifier
- visible surface and department
- active mission
- spoken or controller intent
- timestamp and expiry
- reference-resolution confidence
- current revision of the target object

Low-confidence reference resolution must produce a question or proposal, never mutation.

## Command envelope

Every requested action originating from the spatial surface must be converted into a bounded command envelope containing:

- intended outcome
- exact target
- proposed action
- required capability
- risk level
- reversibility and rollback route
- required authority
- expected verification evidence
- request identifier for idempotency
- expiry time
- target revision or state fingerprint

The spatial client never receives broad or permanent “run anything” authority.

## Approval doctrine

Approval applies to an exact proposal, not a vague sentence.

Before meaningful consequence, the bridge should show:

- what Stephanos understood
- what will change
- which systems will be touched
- why the route was selected
- what is uncertain
- whether the action is reversible
- the rollback plan
- the expected proof of completion

Approval must be bound to one target, one action set, one revision, one authority scope, and one expiry window. Duplicate events or network retries must not execute the same action twice.

## Evidence doctrine

“Done” is not sufficient.

Every completed action should return:

- action attempted
- actual observed result
- verification performed
- evidence identifiers or artifacts
- detected side effects
- rollback availability
- confidence and remaining uncertainty
- Stephanos completion verdict

The same evidence must be available from spatial and non-spatial surfaces.

## Safety and failure behaviour

The spatial connection must fail closed.

Required behaviour includes:

- authenticated and revocable sessions
- stale-session and headset-removal detection
- read-only fallback when identity, state, telemetry, or authority is uncertain
- immediate stop-current-actions control
- approval revocation where technically possible
- flat-screen and mobile fallback
- Battle Bridge kill switch outside the headset
- bounded timeouts for proposals and approvals
- no hidden execution after spatial disconnect
- audit records for intent, proposal, approval, execution, and proof

## Transition stages

### Stage 1: Mirror

Render captain, department, mission, goal, evidence, and system-health views in Quest 3. No commands, approvals, or writes.

### Stage 2: Navigate and ask

Allow gaze or controller selection, object inspection, and questions about visible Stephanos state. Still read-only.

### Stage 3: Proposal mode

Allow spoken intent to become structured proposals with risk, capability, rollback, and proof plans. No execution.

### Stage 4: Bounded reversible actions

Permit a small allowlist such as pinning a goal, recording a thought, changing bridge layout, requesting research, or launching an already-proven profile. Log and verify every action.

### Stage 5: Captain approvals

Permit exact-action approvals for workflows that already have mature safety and verification contracts.

### Stage 6: Intent-level command

Only after repeated proof of reliable interpretation, execution, rollback, and verification should broad commands such as “prepare the ship for Starfield VR” be accepted.

## Stephanos readiness gates

The spatial build should not become an execution surface until Stephanos can demonstrate:

1. **Canonical continuity** across chats, devices, restarts, and agents.
2. **Reliable intent interpretation** with explicit uncertainty and reference resolution.
3. **Capability discovery** that distinguishes available, missing, blocked, and unproven routes.
4. **Shared Agent Workspace truth** for goals, dependencies, actions, blockers, and evidence.
5. **Bounded authority policy** with deny-by-default capability grants.
6. **Remote Battle Bridge control** that is authenticated, reversible where possible, and independently stoppable.
7. **Verification harness maturity** that returns observed evidence rather than claims.
8. **Rollback and known-good state** for systems that may be changed.
9. **Idempotent execution** resilient to duplicate events and reconnects.
10. **Surface parity** so the same mission and evidence can be recovered outside VR.

## Initial spatial data contract

A first read-only bridge should consume a versioned projection containing:

- overall mission status
- active mission and current intent
- major blockers
- next best action
- confidence and freshness
- department summaries
- active agents and workflows
- Battle Bridge and runtime health
- pending approvals
- evidence gaps
- recent verified changes
- alerts that have crossed a meaningful threshold
- selected-object details

The surface should consume this projection without knowing the internal implementation of the services that produced it.

## Interaction and comfort defaults

The initial physical model is seated cockpit use:

- Quest 3 head tracking for attention and orientation
- Xbox controller for deliberate navigation and selection
- voice for intent and questions
- optional hand interaction only after it adds clear value
- large readable typography and restrained depth
- stable world-locked panels
- no critical information placed at uncomfortable neck angles
- no constant animations or notification projectiles
- performance and frame pacing treated as safety requirements

## What the spatial surface must not become

- a wall of floating web pages
- a separate VR-only memory or goal system
- an arbitrary-command terminal
- a direct Quest-to-Battle-Bridge control path
- a decorative bridge with weak mission utility
- a requirement for completing normal Stephanos work
- a source of notification noise
- a reason to duplicate platform logic

## Current decision

Save and grow the spatial design now, but defer implementation until Stephan judges Stephanos intelligent and dependable enough to understand the whole operating context and safely close the gap between intent and reality.

The spatial surface should arrive as a new face of a mature Stephanos, not as a substitute for maturity.

## Future iteration questions

Record later decisions beneath this doctrine or in linked notes:

- Which versioned projection becomes the canonical spatial API?
- Which authentication method is appropriate for Quest 3 over the local/Tailscale path?
- Which speech-to-text and wake/attention model remains local-first and reliable?
- How should gaze confidence be fused with controller selection and spoken references?
- Which actions qualify for the first bounded allowlist?
- What constitutes sufficient proof to promote an action class from proposal-only to executable?
- How should the bridge preserve spatial layout across sessions without owning mission state?
- Which original visual motifs make the bridge recognisably Stephanos rather than a replica?
- What telemetry is necessary to maintain comfort and detect degraded Quest Link or PCVR performance?

## Retrieval instruction

When planning or reviewing any Stephanos spatial, WebXR, Quest, voice, cockpit, or VR command-surface work, retrieve this doctrine first. Treat its captain model, single-brain rule, safety architecture, staged transition, and readiness gates as governing constraints unless Stephan explicitly changes them.
