# Stephanos Shared Workspace Conversation Adapter V1

## Purpose

This slice advances #1308 and the Shared Participant Question and Answer Fabric in #1290 by connecting the existing ten-question capability contract to the existing Shared Workspace `MESSAGE` record.

It does not create another transport, workspace, scheduler, dispatcher, memory store, chatbot, receipt writer or execution authority. The adapter is a codec, evidence and lineage boundary only.

## Parent contract

This child is stacked on the current #1774 ten-question contract. The parent deliberately SAFE_HOLDs later-round novelty until canonical novelty authority exists and SAFE_HOLDs authority/safety boundaries until canonical boundary adjudication exists. This adapter preserves those holds rather than reintroducing caller-controlled settlement.

## Message mapping

A valid initial ten-question round may become exactly ten correlated Shared Workspace question messages. A valid answer may become one correlated answer message. Ask/answer participant, round, question and recipient identities remain explicit.

Each conversation record has one exact closed-world shape. Unknown top-level fields, including authority aliases, are rejected. The JSON conversation body also has one exact shape:

```text
schemaVersion
subtype
payload
```

Extra command/authority/body fields are rejected rather than ignored.

## Proof boundary

The adapter never invents `receipts/<messageId>` or any other proof path. Shared Workspace messages require at least one real caller-supplied safe proof reference. If no proof reference exists, publication construction fails closed with `proofRefs-required-from-caller`.

The adapter does not write, verify or manufacture the referenced proof. Proof creation remains owned by existing evidence machinery.

## Freshness boundary

Shared Workspace message freshness uses the canonical one-hour `DEFAULT_STALE_AFTER_MS` policy from the existing workspace store. Callers may provide the evaluation clock for deterministic proof but cannot widen the stale duration through this adapter.

A stale answer message cannot settle a capability round even if its embedded answer claims `FRESH`. Future-dated workspace records also fail closed.

## Recipient and lineage boundary

Standalone answer decode requires an expected recipient participant identity and verifies it against the record. The round evaluator supplies the round asker as that expected recipient automatically.

The adapter also binds:

- question record participant to the question asker;
- question record recipient to the question target;
- answer record participant to the answer responder;
- round correlation to the embedded round ID;
- subject identity to the embedded question ID.

## Data-only boundary

Conversation records are descriptor-snapshotted before Shared Workspace validation or body parsing. Exact own enumerable data fields are required. Record-level accessors, symbols, custom prototypes, sparse/accessor-bearing proof arrays and uninspectable shapes fail closed without executing caller getters.

## Authority boundary

Every message retains:

```text
sourceMutationAllowed=false
commandExecutionAllowed=false
approvalAllowed=false
mergeAllowed=false
deploymentAllowed=false
```

A conversation question is never an executable command, approval or merge packet.

## Parent SAFE_HOLD preservation

The adapter sends only `{ round, answers }` into the current capability evaluator. Caller-supplied adjudication-looking arrays, evidence registries or callbacks cannot restore the superseded self-certifying boundary path. Boundary answers remain `UNADJUDICATED_BOUNDARY` and later rounds remain blocked until their canonical proof authorities exist.

## Focused proof

```bash
node --test shared/agents/stephanosConversationalCapabilityLadderV1.test.mjs shared/agents/stephanosSharedWorkspaceConversationAdapterV1.test.mjs
```

The child suite covers real proof-ref requirements, no synthetic receipts, exact question/answer mapping, conservative later-round hold, standalone recipient binding, stale/future rejection, grounded settlement, buildable gaps, boundary SAFE_HOLD, unknown record/body fields, authority smuggling, accessor-bearing records/proof arrays and malformed bodies.

## Truth boundary

This source adapter does not claim that ChatGPT or Stephanos has executed a live ten-question exchange through the Shared Workspace runtime. It grants no source mutation, command execution, merge, deployment or runtime authority. Live transport and operator-visible acceptance remain later #1308/#1290 gates.
