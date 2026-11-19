# Core observation and held stale-lock recovery

Continues #2961 — Goal: Core Daemon Blocked-Goal Repair Steward and Proof-Gated Re-Admission.

## Current executable boundary

The normal Core census and the maintenance-owner observer are read-only. A missing
CIM image may be resolved only for a visible canonical command with a known birth,
using the existing limited-query native handle. The normal Core observer checks
the actual Windows token before reading or loading its checksum-bound owner helper.
An administrator-enabled token receives
`CORE_PROCESS_NATIVE_FALLBACK_REQUIRES_LIMITED_TOKEN`; it cannot use that fallback.
The shared native identity function independently refuses that token before native
initialization. Unknown commands, births, images, ownership and lifecycle remain
unknown and cannot admit a start or a lease release.

`scripts/windows/recover-stephanos-core-lock.ps1` preserves its public parameters
and `stephanos.core-lock-recovery.v1` response, but every valid argument mode now
terminates with exit 2 and `CORE_RECOVERY_TRUSTED_BOOTSTRAP_REQUIRED`. This includes
`-OperatorApproved`, `-AbsentLock` and `-RetireOnlyChild`. The active entry contains
no elevation request, dependency loading, native compilation, lock access,
retirement or process startup. It does not inspect or change the governor, source
lease, maintenance owner, service or scheduler.

A writable source checkout cannot authenticate the bytes that PowerShell already
parsed as its entry script. Checking files before reopening them, or adding
another digest to a mutable path list, does not establish privileged load-time
custody. The structural correction therefore removes the privileged execution
path instead of extending those checks. A real immutable, owner-installed
bootstrap with independently qualified entry/ACL and complete source custody is
a separate unimplemented prerequisite. This change does not install one.

## Provenance and retained negative fixtures

This is a new structural correction at the existing PR #3521 — Goal #2961: bind missing observer images to native process identity frontier, on the
original branch `patch-escrow/issue-2961-b24ee7772ed3`. It is not a reconstruction
of the unavailable cloud commits `e7556ac6effd8b0f6a57fb3b94a664ac199eac27` or
`e134c7e9b8a9b0cd3a8be3dcb75f168ae4e31f5e`. The latter task reported a
11,115-byte format-patch with SHA-256
`24499355e7627cba5ac3f8ffff602dc7070df2173e81ae93eabf3d1c8660f80f`.
Its bytes were not recovered, and that report is not source publication proof.

The historical reviewed inventory fixture retains source head
`62d659f63ada09586967882cb790b8363a0bf1a0` and blob
`9e00ce659859b0274fce36e13cb20045b1b337b1`. Existing specialist policy pins are
unchanged. The historical lock/policy/native fixtures exercise disposable files
and reject competing owners, replacement, ambiguous observations and delayed
continuations. They are negative evidence for that historical design, not an
active recovery entry, current specialist qualification or a bootstrap installer.

## Acceptance and remaining work

Required evidence distinguishes real normal-token Windows observations from
controlled token/native test seams. Recovery denial is exercised through the
actual entry for all switch/lock combinations and alongside tampered dependencies
and redirected state. No test requests UAC or starts Core. Source-closure guards,
independent exact-head Windows/security review, protected integration and native
adoption remain required.

Core stale-lock recovery remains held until the immutable-bootstrap prerequisite
is implemented and independently qualified through its existing owner. An
observation, a passing fixture or absence of gaming never supplies missing native
qualification. Goal building still requires the original lease, exact worker
grant, physical pickup, tested source, independent review and protected release;
this correction creates no new scheduler, worker, controller or authority plane.
