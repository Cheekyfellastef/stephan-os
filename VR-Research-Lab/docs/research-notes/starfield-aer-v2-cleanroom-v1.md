# Starfield AER v2 clean-room experiment v1

Issue: #2707

## Purpose

This lane targets the motion-triggered stretching/combing seen in the 2026-10-03 Quest 3 playtest without copying proprietary R.E.A.L. VR code. Luke Ross material is methodology-only. The implementation source is derived only from the permissively licensed Starfield2VR/VRFramework estate already admitted to Stephanos.

## Source lock

- mutars/starfield2vr: `c8a2b200710cdf70db22fd0fcac498cba02da676`
- gsaw0/starfield2vr: `f1ee35d8b202e613cc68854f1321743cba7d54d5`
- gsaw0/vrframework: `46bd25db8985602a6d5db75dd74c2afb0beb244e`
- Stephanos observable stabilizer source: `b25bb9f9bf7f02ec87660a34ce3a2ef129d2fd3d`
- clean-room patch: `VR-Research-Lab/patches/starfield2vr-aer-v2-stereo-history-v1.patch`

## Root-cause candidate

The admitted Starfield2VR renderer keeps one `CameraBlockSnapshot` history per camera-block address. In alternate-eye rendering, consecutive updates belong to opposite stereo eyes, so a single temporal slot can feed left-eye history into the right eye and vice versa. That is a plausible direct mechanism for motion-dependent stereo combing/stretching.

The clean-room v1 patch changes temporal ownership from:

`camera block -> one previous snapshot`

to:

`camera block -> left-eye history + right-eye history`

The active eye is selected from render-loop parity. `resetHistory` seeds only that eye's slot. No frame synthesis, optical flow, proprietary motion-vector reconstruction, or R.E.A.L. VR code is introduced.

## Experimental identity

This patch is **AER_V2_STEREO_HISTORY_V1**. It is not the accepted MutaR baseline and must not silently replace OBSERVE/PROTECT/ADAPTIVE. A locally built DLL must have its own SHA-256, provenance record, rollback baseline, and launch mode before it can be selected for a headset run.

## Required runtime proof before launch

The launcher must bind all of the following to one session:

- current repository head;
- exact MutaR profile SHA-256;
- exact experimental DLL SHA-256;
- provider identity;
- launch session id;
- telemetry session id;
- first-sample proof;
- local-AI parked proof;
- rollback baseline hash.

If the readiness receipt reports a source head different from the repository head executing the launcher, the run is stale and must fail closed.

## Physical acceptance

Source merge is not physical acceptance. A Quest 3 run is required and must record:

- fresh canonical telemetry session with sample count > 0;
- headset refresh and frame pacing;
- per-eye timing/skew and temporal reset evidence where available;
- no silent mono fallback;
- local AI remains parked;
- stretching/combing materially reduced against the 2026-10-03 reference run;
- no return of the coloured rotational breakup;
- exact rollback to the prior accepted route.

A failed experiment must remain useful evidence and must not overwrite the accepted baseline.
