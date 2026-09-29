# Stephanos Memory Correction and Forget Propagation V1

## Outcome

This contract closes a specific governance gap in #1645: an authority-confirmed correction or forget action must stop stale derived copies from influencing later reasoning. The contract does not perform the correction, forget, delete, cache invalidation, tombstone write or rebuild. It deterministically creates the propagation plan that those existing governed owners must satisfy.

It therefore complements the existing durable-memory write/delete authority rather than creating a second memory store or mutation path.

## Inputs

The plan accepts one bounded authority-bearing change receipt and a bounded inventory of derived projections. Supported change operations are:

- `CORRECT` — an old canonical content digest is superseded by a new canonical digest;
- `FORGET` — old canonical content must cease future influence and no replacement content is supplied.

Supported derived families cover retrieval indexes, context-pack caches, relationship and semantic projections, provider-specific summary caches, local mirrors, archive indexes, and lesson/method candidates.

## Correction semantics

A derivative that still references the old digest becomes `REBUILD_REQUIRED`. A derivative already bound to the corrected digest is `CURRENT_OK`. A derivative bound to neither digest becomes `HOLD_CONFLICT`; the contract never guesses which version is true.

Only an authority-confirmed `SHARED_AUTHORITY` or `OPERATOR_CONFIRMED` receipt may drive these classifications. Local mirrors, pending intent and model inference cannot promote themselves through a correction path.

## Forget semantics

A derivative sourced from the forgotten record and exact forgotten digest becomes `INVALIDATE_REQUIRED` while it can still influence future reasoning. Already invalidated/non-influential derivatives need no duplicate action. Digest mismatch becomes `HOLD_CONFLICT` rather than allowing a broad unsafe purge.

An authority-confirmed forget also yields a minimal audit tombstone candidate containing only record/change identity, timestamp, prior digest, authority and bounded evidence references. It contains no payload or remembered content and explicitly says `contentRetained=false` and `futureInfluenceAllowed=false`.

The tombstone is a plan artifact, not a write. A later owner must create any durable tombstone through the existing governed memory authority path.

## Hostile-input boundary

Inputs must be exact plain data records and dense standard arrays. Accessors, symbols, sparse/custom arrays, unexpected fields, malformed digests/dates, duplicate derivative identities, unsupported derivative types and oversized packets fail closed. Plans are deterministically sorted and SHA-256 digest-bound.

## Authority boundary

All authority remains false for source mutation, memory writes, correction/forget execution, delete, tombstone writes, derivative mutation, cache invalidation execution, archive mutation, provider-prompt use, commands, approvals, merge, deployment and runtime mutation.

Live acceptance still requires an authority-confirmed correction and forget cycle to propagate across Shared Workspace, local mirrors, retrieval indexes, relationship projections and provider caches with proof that the old content no longer influences future answers.
