# Sovereign reviewer adversarial calibration (Goal #1574)

This is the next implementation slice after merged PR #3128 (ten-question signed capability evidence). It tests the **judgement of a real local model** instead of equating a signed list of "passed" assertions with competence.

The fixed examiner passes ten bounded sample code patches to a separate read-only reviewer callback. Two are safe changes; eight deliberately introduce serious regressions, including lost source lease CAS, claiming BUILDING on dispatch rather than physical pickup, secret logging, unbounded retries, unsafe HTML assignment, unchecked file paths, SQL concatenation, and dynamic evaluation.

Every model reply must bind the exact challenge and SHA-256, cover the proper path, express valid P0/P1/P2 findings, and obey the closed response schema. Each run randomizes case order and uses fresh opaque candidate-facing challenge IDs and file paths, never descriptive defect labels. A passing score requires each unsafe sample to produce a P0/P1 **with the correct privately held seeded defect category**, while both safe patches stay clean. Generic P1 findings cannot pass. The public manifest exposes counts and digest, not an answer key. Adversarial tests reject generic unrelated P1 findings, same-actor reviews, provider overlap, wrong head, forged challenge identity, P2-only responses, broken JSON and unbounded output. The expected answers remain outside the model prompt and callback metadata.

This module is an **in-process callback harness**. A synthetic test pass only validates its grading logic. It does not run Ollama or attest a real Battle Bridge reviewer, sign anything, register an independent identity, qualify a high-risk Windows specialist, change protected merge gates, or commission the physical Windows witness. Every result explicitly denies those authorities, including a perfect score.

Next: have the existing read-only Sovereign Reviewer adapter run these ten challenges on Battle Bridge using an actually independent local model session, publish the bounded response digest to the Shared Workspace, and obtain an independent, source-head-bound auditor attestation via the already merged exam contract. The current Codex-pinned Windows specialist gate remains unchanged until separately qualified independent governance is commissioned. Preserve the original r7 lease HOLD and gaming governor.

Focused test: node --test shared/agents/sovereignCalibrationV1.test.mjs

## Finding taxonomy without leaking the exam answers

The examiner now supplies **all nine possible classification codes** as a
shared candidate vocabulary (eight serious categories and a general fallback)
for every randomized challenge. These code names alone are not answer labels:
the candidate receives no per-case expected code, grade, case name or mapping.
The private scoring table still demands the exact defect classification at
P0/P1 and requires the two genuinely safe patches to remain clean. A generic
fallback is never sufficient to qualify. A new negative/disclosure contract
test is included in the same hosted CI calibration job. All statuses remain
candidate-only without protected Windows or specialist authority.

## Native clean WSL Git verification before calibration

The fixed calibration executable checks **actual local HEAD, named branch,
clean working tree and base-as-ancestor** with read-only `/usr/bin/git`
commands before invoking Ollama. Invalid, stale, dirty or unproven Git
checkout results in `CALIBRATION_HELD` with zero model calls. No checkout,
reset, stash, clean or other file mutation is performed. The known eight
dirty Battle Bridge entries must be preserved; a separately clean reviewer
checkout is required. Hosted CI uses a mock Git adapter to verify the refusal
policy, and does not claim physical source custody or model execution.

## Recheck exact checkout and reject forged candidate projections

The ten-case exam reads Git HEAD/branch/clean status/base ancestry **both before
and after** local-model execution. Any concurrent checkout/source modification,
including existing dirty entries, emits `CALIBRATION_SOURCE_CHANGED_DURING_EXAM`
and suppresses candidate readiness. It never resets or touches local work.
The public result projection now additionally refuses impossible pass counts,
wrong manifest digest and any claimed protected/privileged authority rather
than merely copying a caller's `status` field. Even an internally consistent
candidate is not independently signed, admitted or allowed to merge.

## Battle Bridge gaming resource governor precondition

