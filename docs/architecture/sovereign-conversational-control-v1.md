# Sovereign conversational control

Canonical owners: #2573 (Sovereign capability parity), #2315 (the existing
Control Tower carrier), and #2961 (native goal-building repair admission).

## Purpose

Connect the existing Stephanos AI conversation, Sovereign Commander observations,
Control Tower requests and original execution ledger. An operator can ask what
is working, why a request is held, prepare a native inspection, or prepare the
existing guarded goal-building repair. This does not create another controller,
worker, scheduler, mailbox, execution owner or authority store.

The previous copied JavaScript diagnostic failed before execution when its
`node:` import suffixes and template-literal delimiters were lost. The native
inspection now lives in source as a normal command; Control Tower can request
the same implementation without pasting JavaScript.

## What can be said and what happens

| Conversation | Behavior | Execution boundary |
|---|---|---|
| Commander or Control Tower: “Show me control status” | Read fixed loopback Commander health and the existing relay status, then return a deterministic explanation | No model or native action |
| “Why is repair blocked?” | Explain observed guardian state and original request outcomes, with observation times | Unknown evidence remains unknown |
| “Inspect the native control system” | Prepare the exact `OBSERVE_CONTROL_SYSTEM` workflow choice | Authenticated owner submits one existing Control Tower request |
| “Prepare the guarded goal-building repair request” | Prepare `BUILD_NEXT_ELIGIBLE_GOAL`, unless prior work is unresolved | Existing maintenance, canonical source, custody, gaming and build admission checks still decide execution |
| Arbitrary shell, reboot, install, custody release, or caller-selected URL/path | Explain the supported fixed capabilities | Never turn chat text into a native command |

Explicit Sovereign/Control Tower targets, their slash forms and operational
mentions from Everyone enter the control service before provider configuration,
credential loading, provider health probes or model execution. The existing
exact `/sovereign` command retains its original read-only health-tool contract.
General conversations with other participants continue to use the configured
AI route. “No model used” describes only an observed control-service reply.

The UI keeps the addressed identity separate from the actual responder. A
control reply identifies **Stephanos control** and never claims that an
independent native agent was dispatched. The ordinary AI route has no trusted
operator identity: request text, target and runtime context are presentation
inputs. They cannot borrow the server's Commander bearer, create a workflow
request, invoke a maintenance tool or grant execution authority.

An action handoff contains the single existing workflow URL, `main`, one closed
operation, a ten-minute preparation interval and `NOT_SUBMITTED`. Opening the
workflow is not submission. The browser validates those fields before showing
the link, and removes expired or blocked preparation links. A random handoff ID
is correlation only; it is not an execution token. An unresolved BUILD remains
visible even if a later read-only inspection succeeds.

## Meter and privacy boundary

Control replies use deterministic observations and no language-model API.
The remote carrier uses the existing GitHub Actions workflow, and the native
side uses the existing Sovereign relay and local inspector. Neither requires
an RDC or Codex remote-control session. GitHub, ChatGPT and any configured model
retain their own service limits; this does not claim unlimited free hosting or
model inference. No public listener, shared credential, new user account or
anonymous native action is introduced.

Public native status is a closed projection capped at 2048 bytes. It excludes
SID, PID, paths, command lines, custody hashes, raw logs and reusable native
qualification objects. Source equality is observation, not proof that a process
loaded those bytes. The selected workspace's ledger is explicitly not proof of
the relay workspace identity. The local command's caller token observation
applies only to that diagnostic caller.

## The native command

