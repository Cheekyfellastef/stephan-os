# Goal #3123: read-only Windows witness commissioning projection

**Source-only and non-authoritative.** This narrowly scoped change provides a JavaScript parser for an untrusted commissioning-census JSON observation and tests that every result stays on HOLD. It does NOT include an executable Windows census, a Windows service installer, an OS exclusion witness, a signer or source/lease authority.

## What this change does

- Adds `projectOriginalR7WitnessCommissioningAuditV1` under `shared/agents/`, bound to the existing exact repository, historical `critical-2962-elastic-goal-r7-lease`, and `StephanosOriginalR7CustodyWitness` service identity.
- Requires a fresh exact-format observation and rejects malformed, stale, identity-mismatched or user-forged privilege fields.
- Exposes opaque blockers for absent/unhealthy service and incomplete process/task inventory.
- Treats even `RUNNING` plus zero observed processes as insufficient for actual source denial.
- Every projection always denies authenticated witness, source mutation, privileged install, operator approval, physical pickup and lease release. Historical execution remains `UNKNOWN`.
- Retains negative regression tests for malicious authority assertions, stale timestamps, absent service and hidden/unknown inventory.

## Windows-script security boundary remains separate

The previously proposed `scripts/windows/audit-original-r7-witness-commissioning-readonly.ps1` is **not in this final PR diff or protected main**. It remains in the prior PR branch history for audit, but cannot be installed or treated as reviewed production code. Its independent review returned a P0 `unsupported-high-risk-surface`: a qualified authenticated Windows security specialist must review exact script bytes, identity, current head/base and fixed operation before that script can be separately proposed for protected merge or use on Battle Bridge. Removing it from the present PR does **not** convert the rejected Windows script into a reviewed capability.

This projection is usable only with trustworthy separately obtained input for *diagnostics*. Untrusted input is never physical writer-exclusion proof. No online Battle Bridge observation, authorized Windows service commissioning, old-writer principal negative write tests, protected signer keys or canonical cancellation/CAS is claimed.

## Remaining physical acceptance

The original source revision-7 lease remains HOLD. A separately provisioned and least-privileged native Windows witness must identify all original source-writer/re-entry routes (direct, WMI/COM, services and Scheduled Tasks), enforce independently verified exclusion on the exact original write paths, prove current negative writes and durable protected audit, and use two independent OS-protected Ed25519 signing roots. Only the existing `authenticateLegacyOrphanQuarantine` verifier and canonical mission cancellation/reconciler can allow the narrow approved quarantine/release; historical outcome remains `UNKNOWN`. Keep existing Battle Bridge dirty entries, unrelated gaming resources and Seed/Rescue source ownership untouched.