The ten-case WSL Ollama candidate exam now checks the existing
`Shared Workspace/vr/vr-resource-governor-current.json` state before
starting, **before each local inference** and again before emitting any
candidate result. It uses a bounded read-only `O_NOFOLLOW` file descriptor,
requires an appropriately fresh native governor timestamp and holds if VR,
Air Link, a flat game, gaming preparation, model denial or heavy-model
protection is in effect. Missing/stale data prevents GPU-model loading rather
than assuming gaming is off. This adds no gaming toggle, background polling,
Ollama model load during preflight, OS mutation or merge authority. Runtime
governor protection remains independently responsible for immediate process
eviction on real headset/game detection.

## Non-overwriting candidate audit receipt

A synthetically valid local ten-case exam is not sufficient to qualify a
reviewer. When the real model produces a fully checked pass on a stable clean
checkout with gaming resources free, its CLI now must publish a bounded
**untrusted candidate observation** to the existing Shared Workspace
`proofs/sovereign-calibration-pr-<PR>-<HEAD12>-<OBSERVATIONS12>.json`
under native `O_NOFOLLOW|O_EXCL` handles with an output SHA-256 fingerprint.
A collision, missing proof directory or file error is a HOLD, not an invisible
pass. The Windows launcher verifies the exact PR/head-bound proof name and
fingerprint shape before surfacing candidate readiness. The receipt is *not*
an independent auditor signature or immutable host-backed evidence, and cannot
satisfy a protected exact-head specialist check without external attestation.
No source file, signing key, service, original lease, or game process is edited.

## Separately reviewed Windows idle-governor heartbeat

