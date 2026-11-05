# Continuous Goal Conveyor & Fleet Care Seed V1

Owner: [#2972](https://github.com/Cheekyfellastef/stephan-os/issues/2972). This is a **persistent outcome seed**, not a new controller or repair daemon.

## Existing plumbing, exact connections

| Function | Reused canonical source |
| --- | --- |
| High-level seed registration | `shared/project/seedGardenProjectionV1.mjs` |
| Per-cycle seed heartbeat publication | `shared/agents/starfieldVrOutcomeOwnershipSeedV1.mjs` via the existing Flywheel publication cycle |
| Shared Workspace evidence and health projection | `shared/runtime/upliftWorkspaceProjectionV1.mjs` |
| Landing-page Flywheel Seed Canopy | `stephanos-ui/src/components/FlywheelSeedCanopy.jsx` |
| Goal-growth pressure and dedupe | `shared/runtime/seedGrowthWorkV1.mjs` |
| Candidate reconciliation/admission | `stephanos-server/services/flywheelLearningGoalBridgeService.js` and `flywheelCanonicalGoalAdmissionService.js` |
| Physical goal build progression | `shared/agents/goalBuildConveyorV1.mjs` plus exact autonomy/build truth |
| Fleet execution & persistence | #2002 Goal Building Agent; #2593 Core Daemon; #2961 Blocked-Goal Repair Steward; #2519 Sovereign Commander |
| Existing read-only goal journey counters | `stephanos-server/services/sharedWorkspaceDashboardFeedService.js` provides `projection.goalBuildConveyor` |
| GitHub 403 limits | #2954 anti-hammer cooldown; never increase polling to fake health |

The seed links to existing owner issues #2670, #2002, #1622, #2697, #2593, #2961, #1858, #2519 and #2954. Owner links are **not completion evidence**.

## Evidence contract for continual growth

The existing `status/goal-conveyor-fleet-care.json` must carry the normal `stephanos.high-level-flywheel-seed-heartbeat.v1` record, exact issue `#2972`, source path and current timestamp. This proves planting only.

Growth needs **fresh (at most 60 minutes old), typed and proof-referenced Shared Workspace event records**. Dedicated #2972 events or appropriately scoped, typed incidents from existing owner issues feed the same projection. No free-text heuristics:

- `fleet-inventory-verified` → measured worker/controller/agent/daemon estate.
- `fleet-health-verified` → bounded health, heartbeat, lease, capacity and restart probes.
- `goal-select-claim-proven` → actual eligible canonical admission/SELECT/CLAIM.
- `worker-pickup-proven` → **physical** worker pickup, not mere dispatch.
- `goal-build-live-proof` → exact head, CI, guarded merge/deploy and live acceptance.
- `blocked-goal-recovered` → recovered/re-admitted original goal with receipts.
- `fleet-learning-retained` → reusable recorded capability and lesson.
- `conveyor-fleet-continuous-audit` → fresh unattended audit.

Incident types: `goal-conveyor-incident`, `fleet-health-incident`, `goal-build-blocked`, `worker-pickup-failed`, `worker-lease-expired`, `provider-meter-exhausted`, `github-rate-limit-hit`, `core-daemon-stalled`, or scope-qualified `capability-gap`. A canonical `capabilityId`, original owner `relatedIssue`, proof refs and fresh timestamp are needed to generate the same stable `seed-2972:gap:<capabilityId>` work identity. Resolution requires newer proven `goal-build-recovered`, `fleet-recovered` or `blocked-goal-readmitted` referencing `resolvedGapId`.

**Producers must emit these typed proofs from real canonical source events; this seed does not synthesize or fabricate them.** In particular, the existing goal-build conveyor read-only counters are useful visibility but by themselves are not a repair event or proof of a successfully completed goal. If source freshness or the heartbeat is unknown/stale, report UNKNOWN rather than green.

## No new authority

All repair pressure goes through the existing `planSeedGrowthWorkV1` → canonical owner search → admitted goal → actual worker pickup → proof → protected review/merge/deploy → lesson. Continue current 403 cooldown and provider-neutral fallback. A seed card, status heartbeat, GitHub issue, dispatch, source PR, CI, or worker claim alone never means live repair succeeded.

## Acceptance demonstration

1. Confirm the hosted iPad and Battle Bridge render the same seventh (or later) persistent seed card, with owner links and **actual** source freshness.
2. Observe one valid heartbeat, one current measured convoy/fleet receipt and goal journey counts sourced from `projection.goalBuildConveyor`.
3. Induce/observe a real bounded worker pickup failure, prove original owner and stable `#2972` growth pressure; observe existing-goal dedupe, canonical admission, SELECT, CLAIM and physical pickup.
4. Prove guarded material source action, tests/review, protected merge, deployed runtime verification and shared lesson.
5. Observe fresh unattended follow-up audit and prove regression recovery after restart, provider exhaustion or rate limit without requiring ChatGPT.
6. Mark any missing rung **AWAITING LIVE PROOF**. Keep #2972 open until this is evidenced, even if all source checks pass.

This seed uses the Fleet/Goal Building Agent and Core Daemon owners, but does **not** create an additional observer loop, controller, mailbox, scheduler, queue or permission plane.
