# Retained OS custody journal: structural design for Goal #2961

Status: structural design independently accepted at ebe7800d5fbbe69f958f5dbc77bb86de05557b31 (review receipt 6467098875). Implementation candidate remains uninstalled and requires its own exact-head specialist review and native proof. This document grants no installation, journal registration, runtime activation, restart or custody recovery authority.

Parent: #2961 — Goal: Core Daemon Blocked-Goal Repair Steward and Proof-Gated Re-Admission.
Implementation base: 627bf2e21e7df5d3f372670af0662131c6778d8c. Structural design reviewed against 9bb093826797f89a3c0b0fe0f36b831b8b0d7722; original observation base 8530cb69a6dcb13d4050a7146ebcec77ba9a833e. The disjoint live-custody visibility correction was incorporated without rewriting history.

## Observed recurrence and invariant

The original incident was recovered with authenticated full-boot evidence. A later hold now has MAINTENANCE_CUSTODY_STATE_MISSING. The existing Windows PowerShell channel is Circular, maximum 15,728,640 bytes; its oldest native record is newer than the original prepared anchor. The surviving authenticated workspace projection is IDLE. Its signature proves provenance, NOT freshness. It cannot clear the present hold. Its reservation also differs from the guardian's later cycle, and the last report's start time differs from the guardian's last attempted admission.

Root cause: a high-volume shared circular audit channel was used as the durable freshness anchor. Fail-closed behavior prevented unsafe execution, but unrelated logging eventually destroyed recovery authority. Increasing the circular size or blindly repeating boot recovery does not repair that model.

Required invariant: custody authority must be non-overwriting OS-managed state, beyond workspace replacement authority. Capacity exhaustion must deny new execution while preserving the last authoritative record. No signed workspace projection, absence of a PID, successful child kill, elapsed time, service reload or old successful recovery may stand in for current authority.

This recurrence requires structural Windows/security review BEFORE implementation. Reject the design if its installation, ACL, retention, migration or crash predicates cannot be established.

## One canonical adapter, retained native channel

Extend the existing native audit adapter; do not add a controller, scheduler, signer or mutation lane.

Use one fixed dedicated classic Windows event log and one fixed source (proposed names Stephanos Maintenance Custody / StephanosMaintenanceCustody). Register through a separately operator-approved, source-pinned native installer. Ordinary startup MUST NOT register, reconfigure, change ACLs, clear, resize or silently create the channel.

Require enabled channel, fixed source-to-log mapping, Retain mode (never overwrite) and a bounded configured maximum (proposed 64 MiB). Reject Circular/AutoBackup until a separately reviewed archival contract exists. Channel creation and configuration are administrator operations; this is an explicit deployment gate, not authority inherited from the current user request or a maintenance verb.

Give the existing executor principal read/write events only. Clear/delete/configuration rights remain restricted to SYSTEM and approved administrative principals, as independently inspected in native configuration. Reject unsupported/empty/broad clear ACLs, wrong owner, unsafe source mapping or inaccessible authority. No arbitrary channel/source/ACL/path arguments.

The empty-native-log first append has an explicit non-authority bootstrap. Only the separately approved fixed installer may emit the fixed bootstrap event (distinct ID and marker, no custody record, no IDLE/reservation/release authority) after native source, ACL and Retain configuration validation. A truly empty new log must be tested natively. The bootstrap creates an independently read OS sequence number; the first custody compare-and-append then uses the actual newest record plus one and rechecks the actual appended EventRecordId under the existing kernel mutex. Missing bootstrap/unknown sequence refuses append. Repeated installation must neither reset the log nor overwrite a journal; bootstrap retries are idempotent by actual native readback. A bootstrap event can never supersede custody authority.

A bounded anchor search exhausting its budget is UNKNOWN/REFUSAL, never found=false. Only complete native search exhaustion with no scoped custody row may prove no new-channel authority. Do not silently skip a malformed newer custody row, truncated query, inaccessible channel or older valid row beyond a scan budget. Include adversarial tests for foreign-scope flooding, bootstrap replay and budget exhaustion; this closes the existing return-null-after-256-rows hazard as part of the same freshness invariant.
Continue the existing protected Global kernel mutex and exact previous-record compare-and-append protocol. Bind the new fixed channel identity and a new MAC domain to every envelope, in addition to scope, actual OS EventRecordId, previous ID and transition ID. Reuse the existing credential; no new signer or secret publication. Never accept old-channel envelopes as new-channel authority.

A full channel is an explicit capacity refusal, not rollover, cleanup or permission to delete history. Reserve/terminal append failures preserve HOLD and admit no new action. The final proof must show failed append cannot erase the prior authoritative anchor. Native retention/capacity status must be bounded and must not claim unlimited capacity. Safe operator-led archival/rotation is future work; do not implement automatic retention deletion in this change.

## Migration adds ACTIVE only

The new channel being absent or empty is HOLD, never first-install IDLE. There is no permissive fallback to the old circular channel.

Extend the EXISTING direct-local preparation path of the fixed CLI with one closed retained-journal migration mode. Do NOT forward this migration to the old owner's prepare-after-audit-loss endpoint: that endpoint correctly pins its startup source and cannot execute new-channel/IDLE-migration code after installation. The old HTTP owner's startup pin remains unchanged and binding for all its existing operations. The new CLI runs only from exact installed canonical main after independent source admission; its only mutation is adding the migration ACTIVE fence through the existing custody store. This is an explicit bounded migration adapter of the same guardian, not a second execution/release lane. The currently held old HTTP owner stays running and unreloaded. New code must not be hot-loaded into that owner.

