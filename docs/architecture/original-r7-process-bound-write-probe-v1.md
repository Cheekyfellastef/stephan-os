# Original R7 process-bound native write probe (Goal #3123 / #2961)

Status: source candidate; not a commissioned witness, installer or signer.

## Concrete gap addressed

`R7EffectiveWriteDenial.Observe` accepts a supplied Windows token. SID equality
alone cannot establish which process supplied it. `R7ProcessBoundWriteDenial`
adds an adapter that opens a single existing process, retains its kernel
handle, checks its exact native creation FILETIME against independently
enrolled input, and opens that process's primary token. It verifies the token
user SID, then calls the existing OPEN_EXISTING write-access probe.

Before returning, it reopens the primary token through the same retained
process handle and compares native TokenId, AuthenticationId and ModifiedId
plus group/privilege counts and a bounded TOKEN_PRIVILEGES digest with the
original snapshot and retained token. ModifiedId alone is insufficient:
native testing observed privilege removal without a changed ModifiedId.
It also rechecks creation
time and process liveness. Missing access, invalid identity, process exit,
token replacement or modification fails closed and discards the access result.
It never reopens a process by PID during recheck, accepts a supplied token,
or creates/filters/enables privileges on a production token.
Primary-token access requests only TOKEN_QUERY | TOKEN_DUPLICATE (0x000a).
The extra TOKEN_IMPERSONATE right is deliberately omitted: a correctly
restricted token DACL may deny it, and a primary token does not require it.

The native semantics follow Microsoft's [OpenProcessToken documentation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocesstoken),
[TOKEN_STATISTICS layout and ModifiedId contract](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_statistics),
[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes),
and [zero-timeout process-handle wait](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject).

## Authority and evidence limits

The input PID, native FILETIME and SID are private commissioning inputs from
an independently authenticated enrollment. This module cannot authenticate
their historical R7 provenance. A caller can supply its own process; the
result still cannot authenticate an original writer. There is no process-name
selection, historical lookup, broad process enumeration, executable/source-head
attestation, command runner, MCP/mailbox action, installer or service change.
This deliberately complements existing PR #3153 diagnostics and PR #3170
image pinning rather than duplicating their implementations or owners.

The observation samples one **primary** token and one target file. It does
not inventory impersonating threads, other tokens, descendants, old handles,
memory mappings, the whole checkout or `.git`, directory deletion/rename,
tasks/services, WMI/COM, or future re-entry. It does not freeze the process or
provide continuous enforcement; changes after the final sample remain possible.
The existing probe's filtered-token, bypass-authority and UNKNOWN outcomes
remain unchanged. ProcessBindingObserved is not proof of access denial.

All original-principal authentication, witness, containment, signer, historical
receipt, source mutation and lease-release authority remain false. Failed
observations expose only fixed classifications; successful observations contain
only bounded process-binding and underlying access facts, without raw PID,
SID, creation time, paths, handles or exception messages. This internal library
is not newly exposed through a public transport.

## Verification

The existing `Native Windows r7 Access Probe Proof` workflow compiles and runs
the test project, whose entry point now includes the new native tests. No
workflow or independent review/approval gate is changed.

Native tests use the test process and a fixed child copy of the test assembly,
plus a uniquely named, validated TEMP subtree. They cover actual primary-token
binding, wrong/missing PID, exact creation mismatch, wrong/malformed SID,
unchanged token identity, a genuinely distinct same-SID duplicate primary token,
and an exited process with its original handle retained. The duplicate is a
test fixture only; production never duplicates or filters a token explicitly.
The existing probe's result is compared directly, scratch data is preserved,
and private inputs/authority are checked. The child exits normally on stdin
closure, without shell, termination, elevation or production access.
The child token is verified distinct from the parent before a temporary test
DACL denies TOKEN_IMPERSONATE and admits QUERY/DUPLICATE. The excessive 0x000e
open fails, while the real adapter still binds the child token with 0x000a.
The original child DACL is restored through its retained handle on every exit.
This fixture changes no production token or parent token.
An additional unattached duplicate-token fixture removes only its own traversal
privilege and verifies TokenId/AuthenticationId stay constant while the actual
privilege snapshot changes and invalidates the stamp, even when ModifiedId
does not change. No process ever receives that test token.

Focused checks:

- .NET 8 Windows native test project: 44 new checks and the existing 77
  effective-write checks passed outside the restricted test sandbox.
- Node source/authority boundary suites: 7/7 passed.
- Signed quarantine verifier: 7/9 passed locally. Two existing symlink fixtures
  get EPERM both inside and outside the restricted sandbox on this Windows
  host. Full suite still requires a host permitted to create test symlinks;
  do not remove those tests or weaken validation.

## Next protected gates

1. Obtain qualified independent Windows/security review of the exact final
   head and complete changed estate. Hosted CI is regression proof only.
   No metered reviewer is required by this source module; any substitute must
   already be independently qualified for this risk class and exact head.
2. Use the existing protected operator approval/merge path. This PR does not
   merge or self-qualify itself, or modify the existing review machinery.
3. Complete the still-missing least-privilege protected service/SCM and registry
   provenance, fixed reversible installer, protected audit and original-writer
   enrollment under the existing Windows owner. Preserve the SCM host's
   `WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED` startup refusal.
4. Separately approve admin installation outside the source checkout; preserve
   all eight dirty Battle Bridge entries, unrelated worktrees and gaming. Prove
   authentic original-writer whole-source write/rename/old-handle and all
   task/service/WMI/COM/out-of-job re-entry denial, rollback and continuing
   protection on the actual host. These tests provide none of that proof.
5. Provision independent protected witness and operator Ed25519 keys on
   distinct SIDs, outside repo/relay/Core/OpenClaw. Authenticate prospective
   containment and exact witness/lease digests with the existing
   `authenticateLegacyOrphanQuarantine`; historical outcome remains UNKNOWN.
6. Only #2961's canonical fenced cancellation and revision-bound lease CAS
   may decide release. Keep `critical-2962-elastic-goal-r7-lease` held until
   authentic proof. Physical pickup/build and two unattended refills follow
   separately. General parity work remains after this critical path.

Reusable invariant: a same-SID token is not a historical writer identity;
retain kernel object identity and detect stale process/token samples without
promoting observations into custody, signing or release authority.
