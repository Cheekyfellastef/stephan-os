# Starfield VR Splash Windows Specialist V1

## Purpose

Provide the single bounded Windows-authority specialist required by PR #2050, `Add polished Starfield VR launch splash`, after the canonical independent security review escalated exactly two high-risk PowerShell surfaces as `unsupported-high-risk-surface`.

## Exact owned surfaces

- `scripts/windows/install-starfield-vr-desktop-shortcut.ps1`
- `scripts/windows/launch-starfield-vr-with-splash.ps1`

The specialist is eligible only when the independent review contains exactly those two P0 escalation markers and exact-head immutable source evidence contains exactly those two files.

## Contract

The reviewer requires the shortcut installer to remain current-user, ShouldProcess-gated, fixed-PowerShell and routed through the singular `Starfield VR.lnk` splash path. It rejects elevation, network/download authority, scheduled-task authority, destructive/source Git mutation and direct game-launch authority.

The splash reviewer requires presentation-only delegation to the existing canonical `launch-starfield-vr.ps1`, fixed Windows PowerShell child execution, readiness-first gating on `STARFIELD_VR_LAUNCH_READY`, fail-closed flat-Starfield wording and progressive sanitized blocker details. It rejects downloads/install/config mutation, direct game launch, elevation, scheduled-task construction and destructive/source Git mutation.

## Composition

The existing `windowsAuthoritySpecialistReviewV1.mjs` wrapper pins this reviewer by exact Git blob and routes it before the historical fallback. Existing Forge WSL2 and mailbox-cadence specialist routing is retained unchanged.

## Authority boundary

This is review governance only. It grants no source mutation, ready transition, merge, deployment, Windows runtime mutation, game launch, headset action, provider qualification, credentials, spending or arbitrary command authority.

## Acceptance

After protected admission of this specialist bootstrap, PR #2050 must receive a fresh exact-head provider-neutral independent review on its unchanged three-file product estate. Only a genuine clean specialist-composed exact-head artifact plus zero review threads may advance #2050 to the operator-authorized apron/merge path.
