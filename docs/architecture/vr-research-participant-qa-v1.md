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

A grounded answer must come from a fresh `stephanos.vr-research.workspace.v1` projection with a canonical projection ID and a proof attestation bound to the exact projection hash.

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

## Reconstructed-record boundary

Before any route predicate, source lookup, fact lookup, proof binding or Workspace serialization reads caller-owned projection data, the complete value is converted into one recursively frozen data-only snapshot.

The boundary rejects, without invoking getters:

- accessor-backed object fields or array indexes;
- sparse arrays and arrays with hidden/custom properties;
- symbol-keyed values;
- custom prototypes;
- cycles;
- revoked or throwing proxies;
- prototype-shaping keys such as `__proto__`, `prototype` and `constructor`;
- non-finite values;
- over-deep, over-wide or over-large structures.

Canonical objects are constructed with null prototypes and explicit own data properties. This prevents JSON-deserialized `__proto__` records from changing object prototypes or leaking inherited route fields.

Malformed or incompatible reconstructed projections return a bounded `GAP_FRESHNESS`/`UNKNOWN` answer with no facts. They never throw through the public Q&A boundary and never become grounded evidence.

## Proof attestation boundary

A syntactically safe proof path is not proof.

Every projection or Workspace proof must be checked by the supplied trusted verifier against an exact binding:

```text
projection proof:
  schemaVersion
  projectionId
  projectionHash

Workspace answer proof:
  schemaVersion
  questionId
  answerId
  answerHash
```

Verifier output is itself canonicalized through the same descriptor-safe data-only boundary. An accepted attestation must contain exactly the expected own enumerable data fields:

```text
verified=true
proofRef=<exact requested ref>
<every exact binding field>
```

Inherited fields, accessor-backed fields, extra fields, missing fields, booleans without a binding, replayed hashes and verifier exceptions fail closed. Getter-backed attestations are rejected with zero getter invocations.

A grounded answer cannot borrow an unrelated proof reference at Workspace publication time. The answer receipt remains bound to the exact normalized request and answer content.

## Fact and message sanitization

Only a bounded VR fact allowlist may leave the adapter. Caller-added credentials, arbitrary authority fields and nested object payloads are removed from direct answers and Shared Workspace serialization.

Request and answer extras may be present in decoded caller input, but they are never serialized into the canonical conversation body. Invalid accessor- or proxy-backed request/answer records fail closed rather than being partially read.

## Epistemic states

Answers use explicit states such as:

```text
KNOWN_FROM_CANONICAL_STATE
PROPOSED
UNKNOWN
STALE
```

Grounded answers return only verified projection proof references.

Missing knowledge with a fresh compatible projection returns a buildable `GAP_KNOWLEDGE`.

A stale, malformed, future-dated or incompatible projection returns:

```text
answerVerdict = GAP_FRESHNESS
epistemicState = STALE | UNKNOWN
```

and cannot be promoted into a grounded answer.

## Trusted answer-time boundary

The public Q&A boundary converts the caller evaluation clock to one ECMAScript-Date-range-safe canonical instant before freshness evaluation or answer serialization. Non-finite and out-of-range `nowMs` values cannot reach `Date#toISOString()` and therefore cannot throw through the adapter.

`answeredAtUtc` is accepted only when it is a canonical ISO timestamp representing that exact trusted evaluation instant. Invalid, noncanonical, inconsistent or accessor-backed values are ignored in favour of the trusted canonical evaluation timestamp.

The same trusted instant drives freshness and the answer timestamp, preventing caller-controlled clock disagreement.

## Timestamp repair and convergence proof

The repaired product tree was executed through the existing GitHub Actions runner before temporary repair machinery was removed. The bounded three-suite command completed with:

```text
node --check shared/agents/vrResearchParticipantQaV1.mjs  PASS
node --test shared/agents/vrResearchWorkspaceProjectionV1.test.mjs shared/agents/vrResearchAgentV1.test.mjs shared/agents/vrResearchParticipantQaV1.test.mjs
49 tests
49 pass
0 fail
git diff HEAD --check  PASS
```

The regressions explicitly cover `Number.MAX_VALUE`, `Infinity`, `-Infinity`, `NaN`, invalid/noncanonical/inconsistent `answeredAtUtc`, deterministic canonical timestamps and accessor-backed timestamp inputs with zero getter calls.

The exact repaired product blobs were then preservation-converged onto canonical `main` `e42dc932196eeffce37ed0af3e5bc367bb37212e`. The same `node --check`, 49-test three-suite command and `git diff origin/main...HEAD --check` all passed after that merge, proving the admitted current-main ancestry did not change or break the VR product estate.

This is source/test/convergence proof only; it grants no merge, deployment, runtime or headset authority.

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

Evidence-free gap messages require a separately verified answer-bound receipt before publication. Fabricated fallback receipt paths are never invented.

## Safety boundaries

The Q&A adapter does not:

- execute a game or downloaded binary;
- inspect arbitrary local files;
- start a Battle Bridge task;
- write canonical VR facts back automatically;
- merge or deploy source;
- grant runtime mutation authority;
- promote a source claim into headset proof;
- bypass provenance or licence boundaries;
- trust inherited/accessor/proxy-backed evidence;
- manufacture proof receipts.

## Focused proof

```bash
node --test shared/agents/vrResearchWorkspaceProjectionV1.test.mjs shared/agents/vrResearchAgentV1.test.mjs shared/agents/vrResearchParticipantQaV1.test.mjs
```

The complete focused estate proves:

- all ten bounded question classes use one canonical projection;
- source and licence boundaries remain visible;
- authoring/public/runtime evidence stays separated;
- missing evidence becomes a deduplicatable gap;
- stale or incompatible projection truth cannot pass as grounded;
- projection and answer proofs bind exact normalized content;
- JSON `__proto__`, inherited attestations, accessor attestations, revoked proxies and throwing traps fail closed;
- route-field and fact getters are never invoked;
- request, answer and nested fact extras are sanitized;
- answer records validate through the existing Shared Workspace contract;
- out-of-role questions are rejected;
- source, command, merge and deployment authority remain false.

Hosted exact-head checks and provider-neutral review remain authoritative for the published branch.

## Truth boundary

This is a faithful source-level Q&A participant adapter. It does not yet claim that ChatGPT or the Stephanos AI Console has delivered a live question through the runtime Shared Workspace and received the answer without operator courier work.

That live transport/cross-surface acceptance remains a later #1723/#1594 gate.
