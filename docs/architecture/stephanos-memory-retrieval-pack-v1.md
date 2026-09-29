# Stephanos Memory Retrieval Pack V1

## Purpose

Advance #1645 without introducing another memory store. This slice adds one deterministic, provider-neutral, read-only context-pack builder over already-classified Stephanos memory evidence.

The contract exists to answer a narrow question: **which bounded memory records should be supplied to a specific Stephanos reasoning context, and why?** Retrieval is selection, not authority.

## Supported pack kinds

- `CONVERSATIONAL_CONTINUITY_PACK`
- `OPERATOR_RELATIONSHIP_PACK`
- `PROJECT_SELF_MODEL_PACK`
- `ACTIVE_MISSION_PACK`
- `PROCEDURAL_METHOD_PACK`
- `PROSPECTIVE_OPEN_LOOPS_PACK`
- `REFLECTIVE_LESSONS_PACK`

## Truth and authority boundary

The builder imports the canonical authority classes from `shared/runtime/stephanosMemoryAdequacy.mjs` and never upgrades missing or malformed authority/freshness claims. Unknown authority remains `UNKNOWN`; unknown freshness remains `UNKNOWN`.

Memory timestamps are bounded against a trusted evaluation instant. Callers may provide exact `asOfUtc` for deterministic evaluation; otherwise the builder uses the current runtime clock. Observed or updated timestamps more than five minutes ahead of that instant fail closed, so impossible future memory cannot masquerade as `FRESH`/`CURRENT` evidence or win recency ordering.

The output denies every authority-bearing operation:

```text
sourceMutationAllowed=false
memoryWriteAllowed=false
durablePromotionAllowed=false
memoryDeleteAllowed=false
memoryCorrectionAllowed=false
sharedAuthorityClaimAllowed=false
commandExecutionAllowed=false
approvalAllowed=false
mergeAllowed=false
deploymentAllowed=false
runtimeMutationAllowed=false
```

A retrieval pack may inform a later authorised reasoning step. It cannot establish a durable memory fact, correct or forget memory, execute a command, approve work, merge source, deploy or mutate runtime state.

## Bounded record projection

Input records are reduced to an allowlisted projection containing bounded identity, namespace/type/source metadata, summary text, tags and relationship selectors, timestamps, authority/freshness/current state, safe source/proof references and optional goal/PR/component/participant links.

Unsupported fields are omitted and reported. Raw payloads, credentials, secrets, sessions, unrestricted logs, local filesystem paths and psychological-profile material are not projected.

Unsafe proof/source references fail closed.

## Selection and ordering

Selectors may constrain namespace, type, tag, goal, PR, component, person/participant, source and timestamp range. Every selected record includes deterministic selection reasons.

Eligible records are ordered by:

1. stronger canonical authority;
2. fresher evidence;
3. current state before unknown/historical state;
4. most recent update;
5. stable record identity.

Superseded records are excluded by default. A caller may include historical records explicitly, but they remain labelled `SUPERSEDED` and never become current truth.

## Contradictions

The pack never silently resolves conflicting evidence. Records explicitly marked `CONFLICTING`, or materially different current records for the same bounded identity, appear in `unresolvedContradictions` and produce verdict `CONFLICTING_EVIDENCE`.

## Budget

The builder enforces an explicit record-count and serialized-byte budget. Defaults are deliberately small and absolute maxima remain bounded. A pack that cannot contain every eligible record returns `BOUNDED_PARTIAL` with `budget.truncated=true` rather than dumping the store.

## Operator relationship boundary

`OPERATOR_RELATIONSHIP_PACK` accepts only:

- explicit operator teaching;
- explicit operator correction;
- clearly labelled low-authority interaction inference.

A record labelled `LOW_AUTHORITY_INTERACTION_INFERENCE` must also carry the canonical `INFERRED` authority class. Any attempt to pair that speculative evidence class with `SHARED_AUTHORITY` or another stronger authority fails closed instead of allowing relationship inference to outrank operator-grounded truth.

Low-authority inference containing mood diagnosis, hidden-motivation claims, psychological profiling or intimate-fact inference is omitted. The pack is not a hidden emotional dossier.

## Focused proof

```bash
node --test shared/agents/stephanosMemoryRetrievalPackV1.test.mjs
```

The focused suite covers unsupported pack kinds, invalid/oversized inputs, unsafe refs, unsupported/raw-field stripping, unknown authority/freshness preservation, future-time rejection with deterministic clock-skew boundaries, authority/freshness ordering, speculative relationship-authority inflation rejection, superseded-state handling, contradiction preservation, deterministic budget truncation, relationship-inference rejection, selector reasons, provider-neutral output and zero authority.

## What this slice does not prove

This source slice does not prove:

- live Shared Workspace memory retrieval;
- durable memory promotion, correction or deletion;
- cross-device convergence;
- provider prompt use;
- runtime installation;
- operator-visible memory inspection;
- retention/compaction/archive execution;
- provider-swap continuity.

Those remain later #1645 acceptance stages.