The strict thirty-second freshness check in this reviewer is deliberately
**not relaxed**. Battle Bridge's inactive VR governor normally updates only
when its gaming state changes, so an unchanged idle state can become stale.
The native Windows fifteen-second idle observation repair is preserved in
[PR #3155](https://github.com/Cheekyfellastef/stephan-os/pull/3155),
**separately draft and high-risk**, and has NOT been merged or commissioned.
The normal reviewer branch does not edit Windows governor authority surfaces.
Until a qualified native Windows specialist admits PR #3155 and its real
watcher behavior is witnessed, expired governor state keeps local-model
calibration held. No original dirty checkout files are changed.

## Verify completed model identity and release local GPU after each question

Each bounded `/api/generate` reply must identify the expected local Ollama
model, report `done: true` and `done_reason: stop`, and contain a bounded
response payload. Wrong, truncated, incomplete and unexpectedly substituted
model replies fail the ten-case qualification. Requests set `keep_alive: 0`
to release GPU residence after individual cases. This does not authenticate
Ollama's binary or prove an independent host/model signature; it preserves
candidate-only evidence and explicit gaming-governor safeguards.

## Windows bridge independent file-existence and SHA readback

The Windows-to-WSL candidate bridge now performs a bounded fixed-executable
`/usr/bin/sha256sum -- <SharedWorkspace/proofs/...>` readback after validating
PR/head-bound file name, candidate model verdict, and 64-character claimed
digest. It only emits candidate status if the proof file **really exists and
matches that SHA-256**; missing, unreadable, or changed files are HOLD.
This is shell-free/read-only and has no permission to install, sign, merge or
release the lease. The hash is not an independent auditor signature or proof
of privileged original-writer exclusion. Integration tests exercise normal,
missing, corrupted and forged-hash states.

## Bounded WSL helper-call timeout isolation

In ten-case calibration mode the actual approved fixed Node exam retains its
570-second total wall-clock budget; **neither** fixed `wslpath` conversion
nor SHA-256 candidate-proof readback may inherit it. Both use independent
12-second timeouts with shell-free fixed executable/argv. This prevents an
unavailable path converter, unexpectedly huge tampered candidate evidence,
or wedged proof checker from consuming an entire model-exam budget. The
ordinary fixed one-shot reviewer remains 150 seconds, and all positive
signals are still candidate-only without qualified security authority.

## Raw-byte source verification against Git HEAD (index-flag bypass closure)

The local Ollama examiner now verifies each of its four critical execution and
review policy files with fixed read-only Git queries: `ls-files -v` must
report a normally tracked `H` entry (no skip-worktree/assume-unchanged),
and `hash-object --no-filters` of the **actual current file bytes** must
exactly match `rev-parse HEAD:<path>`. This runs before and after the
bounded ten-case exam. A clean `git status` on its own is insufficient,
since Git index flags could hide substitutions. Missing, unsafe or modified
modules fail closed **before** Ollama can be called, with no file changes,
lease/merge permission or independently qualified reviewer attestation.

## Ollama weight-digest pin across the full adversarial exam

A mutable tag is not a stable model identity. Fixed read-only loopback
`GET /api/tags` now checks that exactly one matching local Ollama model has
a 64-character content digest **before and after** the ten-case assessment.
Missing, ambiguous or changed weights HOLD the candidate. Any passing
candidate record and Windows bridge receipt bind that weight digest to the
exact checked source HEAD, manifest and observations. This is local unsigned
model identity only, not an independently audited specialist approval.

## Safe read-only preflight refusal diagnosis

A real WSL `--preflight` may exit 2 when it correctly refuses a dirty
checkout, protected VR/flat resources, stale gaming telemetry, unreachable
Ollama or missing pinned model digest. Previously Windows collapsed **every**
such refusal into `WSL_REVIEWER_EXECUTION_HELD`, leaving Q2 commissioning
blind. The fixed bridge now parses exactly one bounded marker even on exit
2, and returns **only** a closed-list nonsecret reason when all nine
non-authority fields are explicit false. Unknown reasons, duplicate markers,
claimed privileged approval, wrong exit codes, raw PIDs/paths and extra
output remain HOLD with generic messages. No GitHub write, physical Windows
service mutation, reviewer signing or R7 lease authority is added.

## Loopback model prompt redirect protection

The fixed local Ollama `/api/generate` and read-only `/api/tags` calls
explicitly use Node fetch `redirect: 'error'`. Without this option, a
responding process on `127.0.0.1:11434` could return HTTP 3xx and the
fetch client could forward private adversarial source snippets to a different
host. Redirects now fail closed and no other URL, model endpoint, external
provider, shell command or privileged approval route is added. Hosted contract
tests assert exact loopback addresses, no redirect policy, and HOLD on a
redirect response; this is not a live Battle Bridge network attestation.

## Complete native governor state required for model admission

A stale, partial or schema-drifted VR/flat governor record must **not** make
a local reviewer model eligible for GPU use. Its read-only WSL consumer now
requires native governorVersion 3 and explicit boolean values for all eight
gaming/model permission indicators, plus a recognized load mode. A full
ten-case heavy review can start only in `balanced` mode when all relevant
game/headset/prepare flags are false and both model permissions are true.
Absent, stringified, old-schema, contradictory cooling or unknown fields
remain HOLD with no model inference. This affects the existing #3090 source
candidate only and does not mutate Battle Bridge's gaming processes or
governor policy.

## Per-question model digest continuity

The ten-case meter-free Ollama exam now probes the selected model's fixed
64-hex digest **before every individual inference**, as well as before and
after the whole run. A changed, missing or ambiguous tag is a held exam and
must not count the affected question. This catches a model tag changed during
the exam even if it is restored by the final observation. The checks are
bounded, read-only `/api/tags` calls to loopback and do not load the model.
This is still untrusted host-local evidence, not independent supply-chain
attestation, self-approval, Windows privilege or lease-release authority.

## Preempt Ollama while gaming begins during generation

Previously the calibration checked the VR/flat governor only **between**
`/api/generate` requests, allowing an in-flight local model to consume CPU
and GPU for up to 45 seconds after a game started. The fixed runner now polls
the existing governor every 500 ms *during* each inference, combines its
preemption signal with the original 45-second request timeout, aborts the
request on gaming activity/stale/missing evidence and clears the monitor in
`finally` on every path. Synthetic tests prove in-flight preemption and
monitor cleanup for completed requests; this is still source contract proof,
not a physical Battle Bridge gaming acceptance receipt or a substitute for
the governor's own model-eviction daemon. Candidate/lease authority stays false.
