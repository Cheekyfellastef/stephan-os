# VR Research Participant Q&A V1

## Purpose

This slice advances #1723 and #1597 by making the existing canonical VR Research Workspace projection answerable through one bounded, role-specific Q&A adapter.

It does not create a second VR chatbot, research lab, source registry, Shared Workspace, scheduler, memory silo or runtime worker.

## Existing state reused

The adapter consumes:

- `shared/agents/vrResearchWorkspaceProjectionV1.mjs`
- `shared/agents/vrResearchAgentV1.mjs`
- the existing Shared Workspace `MESSAGE` record

Canonical participant identity:

```text
participantId = stephanos-vr-research
agentId = vr-research-agent
qaCapability = CAN_ASK_AND_ANSWER
```

The projection remains the source of VR research truth. The Q&A adapter does not maintain private research memory.

## Ten bounded question classes

V1 supports the ten #1723 proving areas as explicit role-bounded classes:

```text
SOURCE_STACK
NEXT_EXPERIMENT
EVIDENCE_PLANE
AUTHORING_VS_RUNTIME
VORPX_BASELINE
SKYRIM_PARITY
LICENCE_BOUNDARIES
SPATIAL_BRIDGE_BLOCKERS
NEXT_BOUNDED_GOAL
KNOWN_UNKNOWNS
```

Questions outside this role are rejected rather than converted into generic execution authority.

## Evidence behavior

A grounded answer must come from a fresh `stephanos.vr-research.workspace.v1` projection.

The adapter can surface:

- canonical source identities, revisions, health and licence classes;
- the current research queue;
- source-specific evidence-plane facts;
- the separation between official authoring evidence and observed runtime/headset proof;
- the registered vorpX baseline;
- the registered Skyrim VR parity source;
- restricted/analysis-only source boundaries;
- Spatial Bridge blockers and outstanding runtime/headset evidence requests;
- the projection's next authorised action;
- explicit unresolved blockers, runtime requests and discovery candidates.

The adapter never treats creator/public evidence as installed-runtime proof merely because both are VR-related.

## Epistemic states

Answers use explicit states such as:

```text
KNOWN_FROM_CANONICAL_STATE
PROPOSED
UNKNOWN
STALE
```

Grounded answers return projection proof references.

Missing evidence returns a buildable gap rather than confident filler.

A stale projection returns:

```text
answerVerdict = GAP_FRESHNESS
epistemicState = STALE
```

and cannot be promoted into a grounded answer.

## Gap observations

When a bounded VR question cannot be answered, the adapter emits one deterministic gap observation with existing canonical goal candidates first.

Examples:

```text
EVIDENCE_PLANE -> #1592 / #1594 / #1597
AUTHORING_VS_RUNTIME -> #1594 / #1595 / #1611
VORPX_BASELINE -> #1591 / #1596
SKYRIM_PARITY -> #1591 / #1593
SPATIAL_BRIDGE_BLOCKERS -> #1605 / #1723 / #1760
```

The adapter does not create issues itself and does not create a second backlog.

## Shared Workspace answer record

A Q&A result can be projected into the existing Shared Workspace `MESSAGE` kind:

```text
participantId = stephanos-vr-research
recipientParticipantId = asker
channel = vr-research-qa
recordSubtype = conversation-answer
relatedIssue = #1723
```

The record explicitly carries no source, command, merge or deployment authority.

## Safety boundaries

The Q&A adapter does not:

- execute a game or downloaded binary;
- inspect arbitrary local files;
- start a Battle Bridge task;
- write canonical VR facts back automatically;
- merge or deploy source;
- grant runtime mutation authority;
- promote a source claim into headset proof;
- bypass provenance or licence boundaries.

## Focused proof

```bash
node --test shared/agents/vrResearchWorkspaceProjectionV1.test.mjs shared/agents/vrResearchAgentV1.test.mjs shared/agents/vrResearchParticipantQaV1.test.mjs
```

The new test suite proves:

- all ten bounded question classes use one canonical projection;
- source and licence boundaries remain visible;
- authoring/public/runtime evidence stays separated;
- missing evidence becomes a deduplicatable gap;
- stale projection truth cannot pass as grounded;
- absent projection fails honestly;
- answer records validate through the existing Shared Workspace contract;
- out-of-role questions are rejected.

## Truth boundary

This is a faithful source-level Q&A participant adapter. It does not yet claim that ChatGPT or the Stephanos AI Console has delivered a live question through the runtime Shared Workspace and received the answer without operator courier work.

That live transport/cross-surface acceptance remains a later #1723/#1594 gate.
