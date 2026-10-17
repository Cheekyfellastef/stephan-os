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
