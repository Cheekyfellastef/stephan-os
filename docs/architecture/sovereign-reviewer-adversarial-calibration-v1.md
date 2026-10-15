# Sovereign reviewer adversarial calibration (Goal #1574)

This is the next implementation slice after merged PR #3128 (ten-question signed capability evidence). It tests the **judgement of a real local model** instead of equating a signed list of "passed" assertions with competence.

The fixed examiner passes ten bounded sample code patches to a separate read-only reviewer callback. Two are safe changes; eight deliberately introduce serious regressions, including lost source lease CAS, claiming BUILDING on dispatch rather than physical pickup, secret logging, unbounded retries, unsafe HTML assignment, unchecked file paths, SQL concatenation, and dynamic evaluation.

Every model reply must bind the exact challenge and SHA-256, cover the proper path, express valid P0/P1/P2 findings, and obey the closed response schema. A passing score requires each unsafe sample to produce a P0/P1 and both safe patches to stay clean. Adversarial tests reject same-actor reviews, provider overlap, wrong head, forged challenge identity, P2-only responses, broken JSON and unbounded output. The expected answers are held outside the model prompt.

This module is an **in-process callback harness**. A synthetic test pass only validates its grading logic. It does not run Ollama or attest a real Battle Bridge reviewer, sign anything, register an independent identity, qualify a high-risk Windows specialist, change protected merge gates, or commission the physical Windows witness. Every result explicitly denies those authorities, including a perfect score.

Next: have the existing read-only Sovereign Reviewer adapter run these ten challenges on Battle Bridge using an actually independent local model session, publish the bounded response digest to the Shared Workspace, and obtain an independent, source-head-bound auditor attestation via the already merged exam contract. The current Codex-pinned Windows specialist gate remains unchanged until separately qualified independent governance is commissioned. Preserve the original r7 lease HOLD and gaming governor.

Focused test: node --test shared/agents/sovereignCalibrationV1.test.mjs
