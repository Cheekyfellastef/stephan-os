# Ignition source adoption and activation ownership

Structural review, 4 November 2026: the measured retained update range d729d17c65298e4c27305bca243848585a5bc8aa..40a77f8e537ad73daf0b96977faf5b1a572e95ba contains 18 unclassified paths. Canonical desktop Ignition runs the sync-and-refresh pre-hook; the host update entry can reach the later runtime supervisor without exercising that hook. Therefore a successful direct recovery cannot prove desktop Ignition acceptance.

The shared classifier must distinguish source adoption from actual binary or process activation. Existing on-demand VR launch/report/recorder scripts load source on their next owner-controlled invocation and belong to the existing natural-reload route. This route must not launch a game, interrupt a recording, install a layer, or claim an already-running recorder loaded new bytes. Native C#/C++ and layer-manifest source require their existing explicit build/install/qualification owners; source sync must not compile, sign, install, commission, or declare native activation. The installer script itself is attended, not an automatic post-sync action.

Correction: exact membership in the existing natural-reload and offline source sets, with no broad directory exemption. Every uninspected neighbour, unsafe path and mixed unknown delta stays blocked. Current managed backend/UI/worker/mailbox/Commander refresh and exact-head proofs remain independently required. No refresh debt is erased.

Regression contract: the actual 18-path corpus routes; only the natural reload adapter may execute for that isolated corpus; unknown siblings and unsafe paths remain fenced. Native implementation is untouched. Before deployment require independent exact-head review of adoption classification, normal protected merge approval, and an actual successful desktop launcher invocation. Parent core/conveyor and native installation acceptance remain separate.

## Repeated Flywheel rollback: structural extension

The sync executor's existing dirty-source Housekeeper callback selects scripts/battle-bridge-sync-housekeeper-runner.mjs, which calls runIgnitionHousekeep without preservation. That shared housekeeper restores tracked generated dist and removes untracked built assets. The committed metadata at current main is still the May 0f0aa30d build. A subsequent blocked refresh can therefore leave an active server streaming the old AI Core despite a correct surface=flywheel request. This is an executable source path, not attribution of every historical occurrence to a particular person/process.

Preserve generated/runtime state in the sync runner through the existing preserveRuntimeDirt invariant. Independently fence the shared server: reread exact source HEAD and capture metadata plus embedded index identity for each runtime observation; missing/malformed/changed identity is not current. Health must not claim ready, runtime-status must not inherit an old ready record, and stale dist requests must return 503. Serve the already-checked index bytes to avoid a second disk read after qualification. Keep the launcher shell and read-only repair diagnostics reachable. No automatic source, lease, process or install authority is added. Restart/rollback/recovery tests must use isolated fixture snapshots, never downgrade the operator's live dist for testing.

## Current-main advisory entries and bounded observation

After protected main advanced to 46c69ff9498b68437eebf30c18d60d482f1132b5, two exact one-shot review paths became unclassified: scripts/sovereign-high-risk-advisory-launcher-v1.mjs and scripts/sovereign-high-risk-advisory-v1.mjs. They join the existing no-runtime-refresh exact set. Adoption never invokes inference, installs or attests the protected launcher, qualifies specialist review, or grants runtime authority. Unknown neighbours and mixed unknown deltas still fail closed.

The served identity capture must not synchronously spawn unbounded Git for every asset/poll. The server now uses the existing fixed Git execution boundary asynchronously with a 1000ms child timeout and independent completion deadline. Failure returns unknown identity. Concurrent requests share only a capture already in flight; completed identity is never cached. Restart handling stays independent of the pending capture. Before/after exact HEAD reads, metadata/index equality and checked-index serving remain the same invariant. Regressions run a real hung disposable child, concurrent health requests, an accepted fixture-only restart while identity is held, and immediate stale refusal after the previous capture completes.


## Complete-rollout activation review after PR3400

The repeated activation failure required structural review before another path entry. The earlier regression covered 18 observed incident paths and two advisory entries, but omitted a production entry introduced by the repair itself. The actual merged nine-file diff must be the acceptance unit. The live 327-path accumulated refresh debt from d729d17c to 8113cc30 failed on exactly that one runner; no unknown path may be dropped to make an unrelated refresh proceed.

| Merged path | Existing adoption owner |
| --- | --- |
| scripts/battle-bridge-sync-housekeeper-runner.mjs | Natural reload; fixed scheduled sync executor loads a fresh bounded child each cycle |
| scripts/ignite-stephanos-local.mjs | Existing guarded on-demand Ignition invocation; no automatic start requested |
| scripts/serve-stephanos-dist.mjs | Existing UI4173 refresh owner |
| shared/runtime/buildParity.mjs | Existing UI4173 and backend8787 owners |
| shared/agents/postSyncRuntimeRefreshCoordinator.mjs | Existing mailbox and natural-reload owners |
| docs/architecture/ignition-source-activation-routing.md | Documentation, no runtime activation |
| scripts/serve-stephanos-dist.test.mjs | Tests, no runtime activation |
| scripts/served-build-rollback.test.mjs | Tests, no runtime activation |
| shared/agents/postSyncRuntimeRefreshActivationOwners.test.mjs | Tests, no runtime activation |

The fixed sync profile identifies the exact runner, bounds its process, supplies the expected head and preserves runtime dirt. It does not retain the child across sync cycles. Consequently the existing natural-reload owner is sufficient; adding a new runtime target, scheduler, supervisor or broad filename prefix would duplicate ownership. The natural-reload adapter reads canonical HEAD and confirms exact source adoption; it does not execute the runner. The current cycle may have used the earlier child before advancing source; this receipt is not proof that the new child ran, and it grants no permission to force a cycle.

The existing NO_RUNTIME_REFRESH_REQUIRED classification for on-demand Ignition means no automatic refresh is necessary; it is not a claim that Ignition is non-runtime code or installed native authority. Its next invocation remains guarded. The new scheduled sync child is explicitly routed to natural-reload rather than added to that exclusion.

The regression now binds the complete actual nine-file rollout, asserts its UI/backend/mailbox/natural owner set, verifies the runner alone uses only natural reload and is not excluded as no-runtime, rejects uninspected sibling names and mixed unknown changes before any adapter, and rejects stale natural-adoption evidence. Future repairs must check both incident paths and every changed production entry against shared owners. This strengthens rollout closure rather than widening runtime authority.

This source model cannot prove installed runtime, browser behavior, protected native installation, service restart, Core custody recovery, signing, VR launch or worker pickup. Those owners and gates remain separate. A successful mocked adapter test proves orchestration behavior only.

## Control Tower owner-comment rollout

`scripts/control-tower-build-request-v1.mjs` is loaded by the existing GitHub
Actions request job at its exact checkout. Its exact path joins the existing
no-runtime-refresh set; neighboring filenames remain unclassified. This is not
a local submitter and its classification cannot run a request or activate a
native service.

The paired native reader is a static import of
`scripts/control-tower-build-consumer-v1.mjs` inside the long-lived Sovereign
relay. The changed consumer and native-inspector paths already require the
existing Commander watchdog to prove relay source adoption. A new heartbeat,
an Actions artifact, a source-only classification or a healthy Commander HTTP
daemon alone cannot establish that the relay loaded the new reader. The full
rollout path inventory is checked as a unit; accumulated unknown refresh debt
must remain visible and must not be omitted to claim this package is live.
