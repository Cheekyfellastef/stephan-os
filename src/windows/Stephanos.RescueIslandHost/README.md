# Rescue Island one-shot native host

Owner: #3109 — Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)

The observation operation, `--inspect-principal`, reads the actual primary process token with
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

Inspection remains **HELD**, with exit code 3 for an observation and 64 for an
unregistered operation. Strict construction still refuses
`RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED`. `--run`, recovery, task/path
arguments and authority environment flags cannot waive that refusal.

## Separate supervised cooperative pilot

`--supervised-once` accepts at most 16 KiB of UTF-8 JSON on stdin, containing
only `{commentId, task}`. It verifies the actual non-administrative process token
and launches one fixed Node executable and `scripts/rescue-island-supervised-host.mjs`
from its build's repository layout. Copied binaries cannot nominate another
source root. The owned child runs at BelowNormal priority; timeout cancellation
is restricted to that child and its descendants. No Windows account, ACL,
service, scheduler, model, driver, signing root or credential is created.

The JS adapter uses the existing Shared Workspace operation-lock primitive for
the whole authenticated operation and the original Island task-claim estate.
It reads the canonical source lease and original missions' declared `allowedFiles`,
every observed Seed estate's task/target reservations and retained Island claims.
It neither acquires nor retires the original R7 lease. Missing, malformed,
conflicting or unbounded inventories fail closed. Canonical/Seed ownership is
observed again at every stage; these cooperative observations do not physically
exclude a privileged or undiscovered writer.

After authenticated exact GitHub intake and current gaming/token/claim checks,
the first run can create the minimum fixed Island estate under the configured
Shared Workspace's `worktrees/rescue-island-01`: an independent `--no-hardlinks`
Git clone, separate worktrees and receipts. An existing unmarked or partial
estate is held for reconciliation. Canonical refs/index/worktrees are never
used for pilot mutation. Every original dirty file and the canonical index are
copied and hashed before construction; changed bytes, source heads or physical
root identities stop the operation. Failed admissions, claims, commits and
receipt-publication failures remain for operator reconciliation. No automatic
recovery or refill is implemented.

Fresh gaming admission runs the exact canonical governor Git bytes with its
fixed read-only ObserveAdmission action. The trusted operator's additive custom-game settings
(`STEPHANOS_GAME_PROCESS_NAMES` and `STEPHANOS_GAME_LIBRARY_ROOTS`) survive native
ingress and are validated as bounded detector data before reaching that child.
They cannot select a command or supply an idle observation. Other inherited
executable, credential and preload selectors remain excluded. A change to the
governor source, failed observation, active game or any pending prepare evidence
holds construction. Persisted NORMAL/local-model admission is also required.
The existing watcher remains the sole state/model writer. No transition
timestamp is rewritten, lease cleared or model action invoked by this observer.
The observer uses an existing regular, physically resolved
`C:\Program Files\PowerShell\7\pwsh.exe` when present, otherwise the fixed
Windows PowerShell system executable. It installs neither. The selected engine
is bound across admission observations; a changed selection holds the run.
Inherited PATH and executable overrides cannot select an engine. Existing
Windows PowerShell cold-start failures remain failures, with bounded diagnostics.

The Windows-only real-adapter suite is explicitly launched by the existing
native proof workflow, rather than collected by portable Node test globs:

```
dotnet run --project src/windows/Stephanos.RescueIslandHost.Tests --configuration Release -- --run-adapter-tests
```

Its fixed test-only launcher reduces its own token and executes
`shared/agents/rescueIslandSupervisedHostV1.windows.mjs`. Every test is mandatory
in the Windows job. GitHub transport and platform process inventories are test
doubles; the canonical custom-game resolution function itself is exercised.
Fixture commits are test evidence, not a commissioned live Island build.
The launcher creates disposable noninteractive desktop objects for that same
user, with a medium mandatory label. On an already administrative hosted runner
it also creates a private window station; a non-admin local caller uses a private
desktop within its existing accessible station. Handles are retained through
the child's terminal result and then closed. Existing desktop ACLs, interactive
desktop selection, accounts, policies and production admission stay unchanged.
The new restricted token and its future objects have explicit same-user/SYSTEM
descriptors, so an inherited administrator-only default cannot exclude the
child from its own objects. The caller's primary token is never modified.

Passing and failing Node stdout is retained under `receipts/test-output`, with
content-addressed log names. A TESTED receipt binds its exact log SHA-256,
test path and zero exit status. A failed test does not emit TESTED or COMMIT.

The first pilot invokes the existing canonical governor's fixed `Reconcile`
action for a fresh NORMAL/idle observation for CPU-only work, expiring at the
observed timestamp + 10 seconds. A stale transition timestamp is not a heartbeat.
The exact governor Git blob is materialised into the Island's private input
evidence; standard CRLF checkout differences are accepted for comparison, while
only the exact Git bytes are executed. The fixed Windows PowerShell child uses
the existing per-process execution-policy argument; no machine policy is changed.
Long clone/preservation operations refresh the same governor again before
returning admission.
It is checked before claims/worktrees/edit/tests/commit; no model is loaded.
This is an ordinary cooperative governor observation, not an independently
signed resource grant. It cannot qualify hostile-writer custody or unattended
operation. Source changes during a bounded child are rejected at the subsequent
boundary; this mode does not promise prevention of malicious check/use races.

The owner must post a fresh exact command on original issue #3109:

```
/rescue-island-01 supervised-cooperative <current-main-SHA> <task-id> <content-SHA256>
```

The full task is validated against that independently fetched owner comment,
the exact issue, current main, fixed documentation target/test and ten-minute
expiry. Ordinary `pilot` approval does not consent to this profile. Review and
protected integration precede live use. Exact live consent is separate.

Every construction receipt is labelled `SUPERVISED_COOPERATIVE_V1`, with
`hostileWriterContainmentProven=false`, `independentlyCommissionedWorker=false`
and `unattendedRefillsProven=false`. This is **less assurance** than strict
containment, assuming a trusted operator and cooperative workers. Island 02,
general-purpose model building and unattended refill remain unimplemented.

Approval reads use the canonical absolute GitHub CLI path and an explicit
minimal child environment. Inherited `STEPHANOS_GH_COMMAND`, PATH, GitHub host,
token/config selectors and Node preload settings cannot nominate an executable
or substitute the owner-authentication transport. Native ingress also uses an
environment allowlist.

Hosted Windows CI uses a test-executable-only launcher for the fixed adapter
suite under a LUA/maximum-privilege-disabled copy of its own primary token.
The real production token observer must accept that child; no account, ACL,
policy or credential is provisioned. GitHub reads and the governor's platform
signal collector are explicit fixture doubles in that suite; lock/file/Git/Node,
PowerShell invocation and native token observation are real. Live gaming/model
reconciliation remains separate qualification under exact operator consent.

The JSON is diagnostic and unauthenticated outside the observing process.
Even a plausible distinct SID and non-elevated token do not authenticate host
enrollment, complete original-writer inventory, process protection, executable
dependency closure, or estate ACLs. Administrator deny-only group membership
and assigned privileges are observations, not a complete isolation decision.
Do not ingest caller copies of these fields as proof or remove the strict engine's
`RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED` hold.

The remaining strict-mode implementation and independent commissioning gates are in
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
