# Rescue Island one-shot native host bootstrap

Owner: #3109 — Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)

This builds the Island's own native executable entry point. Its only admitted
operation, `--inspect-principal`, reads the actual primary process token with
`TOKEN_QUERY`, checks for a separate impersonating thread, and emits its own
PID/start time, SID, elevation type, administrators-group presence and the complete
assigned privilege inventory. Group presence comes from bounded native `TokenGroups`,
including disabled and deny-only SIDs; `administratorsGroupAttributes` retains
the raw attributes and is null only when that SID is absent. `assignedPrivileges`
retains every entry from one bounded `TokenPrivileges` snapshot: name, LUID low/high
parts and raw attributes, including disabled entries and unknown attribute bits.
Malformed, duplicate or unresolvable entries fail observation; they cannot become
an empty successful inventory. It never accepts an identity/token from the caller.

The compatibility `assignedSensitivePrivileges` field is derived from that same
inventory. It conservatively includes every name except the existing ordinary
diagnostics `SeChangeNotifyPrivilege` and `SeTimeZonePrivilege`; unfamiliar names
therefore require further review automatically, including disabled rights.
This is a review-required diagnostic projection, not a claim that every listed
right is intrinsically dangerous or either exemption is safe in every context.
The complete inventory retains both exemptions. Any future admission policy must
inspect that full inventory; an empty compatibility projection proves no eligibility
or isolation. A default/unobserved inventory is not evidence of absent privileges.

Every invocation remains **HELD**, with exit code 3 for an observation and 64
for an unregistered operation. `--run`, recovery, task/path arguments, stdin and
environment flags cannot enable execution. Nothing is installed or registered:
no account, ACL, service, scheduler, claim, lease, queue, source write, child
builder, Git/Node command or resource grant is created by this host.

The JSON is diagnostic and unauthenticated outside the observing process.
Even a plausible distinct SID and non-elevated token do not authenticate host
enrollment, complete original-writer inventory, process protection, executable
dependency closure, or estate ACLs. Administrator deny-only group membership
and assigned privileges are observations, not a complete isolation decision.
Do not ingest these fields as proof or remove the production engine's
`RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED` hold.

The remaining implementation and independent commissioning gates are in
`docs/architecture/rescue-island-execution-custody.md`. In particular, the host
still needs authenticated atomic canonical/Seed/Island task and owner-comment
reservation, a protected principal and complete execution/Git/target/receipt
estate, a task-bound revocable gaming budget and live original-principal
negative/recovery probes. Extending this entry point must reuse the existing
Island intake/preflight/source engine and canonical ownership interfaces;
it must not create a new scheduler, duplicate owner or R7 lease route.

Build and run its actual Windows child-process tests:

```
dotnet run --project src/windows/Stephanos.RescueIslandHost.Tests --configuration Release
```

The tests observe a real process token and real thread impersonation, create a
restricted copy with an actual deny-only group, then launch the built native
host and bind its JSON PID to the actual child handle. The group regression
selects an enabled SID from its own token, so it requires no administrator
account; the restricted copy is only queried and disposed. It proves the native
observation retains the SID and attributes that `WindowsIdentity.Groups` hides.
Synthetic buffers also exercise the production privilege decoder with real Windows
LUID/name resolution, disabled identity and directory-sync rights, raw attribute
bits, ordinary entries, duplicate/truncated/over-limit buffers and an unresolvable
LUID. Separate pure-name fixtures cover all 36 documented names plus future and
near-match names; the two exclusions match exact ordinal names only. A pure
projection fixture also checks unfamiliar names and missing inventory. These
fixtures do not assert that every documented name resolves on the hosted OS,
claim that the account possesses these rights, or alter account policy.
Forged authority environment variables and unregistered commands remain held;
the empty disposable working directory stays unchanged. This is host-bootstrap
test proof, **not physical Island builder pickup or a non-R7 build receipt**.

API contracts: Microsoft's [OpenProcessToken](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocesstoken),
[token information classes](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_information_class)
and [access-token rights](https://learn.microsoft.com/en-us/windows/win32/secauthz/access-rights-for-access-token-objects),
[TOKEN_PRIVILEGES](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-token_privileges)
and [privilege names](https://learn.microsoft.com/en-us/windows/win32/secauthz/privilege-constants).