After this source has been merged and adopted on Battle Bridge, PowerShell can
run the checked-in inspector directly:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\Stephan Callear\Documents\GitHub\stephan-os\scripts\sovereign-commander-native-inspect.mjs'
```

Optional closed arguments are `--expected-main <40-character SHA>` and
`--control-tower-request control-tower-build-<runId>-1`. There is no path, URL,
PID, shell, install or repair argument. It rejects non-Windows/noncanonical
source, samples the listener before and after bounded health, independently
reads the existing fixed-runtime qualification, optionally reads the named
original ledger entry and rechecks source. It creates no ledger entry and
performs no native mutation.

Exit zero and `observationCompleted:true` mean the observation completed. An
authentic installation or normal-operator refusal is a completed observation,
not a healthy runtime. Exit two means a bounded inspection could not complete.
The Control Tower consumer uses the public projected result and never carries
the native inspector's short-lived private dispatch capability through JSON.

## Durable request outcomes

`currentPoll` describes the current carrier poll. `latestRequestObservation`
describes a retained original ledger entry. The most recent BUILD and OBSERVE
records remain separately addressable, so a successful observation cannot hide
an ambiguous repair. Empty polls, new main heads and relay restarts never mint
a new timestamp, source head or success for old work.

The original exclusive reservation writes bounded `controlTowerObservation`
metadata in the same ledger record: authenticated run, attempt, operation,
source, archive identity and original acceptance time. The existing terminal
transition writes the final fixed state and proof. A lost or unknown native
response leaves the original reservation in place. There is no mutable
“unknown-result update” that could race with and downgrade a terminal result.

One shared status transition retains those original observations and closed
request locators across an empty poll, observer rejection, malformed callback,
carrier exception and restart. New heartbeat/failure times describe only the
current poll. A generated sequence matrix checks that failures cannot erase an
accepted request or refresh its historical observation time.

Read-only recovery scans at most 256 hashed shard directories and 4,096 records
in the original ledger. Each record remains at most 4,096 bytes; stored request
metadata is capped at 3,500 bytes including its at-most-2,048-byte public native
status. Recovery validates hashed paths and stable file/directory identities.
An incomplete or unsafe scan holds building, while fixed observation remains
available. This is not a cross-process lock or a replacement for original
maintenance-owner custody.

Historical records without new metadata remain readable but expose
`LEGACY_DETAIL_UNAVAILABLE`; their missing timestamp, source and blocker are
never reconstructed from a current poll. An original terminal phase with valid
`DONE` or `BLOCKED` remains terminal and does not hold future builds merely
because it predates the new detail format. A reservation or invalid terminal
evidence stays unresolved. An unresolved original build prevents
another distinct build run from being reserved or woken. Read-only observation
remains available to investigate it. These records are diagnostics and replay
protection, not goal completion, source admission or lease release authority.

When building is held, the reader authenticates each candidate before selecting
only an observation, within its existing ten-run and fifteen-second bounds.
An older held BUILD run cannot starve a later OBSERVE run. Skipped builds are
not marked recorded, completed, cancelled or executed. A status locator whose
ledger entry has gone missing remains a historical unknown; absence never
proves completion or permission to repeat work.

### Compatibility with existing open work

- PR #3302's separate ledger inventory validator must admit the optional
  `controlTowerObservation` field through the same closed model when the two
  changes are reconciled. Preserve its full-record digest and stability checks;
  this change does not activate its mailbox-rotation inventory contract.
- PR #3268's rotation tests and owner remain separate.
- PR #2965 owns durable cross-device chat recovery and iPad scrolling. The
  control targets and receipt cards are narrow additions to the existing UI;
  its conversation recovery must preserve structured target context and must
  not reintroduce prose prefixes before slash commands.
- PRs #3169/#3159 retain their MCP and HTTP capability ownership. This slice
  does not modify those registries, the native maintenance owner or its
  qualification policy, and does not expand the native dependency set. Source
  adoption still satisfies the existing complete current-main qualification.

## Verification and commissioning

`npm run stephanos:control:test` covers the bounded request, observation,
inspection, conversation and presentation contracts. The browser suite exercises
the actual desktop/phone DOM against explicit backend fixtures, including
request provenance and switching targets during a delayed reply. AI handler
tests use throwing provider/tool spies to prove that control replies cannot
fall through to provider health, credential overlays or native execution.

Fixture/source tests are not native commissioning. Acceptance still requires
protected source integration, existing owner adoption, one authenticated
observation run at the intended source head, its durable run-correlated native
receipt, a real Commander conversation response, and—separately—any claimed
material repair/build's original worker evidence. A staged Actions artifact,
completed observation or successful guarded wake never proves a finished goal.

Reusable invariant: transport polls, retained request outcomes, runtime
admission and material construction are separate facts. Keep their original
identities and evidence even when they are presented in one conversation.
