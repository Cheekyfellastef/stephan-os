# Stephanos Memory Retention and Capacity Policy V1

## Outcome

This contract advances #1645 with a deterministic, provider-neutral, read-only retention and capacity evaluation over already-governed memory records.

It does not compact, archive, delete, forget, rewrite or evict records. It produces bounded maintenance candidates and capacity-pressure truth for a separate authority-bearing execution path.

## Policy decisions

Each governed record receives exactly one planning action:

```text
RETAIN_HOT
RETAIN_TOMBSTONE
COMPACTION_CANDIDATE
ARCHIVE_CANDIDATE
EXPIRY_CANDIDATE
SAFE_HOLD
```

No action is an execution receipt.

## Cognitive-class defaults

- Working/session memory may become an expiry candidate after its bounded active window closes.
- Active/current/open/blocked records remain hot.
- Old repetitive telemetry may become a compaction candidate.
- Cold superseded projections may become searchable archive candidates rather than deletion candidates.
- Cold evidence may become an archive candidate.
- Tombstones remain retained so correction/forget semantics cannot be resurrected by stale replicas.
- Unknown authority, lifecycle or retention class produces `SAFE_HOLD` rather than destructive maintenance.

## Protected evidence

These reasons structurally prevent compaction/expiry suggestions:

```text
OPERATOR_DECISION
OPERATOR_APPROVAL
DURABLE_CORRECTION
LEGAL_PRIVACY_ACTION
AUTHORITY_EVIDENCE
AUDIT_REQUIRED
```

This preserves #1645's rule that compaction cannot erase decisions, approvals, durable corrections, legal/privacy actions or evidence needed to explain current authority.

## Capacity pressure

The evaluator receives the canonical store's configured capacity limit rather than inventing backend capacity.

It reports deterministic pressure bands:

```text
NORMAL   < 70%
NOTICE   >= 70%
HIGH     >= 85%
CRITICAL >= 95%
EXCEEDED >= 100%
```

Pressure never grants eviction authority. Even when the observed set exceeds the supplied capacity limit, protected and active records remain protected and all actual mutation rights stay false.

## Conservative source-controlled horizons

V1 defines bounded planning horizons only:

```text
working/session maximum age: 8 hours
repetitive telemetry compaction candidacy: 7 days cold
superseded projection archive candidacy: 30 days cold
cold evidence archive candidacy: 90 days cold
```

These horizons decide only whether a record may enter a maintenance candidate queue. They do not execute storage changes or override stronger domain-specific retention law.

## Hostile input boundary

The evaluator requires exact closed-world data records and dense ordinary arrays. It rejects accessors, symbols, custom prototypes, sparse arrays, malformed timestamps, unsafe references, duplicate identities, invalid byte counts and oversized payloads before using authority-bearing fields.

## Authority boundary

All of the following remain false:

```text
sourceMutationAllowed
memoryWriteAllowed
deleteAllowed
forgetAllowed
compactionExecutionAllowed
archiveExecutionAllowed
tombstoneMutationAllowed
retentionOverrideAllowed
capacityEvictionAllowed
commandExecutionAllowed
approvalAllowed
mergeAllowed
deploymentAllowed
runtimeMutationAllowed
```

## Relationship to other #1645 lanes

Working, Episodic, Semantic, Procedural, Prospective and Reflective memory define cognitive views. Retrieval Packs select relevant context. This policy consumes only metadata needed to evaluate retention and pressure; it does not own those memories or retrieval indexes.

A later authority-bearing executor may consume approved maintenance candidates and must separately prove exact archive/compaction/tombstone semantics, restoreability, searchability and cross-device convergence.

## Focused proof

The deterministic suite covers active retention, expired working context, telemetry compaction candidacy, superseded archival candidacy, tombstone preservation, protected evidence, unknown-state safe hold, capacity pressure/exceeded behavior, hostile inputs, deterministic identity and zero mutation authority.

## Truth boundary

This source-only slice does not prove that any live store is within capacity, that any record has been archived or compacted, or that deletion/forget has propagated. It introduces no second memory store and performs no runtime mutation.
