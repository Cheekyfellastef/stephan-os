# Privacy Tile Summary V1

Primary product goal: #1564. Programme umbrella: #1776. Parent evidence gate: #1792.

## Purpose

This M2 slice turns the already-governed Privacy M1 evidence projection into the compact **collapsed-tile summary model** required by #1564.

It is deliberately a read-only presenter contract. It does not render or repaint the landing page, collect privacy evidence, inspect a provider/device/account, observe network traffic, send a rights request, change a privacy setting, create a monitor, publish a notification or introduce another privacy ledger.

The flow is:

```text
Privacy M1 normalized evidence input
  -> canonical M1 evidence projection
  -> bounded collapsed-tile selection
  -> no raw record republication
  -> zero-authority summary model
```

## Reuse boundary

M2 calls `buildPrivacyTileEvidenceProjectionV1` directly. M1 remains the sole authority for:

- input shape and bounds;
- event/domain/source compatibility;
- trusted evaluation clock;
- future/impossible chronology rejection;
- current versus stale evidence;
- consent derivation;
- rights-request deadline state;
- confirmed/inferred/unknown/stale separation;
- posture derivation;
- safe evidence references;
- sensitive-content rejection;
- next-review priority.

M2 does not duplicate or weaken those rules.

## Collapsed summary contract

The summary exposes only bounded fields suitable for a future card renderer:

```text
privacyPosture
freshness
confirmedCollectionSubjectCount
confirmedInterventionSubjectCount
confirmedHumanAccessSubjectCount
consentUnprovenCount
openRightsRequestCount
overdueRightsRequestCount
nearestRightsDeadlineUtc
latestMaterialEvent
unknownOrUnobservableCount
staleEvidenceCount
evidenceCoverage
nextReviewAction
limitations
unknowns
```

It also carries the exact source projection/snapshot identity and evaluation timestamp so a future UI can explain which M1 truth produced the card.

## Subject counts, not activity claims

M2 intentionally names collection/intervention values as **subject counts**.

A current `CONFIRMED_COLLECTION` record proves the bounded event represented by M1. It does not by itself prove that collection is continuously active at display time. M2 therefore:

- counts only current, non-synthetic, M1-confirmed records;
- deduplicates by sanitized `subjectRef`;
- does not label the result `activeCollectors`;
- excludes inferred, unknown and stale records.

The same rule is used for confirmed intervention and confirmed human-access subject counts.

## No event inflation

Repeated current observations concerning the same subject do not inflate the collapsed subject count. This prevents a busy evidence stream from looking like many independent collectors.

Event history remains owned by M1; M2 is a compact summary only.

## Rights and consent truth

M2 copies only M1's already-derived aggregate rights/consent state:

- unproven consent count;
- open rights-request count;
- overdue count;
- nearest deadline;
- M1's deterministic next-review action.

An overdue request may make `REVIEW_OVERDUE_RIGHTS_REQUEST` the recommended review action, but M2 cannot send, submit, escalate or assert a legal outcome.

## Latest material event

The collapsed summary retains only:

```text
domain
classification
truthBucket
summary
observedAtUtc
```

It intentionally drops record IDs and evidence references from the public collapsed model. Detailed provenance remains in M1 and can be inspected through a later explicitly governed expanded view.

## No raw evidence republication

M2 does not expose the M1 `records` array and does not copy record evidence references. This keeps the collapsed card small and reduces the chance that detailed evidence identifiers become ambient UI data.

The summary exposes `sourceProjectionId` and `sourceSnapshotId` as the lineage bridge back to M1.

## States

```text
SAFE_HOLD
  M2 input is malformed, the clock is invalid, or M1 rejects the evidence packet.

SUMMARY_EVIDENCE_INCOMPLETE
  M1 is valid but its posture/readiness remains evidence-incomplete.

SUMMARY_READY
  M1 has a valid read-only posture projection that can be represented compactly.
```

`SUMMARY_READY` is a source-model state only. It is not a rendered-UI, operator-acceptance or live-evidence claim.

## Authority boundary

Every output keeps these authorities false:

```text
sourceMutationAllowed=false
commandExecutionAllowed=false
accountAccessAllowed=false
deviceMutationAllowed=false
networkInterceptionAllowed=false
credentialAccessAllowed=false
legalSubmissionAllowed=false
deletionAllowed=false
uiMutationAllowed=false
notificationAllowed=false
mergeAllowed=false
deploymentAllowed=false
spendAllowed=false
runtimeMutationAllowed=false
```

The recommendation is review guidance only and cannot become an executable command.

## Focused proof

```bash
node --check shared/agents/privacyTileSummaryV1.mjs
node --test shared/agents/privacyTileEvidenceProjectionV1.test.mjs shared/agents/privacyTileSummaryV1.test.mjs
```

The M2 regression estate proves:

- compact collapsed-tile selection from valid M1 truth;
- current confirmed subject counts remain separate from inference/unknown/stale truth;
- repeated events for one subject do not inflate the count;
- stale collection evidence cannot appear current;
- overdue rights state is projected read-only;
- materially future M1 evidence fails closed;
- outer accessors are not invoked;
- raw records/evidence refs are not republished;
- deterministic summary identity;
- all action authority remains false.

## Stacked delivery boundary

This slice is intentionally stacked on existing M1 PR #1792 while that root remains open. Its net child estate is exactly three additive M2 files.

It must remain draft while the parent is unmerged and must not be represented as landing-page completion. After M1 is admitted, the same child branch can be preservation-converged onto canonical main and re-proven through the repository's ordinary exact-head assurance path.

## Truth boundary

This source slice uses synthetic tests or already-governed M1 evidence only. It does not claim a real provider, account, television, device, network contact, consent record, export or rights request has been observed. It does not render the Privacy Tile, connect Gmail/email, inspect a device, intercept traffic, submit a legal request, mutate data, deploy source or change runtime state.
