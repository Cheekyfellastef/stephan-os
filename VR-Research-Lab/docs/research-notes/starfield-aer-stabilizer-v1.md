# Starfield AER Stabilizer V1

## Purpose
Diagnose and progressively stabilize MutaR Alternate Eye Rendering (AER) in Starfield without replacing the verified public MutaR route.

## Reference
Luke Ross R.E.A.L. VR for Red Dead Redemption 2 is the local known-good AER reference on the Battle Bridge. It demonstrates defensive frame/pose handling, buffering, stereo TAA correction, pacing, and prediction around AER.

## Exact source
- Upstream: mutars/starfield2vr
- Baseline tag: v2.0.1.Public
- Upstream baseline commit: c8a2b200710cdf70db22fd0fcac498cba02da676
- Local stabilizer source commit: b25bb9f9bf7f02ec87660a34ce3a2ef129d2fd3d
- Reproducible patch: VR-Research-Lab/patches/starfield2vr-aer-stabilizer-v1.patch

## Binary identity
- Public baseline dxgi.dll SHA256: 63db15c370d3b8f15faa292a95d5c3abd4c6571cef0d35a45310d998adfeae41
- Observe stabilizer dxgi.dll SHA256: b0046baf0e4487c76d6a7c85c04b338e402f50f7557189e5e46a5b8c0932a76c
- OpenXR loader SHA256: 663f021e6ace3a5624ce1d273d4a2714bf8e42bd595dee4481190ad2aea31f60

## V1 behavior
OBSERVE is diagnostic-only:
- records presenter-frame sequence and parity faults after the OpenXR runtime is loaded
- does not enable protect mode
- does not silently escalate modes
- automatically archives the AER log
- automatically restores the exact public MutaR dxgi.dll after Starfield exits or crashes

## Splash mode ladder
The reusable splash exposes:
- BASELINE
- OBSERVE
- PROTECT
- ADAPTIVE

Traffic light semantics:
- green: available/proven at its current evidence level
- yellow: next mode has enough evidence for a deliberate test
- grey: still locked

After an OBSERVE session, PROTECT becomes yellow only when:
- the AER recorder was active
- rollback completed successfully
- at least 3 presenter-sequence faults were recorded

ADAPTIVE remains locked until PROTECT is separately proven.

## Comfortable control baseline
- VR_AsyncAER=false
- DLSS_AER_Enabled=true
- Meta ASW=Auto
- HAGS off
- NVIDIA 591.86

## Rejected experiments
- Meta ASW off: severe stretching during strafing
- DLSS_AER_Enabled=false: severe discomfort / stereo breakdown
- explicit CreationEngine_MotionVectorFix=true: combing and rotational coloured-particle breakup

These rejected modes are not reused by V1.
