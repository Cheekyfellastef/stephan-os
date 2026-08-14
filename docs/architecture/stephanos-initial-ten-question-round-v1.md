# Stephanos Initial Ten-Question Proving Round V1

## Purpose

Advance #1308, #1290 and product programme #1776 from generic conversational capability contracts into the first canonical proving round that ChatGPT can send to Stephanos through the existing Shared Workspace conversation codec.

This slice defines the questions and evaluation packet. It does not fake a live exchange and does not contain expected answers.

## Why a canonical first round

The Ten-Question Capability Ladder requires the initial ChatGPT-to-Stephanos cycle to cover materially different capabilities rather than ten paraphrases of a status request.

The first round therefore covers exactly:

```text
CURRENT_PROGRAMME_TRUTH
ARCHITECTURE_AND_RELATIONSHIPS
MEMORY_AND_CONTINUITY
AGENT_AND_TOOL_CAPABILITIES
BLOCKERS_AND_PROOF
WHY_A_DECISION_WAS_MADE
WHAT_CHANGED_RECENTLY
NEXT_BEST_ACTION
CROSS_DOMAIN_CONNECTION
SELF_KNOWLEDGE_AND_UNKNOWNS
```

## Initial questions

The questions ask Stephanos to explain and prove topics such as:

- what product capability is actually being built now;
- how the product programme, intelligence, Shared Workspace and Mission Scheduler relate;
- what continuity survives restart and how it is governed;
- what ChatGPT, OpenClaw, VR Research Agent and Stephanos can and cannot do;
- what prevents current product slices being called live;
- why product work was separated from machinery work;
- what materially changed in the latest product cycle;
- the next highest-value safe product action;
- how intelligence, VR Research and Spatial World Foundry compound toward Idea Planets;
- what Stephanos cannot currently prove and which existing goals own those gaps.

No answer text or target conclusion is embedded in the question packet.

## Existing contracts reused

The round reuses:

- #1774 `stephanosConversationalCapabilityLadderV1.mjs` for exact ten-question validation, epistemic state and gap classification;
- #1777 `stephanosSharedWorkspaceConversationAdapterV1.mjs` for existing Shared Workspace question/answer message records and evaluation;
- #1290 Shared Participant Question and Answer Fabric;
- #1308 as the canonical conversational intelligence owner.

No second conversation transport, chatbot, workspace, memory store, scheduler or gap queue is created.

## Packet behavior

`buildInitialStephanosTenQuestionPacketV1()` creates exactly ten existing Shared Workspace `MESSAGE` records:

```text
participantId=chatgpt-bridge
recipientParticipantId=stephanos
channel=shared-participant-qa
recordSubtype=conversation-question
```

Every record retains:

```text
sourceMutationAllowed=false
commandExecutionAllowed=false
approvalAllowed=false
mergeAllowed=false
deploymentAllowed=false
```

The packet explicitly reports:

```text
completionClaimAllowed=false
liveConversationClaimAllowed=false
```

Creating the packet is not proof that Stephanos actually received or answered it.

## Evaluation behavior

Returned answer records are evaluated through the existing #1774/#1777 contracts.

A round may become:

```text
SETTLED
REGRESSION_PROVING
GAPS_IDENTIFIED
SAFE_HOLD
```

Ten grounded answers may settle the round without comparing answer prose to hard-coded strings.

A truthful buildable miss such as `GAP_RETRIEVAL` becomes a deterministic gap observation and holds advancement to the next novel round.

An `ANSWERED_PARTIAL` result also holds the ladder for repair/replay.

Malformed, missing, wrong-participant or incomplete answer records fail closed.

## Anti-gaming boundary

The first round must not be used as a ten-answer demo.

- Question payloads contain no expected answer text.
- Passing requires the existing evidence/freshness contracts.
- A fluent answer is not sufficient when evidence is required.
- A genuine unknown remains visible.
- A buildable gap feeds the existing canonical goal candidates.
- The next round must later use materially different questions under the novelty contract.

## Focused proof

```bash
node --test shared/agents/stephanosConversationalCapabilityLadderV1.test.mjs shared/agents/stephanosSharedWorkspaceConversationAdapterV1.test.mjs shared/agents/stephanosInitialTenQuestionRoundV1.test.mjs
```

The new suite covers:

- exact ten canonical classes;
- materially different question content;
- ten-message Shared Workspace fan-out;
- no embedded answer text or mutation authority;
- settlement from independently grounded answers;
- buildable-gap propagation;
- partial-answer repair/replay hold;
- missing-answer safe hold;
- exact timestamp validation.

## Truth boundary

This slice does not claim:

- ChatGPT has sent the packet through the live Shared Workspace transport;
- Stephanos has received it;
- Stephanos has produced ten real answers;
- the first capability round has passed;
- peer-level intelligence acceptance has passed.

Those require a later live transport/correlation proving action using the existing #1506/#1290 route and real Stephanos responses.

## Next product action

Once #1774/#1777/this slice are accepted, the next bounded proving action is:

```text
LIVE_CHATGPT_TO_STEPHANOS_ROUND_001
```

The system should submit these ten records through the canonical Shared Workspace path, collect ten real correlated Stephanos answers, classify every result, and feed any buildable miss into the existing question-gap flywheel without Stephan acting as courier.
