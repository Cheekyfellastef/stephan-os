# Historical attended Core bootstrap design — execution held

Continues #2961 — Goal: Core Daemon Blocked-Goal Repair Steward and Proof-Gated Re-Admission.

This document records the historical attended absent-lock design. It is not an
invocation guide or a current native qualification. The active
`scripts/windows/recover-stephanos-core-lock.ps1` now returns
`CORE_RECOVERY_TRUSTED_BOOTSTRAP_REQUIRED` for every valid argument mode, including
`-AbsentLock` and `-RetireOnlyChild`, without loading dependencies, requesting
elevation, inspecting a lock or starting Core. See
[the current executable boundary](stephanos-core-stale-lock-recovery-v1.md).

## Historical mechanism and findings

The original design used a limited parent and one attended child. The child took
two bounded Node inventories around source checks. The parent consumed its actual
child's successful exit, checked source, lock absence and freshness, then used
Core's exclusive-create startup lock. Saved JSON never supplied authority.
Hidden commands, ambiguous identity, process membership/birth changes, source
drift and any lock object were negative outcomes.

The original owner found a stale-terminal-time defect in tree
`8096e3c13e147075735563cdf4c12d6816f19f86`; the independent report is retained with
SHA-256 `844f8df02349c1a95dcdb839962c4d4c3e5e900f533cc12e6f42794906133460`.
Historical tests subsequently exercised actual child birth/exit identity,
monotonic and UTC attempt age, future/backward clocks and 5.1-second parent/source
delays. They also exposed metadata-only ancestor handles that did not prevent a
directory rename while a lock was absent. The disposable-file adapter tests cover
read-access ancestor pins, replacement, contention and a competing later lock.

Those sampled checks did not authenticate the user-writable entry bytes already
parsed by PowerShell across UAC, or establish immutable privileged load-time
custody. The active privileged path has therefore been removed. No alternate
elevation route, signing root, service, task, controller or bootstrap installer is
provided by this correction.

## Retained test provenance and required future proof

The original reviewed two-function inventory remains immutable test-only data,
source head `62d659f63ada09586967882cb790b8363a0bf1a0`, blob
`9e00ce659859b0274fce36e13cb20045b1b337b1`. The historical recovery entry is also
retained as test-only data from `8ef452ae017a42f417dcbaa3f8365b38dce2b897`, blob
`ccd8f358fcfa6d6ebf4f0a409ac2c7a32caec58c`. The absent-bootstrap fixture extracts
its historical bodies only to retain the earlier adversarial decisions. The
active entry never reads or executes that fixture.

Existing tests of policy and native handles remain negative evidence on
disposable files, not permission to invoke the historical recovery path.
An owner-installed immutable bootstrap, entry/ACL proof, complete privileged
source closure, independent exact-head Windows/security review, protected
integration and native commissioning remain unimplemented or independently gated.
Original source leases, maintenance custody, R7 ownership, worker grants and
physical pickup requirements are unchanged.
