# Sovereign conversation and Control Tower observation

Read the current protected source and actual exposed tools before choosing this route.
This reference adds conditional routing guidance; it does not install a runtime,
activate cloud MCP, grant execution, or establish another controller.

## Establish the available version

1. Read fresh protected main and the existing
   `.github/workflows/stephanos-control-tower-build.yml`,
   `shared/agents/controlTowerBuildRequestV1.mjs` and
   `scripts/control-tower-build-consumer-v1.mjs` at that head.
   The optional observation route is available only when those exact sources
   define and consume `OBSERVE_CONTROL_SYSTEM`.
2. Verify native source adoption separately. A merged source file, plugin release,
   healthy HTTP service, workflow artifact or local inspector success does not
   prove that the relay, backend or Desktop MCP host loaded the new source.
   Use current exact-head receipts; keep missing activation explicitly unproven.
   One authenticated read-only OBSERVE request can establish that evidence;
   do not require its result before attempting the admitted observation.
3. Recheck the current status of referenced PRs and native blockers. Dated source
   descriptions are historical context, never permanent routing or execution authority.

## Choose the existing route

Prefer genuinely exposed private/local Sovereign MCP. If the canonical issue is
saturated, do not post, edit or replay a command there, use an inactive successor,
or treat the mailbox ceiling as a healthy fallback.

For the two fixed Control Tower operations, use the existing authenticated
workflow on main only when a real dispatch connector or authorised owner UI is
available. A GitHub read/comment/rerun capability is not workflow dispatch.
Never simulate an owner event or rerun a first-attempt-only request.

- `OBSERVE_CONTROL_SYSTEM`: request the checked-in read-only native inspector.
  It never invokes the maintenance executor, installs a helper, restarts a process,
  repairs files or releases custody.
- `BUILD_NEXT_ELIGIBLE_GOAL`: request the existing guarded goal-building repair.
  The original native owner still decides source, lease, resource, gaming and
  runtime qualification. Do not submit a fresh build while an earlier outcome
  is unresolved. A read-only inspection may investigate that original request.

Select only the exact operation in current source. Do not add free text, paths,
PIDs, commands, URLs or mailbox-rotation inputs. Owner pushes may already have
created a BUILD request: inspect that run before creating another. Preserve one
request ID through its unknown outcome; never mark a skipped request executed.

The workflow is:
https://github.com/Cheekyfellastef/stephan-os/actions/workflows/stephanos-control-tower-build.yml

## Interpret retained evidence

Use `currentPoll` for current carrier state. Use
`latestBuildRequestObservation` and `latestControlSystemObservation` for
separately retained original-ledger outcomes; `latestRequestObservation` is only
the newest convenience view. A waiting poll or newer successful inspection cannot
erase an unresolved BUILD. Preserve original timestamps and source heads across
staleness, source changes and restarts.

`RESERVED`, `UNKNOWN`, invalid metadata and a known request with missing ledger
evidence do not prove completion or permission to repeat work. A legitimate older
ledger `TERMINAL` record with `DONE` or `BLOCKED` remains terminal even if
`LEGACY_DETAIL_UNAVAILABLE` means its original time/head/details are unknown.
Status request pointers are locators only; reread the original ledger for outcomes.

`OBSERVATION_COMPLETED` proves a bounded inspection completed, including an authentic
native refusal. Inspect its `stephanos.sovereign-control-system-status.v1` result;
do not turn it into runtime qualification, repaired service or completed build.
`observationProofHash` is separate from `wakeProofHash`. `WAKE_COMPLETED` still
needs the original worker's actual pickup, material edit, test, review, protected
integration and live proof before claiming a goal built.

## Talk through Stephanos AI

After verified backend adoption, Sovereign Commander and Control Tower targets,
their supported slash forms and operational Everyone mentions use the existing
AI route. Examples: “Show me control status”, “Inspect the native control system”
and “Prepare the guarded goal-building repair request”.

Require `data.sovereign_control_conversation` with
`responseSource: CANONICAL_CONTROL_OBSERVATIONS`, `modelInvoked:false`,
`directParticipantDispatchProven:false` and `nativeActionSubmitted:false`.
The responder is **Stephanos control**, not an independently dispatched native agent.
Ordinary chat has no trusted operator execution identity. Its expiring
`NOT_SUBMITTED` handoff is a preparation and fixed workflow link; opening it is
not submission. It cannot borrow server credentials to run native actions.
Other conversations continue to use the configured AI route.

## Avoid fragile pasted diagnostics

After the checked-in source is actually present on Battle Bridge, an operator
who has no callable remote route can run this literal PowerShell command:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Users\Stephan Callear\Documents\GitHub\stephan-os\scripts\sovereign-commander-native-inspect.mjs'
```

The only optional arguments are `--expected-main <exact SHA>` and
`--control-tower-request control-tower-build-<runId>-1`. Do not reconstruct inline
JavaScript or invent a shell/MCP action for this file. Exit zero and
`observationCompleted:true` mean observation completed, not runtime health.
The local report's caller identity applies only to the diagnostic caller.
Publish only the closed public projection; never put raw local output, SID,
PID, paths, command lines, tokens or custody identifiers into GitHub.

## Meter and authority truth

These deterministic control replies do not call a model; the existing carrier and
native control path avoid RDC and Codex remote-control tool meters. ChatGPT,
GitHub API/Actions, networking and optional model providers retain their own
limits. Do not promise unlimited free hosting or inference. Preserve the existing
plugin/App identity, private stdio configuration, original owners, review,
protected merge and native qualification gates.
