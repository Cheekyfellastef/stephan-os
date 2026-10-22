# Rescue Island one-shot native host bootstrap

Owner: #3109 — Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)

This builds the Island's own native executable entry point. Its only admitted
operation, `--inspect-principal`, reads the actual primary process token with
`TOKEN_QUERY`, checks for a separate impersonating thread, and emits its own
PID/start time, SID, elevation type, administrators-group presence and assigned
privileges. `assignedSensitivePrivileges` conservatively reports every assigned,
OS-resolved privilege except the two ordinary diagnostic exclusions,
`SeChangeNotifyPrivilege` and `SeTimeZonePrivilege`. Disabled privileges are
included because they can be enabled later; new OS-resolved names are reported
without a source-list update. A privilege-name lookup failure holds the whole
observation instead of silently omitting an entry. This reporting rule and its
two exclusions are not a complete isolation or admission decision. The host
never accepts an identity/token from the caller.

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

Synthetic native privilege buffers exercise the production decoder without
assigning rare privileges to the test account. Separate pure-name fixtures
cover the documented inventory and future names without asserting that those
names exist on the hosted OS. The tests also observe a real process token and
real thread impersonation, then launch the built native host and bind its JSON
PID to the actual child handle.
Forged authority environment variables and unregistered commands remain held;
the empty disposable working directory stays unchanged. This is host-bootstrap
test proof, **not physical Island builder pickup or a non-R7 build receipt**.

API contracts: Microsoft's [OpenProcessToken](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocesstoken),
[token information classes](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ne-winnt-token_information_class)
and [access-token rights](https://learn.microsoft.com/en-us/windows/win32/secauthz/access-rights-for-access-token-objects).
