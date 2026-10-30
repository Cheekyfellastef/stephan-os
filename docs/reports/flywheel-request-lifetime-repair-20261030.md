# Flywheel request lifetime repair

PR #3324 — Fix Flywheel request lifetimes and frontend reservation admission

Base: `dba816ae9008fce453b6eca2679649f63201b432`.
Original repair owner/branch: `flywheel-pr-3300`, `fix/flywheel-shared-read-pressure-v2`.

## Structural review and demonstrated defect

This is the third related read-pressure repair. Before editing, the owner audited the complete request lifetime instead of adding another concurrency limit. The durable pre-edit review is `FLYWHEEL-STRUCTURAL-REVIEW-20261030.md`, SHA256 `f59fdc1b9c284c230ea036c00d4d30dc4a9d2f27bef8a35da23e0c9871a16f2b`, retained in the original chat's artifact directory. Commissioning incorporated its evidence into `proof/commissioning-research-postboot-frontier-20261030.json`.

Eight disconnected real HTTP clients still reached Express JSON serialization on the base source. Cancellation stopped the browser waiter but did not stop caller-owned cloning, projection and serialization. Flywheel also depended on an entire normalized bridge object, so equivalent object replacements restarted the effect; effect cleanup suppressed rendering without aborting transport. Parent hydration timeout could leave its transport running while direct fallback began.

The reusable invariant is: **a consumer owns its waiting, projection and response lifetime; a shared operation owns its registry entry and I/O slot until actual settlement.** Leaving consumers must not continue expensive caller-owned work, retire shared pending work, release unfinished I/O slots, or cancel another consumer. Late failure must still be observed.

## Correction and limits

- Flywheel uses canonical primitive bridge dependencies and aborts on effect cleanup.
- Shared backend transport removes external signal listeners and preserves caller cancellation instead of reporting it as a backend timeout.
- Same-origin parent hydration cancellation requires the exact admitted request and source window, including a frame that has since unmounted. Disposal cancels all owned requests. Timeout requests cancellation before fallback; asynchronous message delivery means zero transient overlap is not claimed.
- HTTP response closure propagates cancellation through hydration and dashboard services. Cancelled readers skip projection/serialization and do not become generic unavailable/503 payloads.
- Shared directory scans remain registered and their 16 global I/O slots remain occupied until actual completion. Freshness checks, independent objects, validation and full history remain intact.
- Filesystem reads already in progress and optional readers that do not consume a signal are not forcibly stopped. Their actual settlement remains observed. The change does not establish the cause of the production 4 GB memory crash or prove live reliability.

The helper's existing source closure includes the shared dashboard feed and backend client. Its manifest adds the new pure cancellation module. This requires independently reviewed exact-source bundle commissioning; no installer, custody, authority or restart policy is changed.

## Proof

The focused Node suite passed **155/155**, covering full-history reads, current-state filtering, the global budget, shared flight lifetime, independent cancellations, late rejection, listener cleanup, optional upstream deadlines, hydration provenance, real HTTP disconnects, parent source/origin checks and shared transport.

The new real HTTP regression was also run with the four changed server/feed modules loaded from the immutable base via `git show`: it failed specifically with **8 abandoned serializations instead of 0**. The repaired source passes the same HTTP scenario and a subsequent live consumer receives all 256 fixture records.

The existing fixed-runtime installer/closure suite passed **4/4** after adding the utility. Parse-only closure proof covers 254 manifest members, with no missing or bare imports; no repository module is evaluated by that closure proof.

Actual Edge/React browser proof on an isolated loopback Vite fixture passed all eight checks: initial single request; twenty equivalent bridge updates without restart; changed route context abort/replacement; current result rendering; old result ignored; remount single request; unmount abort; and no poll restart after 15.5 seconds. Three fetch calls were observed and both abandoned calls were aborted. The fixture uses the real panel, effects and shared client, with a synthetic store and deliberately held fetch promises. It does not contact production or claim backend health. Local loopback routing remains canonical, so a changed bridge context in this fixture tests effect replacement, not a change of network destination.

To reproduce browser proof with existing UI dependencies installed:

```text
node stephanos-ui/node_modules/vite/bin/vite.js --config tests/fixtures/flywheel-cancellation/vite.config.mjs
```

Open `http://127.0.0.1:5184/`, click **Run lifecycle checks**, and wait for **PASS**. The retained screenshot is `flywheel-3324-browser-proof.png` in the original chat's artifact directory. The fixture is test-only and is not part of the deployed UI.

## Risk and completion boundary

Ordinary request-lifetime logic needs independent exact-head review. The parent message boundary and protected helper closure additionally need security/specialist coverage. Source publication does not grant merge or runtime authority. Production acceptance still requires the native owner to commission the approved exact source, prove maintenance custody, and observe repeated Flywheel/Control Tower reads without timeouts or memory failure. The programme remains incomplete until those outcomes are real.

## Original-owner admission correction included

The final candidate also preserves the exact original commit `cf35b4df9af18b6907ca10e043ce8cff53aedf24` from PR #3323 — Goal #2961: preserve frontend boot reservations outside dashboard authority. The original implementing owner supplied explicit artifact consent, recorded at `proof/goal-2961-pr-3323-original-owner-source-consent.json`; the recipient independently claimed fresh canonical lease `flywheel-pr-3324-source-20261030-v2` against published cancellation head `223311d1d7d37534ef04ece17e607a2905b98e7d`. Source consent does not transfer execution, review, merge or runtime authority.

The existing specialized-status registry now recognizes only the producer's anchored `frontend-boot-attempt-<64 hex>.json` namespace. It remains outside generic dashboard authority. The immutable reservation, exclusive-create behavior and refusal after an uncertain attempt remain unchanged. Unknown adjacent filenames still fail validation. See the original owner's `docs/architecture/frontend-boot-reservation-dashboard-boundary-v1.md`.

An ordinary merge preserves both source parents. The sole conflict was adjacent added dashboard tests: both sides were retained. The donor production, architecture and registry-test contents match their exact original blobs (`7aca21211486f6a29cfa56e2b4d3b1c3c68a1333`, `948b9c0e381c5f9df33ed57cc6b90bcecf25cef2`, `69cbd816645e8c61ebe290feca29a8182d4efd13`). The donor dashboard regression is verbatim; removing it and its import reproduces the prior cancellation test file exactly. Original patch SHA256 is `7299f57aac751989597640ea8e26428e4b4fcd0c1492e5be08e150b070fa3f3f`.

Combined proof: **163/163** feed, cancellation, transport, hydration, registry and closure tests; **89/89** frontend/autostart/mailbox tests; import and diff guards passed. Browser-facing bytes are unchanged from the eight-check browser proof. The prior independent reviews do not transfer: final combined head/base needs fresh independent security/specialist review and protected integration. PR #3323 and its branch remain preserved until independent inclusion proof; no live reservation is deleted or rewritten.
