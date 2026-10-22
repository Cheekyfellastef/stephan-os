# Mutar + Luke Ross source intake — 2026-10-03

Status: provenance-locked research intake wired into the VR Research Lab.

## What is admitted as reusable source

The following repositories are MIT-licensed at the pinned revisions and may be cloned into the ignored local research cache, reviewed, diffed and adapted with attribution:

- `mutars/starfield2vr` @ `c8a2b200710cdf70db22fd0fcac498cba02da676`
- `mutars/anvilengine2vr` @ `bc25bf37932c9f0376c9d6f38ec497d62cb363d2`
- `Alex7722/starfield2vr` @ `e8860ef84368f9b443ca6f16953e3ca05cb32e9f`
- `gsaw0/starfield2vr` @ `f1ee35d8b202e613cc68854f1321743cba7d54d5`
- `gsaw0/vrframework` @ `46bd25db8985602a6d5db75dd74c2afb0beb244e`

The Alex7722 fork is 56 commits ahead of the pinned Mutar master at this intake point. Its changed surface includes Creation Engine camera/aim code, controller motion aiming, weapon calibration, first-person FOV/LOD work, and a git history containing native-stereo/DLSS experiments that were later retired. Treat the history as evidence: failed experiments are useful, but not automatically production candidates.

The gsaw0 pair remains an experimental stability lane. It is valuable because it isolates memory/DLSS lifetime work from the main route. It must still pass the existing Starfield intake and Quest 3 proof gates before runtime promotion.

## Methodology-only sources

These are admitted for public metadata, documentation and independently authored method extraction only:

- `elliotttate/vrframework` @ `751863e2076c9c142553c69a73d159f483b2ab5e` — repository licence is not asserted strongly enough for code reuse.
- `LukeRoss00/gta5-real-mod` @ `00749fc5824e619a54d1ab0a45d9c60160c96f93`
- `LukeRoss00/nolf2-real-mod` @ `b05774555af804749e9c913df262ec7e084ad1da`

The Luke Ross repositories expose public historical documentation, but no reusable root licence. Stephanos therefore extracts methods, not artefacts.

## Luke Ross methods worth carrying into Starfield research

Public R.E.A.L. documentation provides useful comparison points for:

- alternate-eye stereo and the motion/temporal artefacts it creates;
- dynamic stereo handling when camera FOV changes;
- dominant-eye alignment for weapon sighting;
- decoupling head tracking from the game's original aiming/control model;
- universal camera/FOV correction across gameplay and cutscenes;
- recentering as a robust always-available recovery gesture;
- seated gamepad-first operation for long AAA sessions;
- resolution/supersampling and frame-pacing tuning as part of VR correctness;
- preservation of original game interaction while the presentation layer becomes VR.

These are behavioural and architectural references. They do not grant permission to copy the current R.E.A.L. framework.

## Immediate Starfield artefact research order

1. Diff Mutar master against Alex7722, concentrating on eye-state ownership, camera transforms, FOV, motion aim and any stereo experiment commits.
2. Mine the retired stereo/DLSS commit history for failure signatures that match the operator's combing, alternate-eye breakup and coloured-motion particles.
3. Compare those findings with the current AER Observe specialist telemetry so each visual symptom maps to a concrete render-stage hypothesis.
4. Diff the gsaw0 stability pair against Mutar for allocation lifetime and temporal-resource ownership.
5. Cross-check Luke Ross public alternate-eye methodology for frame pacing, camera motion, dominant-eye and temporal-history hypotheses.
6. Promote only minimal, reversible changes into the live Mutar route and prove each on Quest 3 over the verified launch path.

## Local source hydration

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sync-vr-reference-sources.ps1
```

This hydrates only licence-approved reusable source into `VR-Research-Lab/internal/reference-sources`, which is ignored by git.

Use `-IncludeAnalysisOnly` only to enumerate the blocked/reference-only entries. The script deliberately refuses to turn NOASSERTION/proprietary sources into reusable project code.

## Promotion boundary

Source availability is not runtime approval. The current Starfield route remains authoritative until a candidate passes exact-version, diff-review, Battle Bridge, Quest 3 and rollback proof.