Before and immediately after the migration append, independently observe the fixed loopback owner's held state, no running/in-flight action, cycle/attempt identity and native listener/process-birth identity. Bind the operator packet to this observation and the exact stale projection digest/reservation. Observe the old owner; never ask it to waive its source pin or execute new code. A changed/missing/unproven owner or attempt refuses the migration/retains HOLD. Source installation is distinct from owner activation. The new CLI cannot release what it prepares, and no new maintenance execution is allowed until its separately approved later full boot and normal authenticated successor recovery. The native journal and kernel serialization remain authoritative; health or a workspace file alone never authorize release.

A separately approved migration packet must bind installed canonical main, native journal configuration, exact authenticated projection bytes/digest and reservation, and a fresh bounded observation of the live held owner (no running/in-flight action, current cycle/attempt identity). Preserve differing report/attempt identities explicitly as UNKNOWN; never rewrite a report to fit the hold.

Migration may archive an authenticated ACTIVE OR IDLE projection as stale provenance only. An IDLE projection MUST NOT authorize execution. Under the existing kernel serialization boundary, require no authoritative new-channel record; durably archive the exact original envelope and live observation, recheck input bytes and missing new authority, and append a NEW ACTIVE migration reservation with fresh nonce and current native boot witness. Failed/raced/uncertain writes leave HOLD.

The legacy event channel may be observed for contradictions; an extant newer/corrupt/unreadable authority must refuse migration rather than silently disappear. Exact transition predicates and source/owner bindings require specialist approval before implementation. Do not synthesize a current terminal result.

This preparation grants no release authority to its process. Its only completion is a prepared held receipt. A separately approved full Windows Restart must occur AFTER this preparation's observation. The loaded successor HTTP owner must independently verify fresh same-machine later full boot, exact reservation digest, new retained native authority and canonical source. Only the existing authenticated recovery transition may archive UNKNOWN history and append IDLE. No source lease or historical R7 authority is released.

The prior ONE restart approval has been consumed. A new restart or administrator installation requires a concrete new operator packet after source review/proof; never reuse the old approval.

## Proof and convergence

Before native deployment: deterministic adversarial tests for unsupported retention/ACL/source mapping, missing channel, empty journal, append exhaustion, projection replay/tamper, ACTIVE and IDLE migration remaining held, input drift, concurrent preparation, crash points before/after archive and append, wrong digest/machine, same boot, old epoch/record replay and unchanged ordinary terminal admission. Model/property traces must cover reserve/release/migration/recovery and assert no execution without current authoritative IDLE-to-ACTIVE reservation.

Native exact-head Windows proof must establish the actual channel/source mapping, Retain behavior, executor read/write but no clear/configuration authority, OS record identity binding, concurrent CAS, persistence across full boot, capacity refusal retaining the previous record and genuine post-boot recovery. Do not call mocked .NET results native proof. Any disposable native fixture registration/deletion also needs explicit administrator/operator permission; fixture names are fixed and production cannot be selected as a test target.

Preserve all existing custody, source isolation and guardian regressions. Publish specialist exact-head review, complete tests and exact merge approval. Installation and full boot have distinct receipts. Browser proof must establish actual launcher/runtime usability on 4173 after recovery; reachable HTTP alone is insufficient.

No completion claim until current held custody actually recovers, guarded maintenance remains eligible and normal 4173 works. Record the shared lesson: durable custody freshness cannot depend on an unrelated circular audit stream. Historical recovery and a green review are intermediate evidence, not completion of the recurring repair.
## Candidate proof and deployment boundary

The existing CLI now has a direct local `inspect-retained-migration` observation and `prepare-retained-migration` ACTIVE-only preparation. The operator packet binds the authenticated projection digest/reservation, exact installed main and independent held-owner digest. The native listener/process-birth observation is bounded to the fixed private owner; it is checked before and after the append. Source/owner movement after a real append retains and reports the prepared ACTIVE digest. The old HTTP owner's startup pin is never waived or reloaded.

Deterministic tests include stale IDLE migration, legacy contradictions, changed projection, owner drift including post-append drift, source movement and 360 adversarial model steps across missing/replayed workspace state, reserve/release and boot transitions. The real read-only Windows boot and native owner observations were exercised. C# fixture declarations compile and all five PowerShell files parse. These results do NOT establish native registration, ACL/retention/capacity or post-boot recovery proof.

Native fixture execution is NOT yet admitted. Automatic approval review rejected adding its administrator-level registration to hosted CI without the explicit fixture permission reserved by this design. A concrete approval question is pending for only the fixed 1 MiB `StphCustodyFixture` log on a disposable hosted Windows runner. The proposed production journal remains 64 MiB and is not selectable by that fixture. The hosted Windows test gate deliberately fails if native setup is absent; skipped local fixture tests do not count as proof. No production installation, source sync, owner activation, restart or custody release has occurred for this candidate.

The native harness uses a reduced token with administrator membership disabled to verify read/write versus clear/configuration/registry-write denial. It may clear or alter ONLY the fixed disposable fixture if a denial is broken, causing test failure. It temporarily applies Circular mode only to verify adapter refusal, restores Retain, then fills the bounded fixture to prove failed append retains the last authority. Fixture registration/execution remains paused until permission; no workaround route is authorized.

The first native event must be the independently read fixed non-authority bootstrap with OS record ID 1. The installer emits it only for a truly empty log and verifies readback; normal authority reads/append require that retained bootstrap. Native query exhaustion uses the externally bounded child-process deadline, never a timed no-row result as absence. Scan-budget exhaustion fails closed.

References for the intended OS contracts: [Microsoft EventLogMode](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.eventing.reader.eventlogmode) defines Retain as non-overwriting; [Microsoft Event Logging Security](https://learn.microsoft.com/en-us/windows/win32/eventlog/event-logging-security) separates read, write and clear rights. Actual exact-head native fixture receipts remain required in addition to these documented semantics.
