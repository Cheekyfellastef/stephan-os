# Software Engineering Source Registry and Technique Extraction V1

Status: source-built candidate under #1958 / #1956

## Purpose

Stephanos should use the best current engineering evidence without turning search ranking, random public code or model recollection into canonical truth. This contract validates already-retrieved source evidence and creates bounded technique candidates with explicit provenance, freshness, licence and reuse routes.

Discovery, browsing and research orchestration remain owned by #1902 and the generic #1596 framework. The registry is not a crawler, code mirror, scheduler or second research database.

## Evidence classes

The source record distinguishes official documentation and specifications, canonical upstream repositories, release/security notices, licence-compatible reference implementations, verified internal source, authorised local evidence, secondary reference-only material and rejected/unsafe sources.

Every record identifies:

- canonical location and publisher;
- exact revision/version when applicable;
- retrieval time and freshness requirement;
- licence and rights evidence;
- explicit reuse route;
- applicable languages, platforms and components;
- evidence plane and supported claims;
- conflicts, availability, refresh owner and extraction owner;
- freshness, status and zero authority.

## Reuse routes

```text
DIRECT_REUSE_ALLOWED
REUSE_WITH_ATTRIBUTION_OR_CONDITIONS
ADAPTATION_ALLOWED
ANALYSIS_ONLY_REIMPLEMENT_ORIGINAL
REFERENCE_ONLY
RESEARCH_FURTHER
REJECT_RIGHTS_BOUNDARY
REJECT_STALE_OR_INCOMPATIBLE
```

Direct or adaptable reuse requires an explicit non-unknown licence and rights evidence. Reference-only sources may inform principles but cannot provide direct code implementation context. Rejected sources cannot create technique candidates.

## Current-truth selection

`selectPreferredSoftwareEngineeringSourceV1` considers only sources supporting the exact claim and preserves these boundaries:

- conflicting primary evidence returns an explicit conflict hold;
- stale material cannot win current-source selection;
- fresh primary evidence outranks secondary reference material;
- no eligible source returns `NO_FRESH_SOURCE` rather than invented truth.

## Technique candidates

A technique candidate preserves source record identity, revision/version, evidence plane, licence, evidence references, applicable domains, failure modes and the source's reuse route. It grants no research dispatch, source mutation, approval, merge, deployment, runtime, account, spending, provider-qualification or arbitrary-command authority.

Candidates remain candidates until existing #1607 Method Library and proof governance accepts them.

## Fail-closed rules

The source validator rejects malformed source identity/location, missing version for versioned sources, missing licence for direct/adaptable reuse, inconsistent status, unavailable or stale material presented as admitted current implementation evidence, unsafe sources presented as usable, duplicate evidence and any authority widening.

## Intended composition

```text
#1902 direct or delegated research
  -> provider-neutral evidence packet
  -> Software Engineering Source Registry V1
  -> bounded technique candidate
  -> #1607 Method Library or #1957 repository pack
  -> qualified implementation and exact proof
```

No source record itself grants permission to execute, build, install or merge anything.
