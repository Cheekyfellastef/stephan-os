# Stephanos Lessons Learned (Durable Project Intelligence)

Purpose: convert solved pain into reusable guardrails for future passes.

## 1) Launcher tiles disappeared while diagnostics still rendered (2026-03-27)

- **What happened:** duplicate/late import structure broke launcher-critical module load (`Tile registry entries: 0`) while some secondary diagnostics/laws surfaces still appeared.
- **Why it happened:** import hygiene was treated as style, not runtime safety contract.
- **Missing guardrail/invariant:** strict top-import-only + duplicate import prevention for launcher-critical files.
- **Permanent rule added:** import guard is mandatory (`npm run stephanos:guard:imports` and verify integration).
- **What future passes should remember:** “UI still partially visible” does not imply tile system health.

## 2) Route truth drift from mixed compatibility and canonical fields

- **What happened:** route/provider/operator copy drifted when top-level compatibility fields were used ahead of `finalRouteTruth`.
- **Why it happened:** multiple projections were treated as equivalent truth.
- **Missing guardrail/invariant:** one authoritative runtime route truth with projection adapter.
- **Permanent rule added:** canonical truth is `runtimeStatusModel.finalRouteTruth`; UI reads through `buildFinalRouteTruthView`.
- **What future passes should remember:** compatibility fields exist for transition/diagnostics, not policy decisions.

## 3) Backend-reachable was misread as fully launchable home-node

- **What happened:** systems looked “up” while home-node UI launch path still failed.
- **Why it happened:** backend/API reachability was conflated with UI/client launchability.
- **Missing guardrail/invariant:** two-part launchability truth for home-node paths.
- **Permanent rule added:** route usability requires backend + UI reachability adjudication.
- **What future passes should remember:** never declare route healthy from backend checks alone.

## 4) Hosted sessions inherited localhost assumptions

- **What happened:** remote/hosted sessions used stale loopback/manual state from local sessions.
- **Why it happened:** persisted intent was restored without context-aware normalization.
- **Missing guardrail/invariant:** session-boundary isolation between local and non-local contexts.
- **Permanent rule added:** non-local sessions reject loopback route truth as active target.
- **What future passes should remember:** state portability is conditional; context mismatch must degrade or sanitize.

## 5) Source fixes looked ineffective due to dist/runtime truth drift

- **What happened:** code was fixed in source, but browser behavior remained stale.
- **Why it happened:** source truth, built truth, served truth, and loaded browser truth were conflated.
- **Missing guardrail/invariant:** mandatory build + verify + served marker/source parity gates.
- **Permanent rule added:** stale process reuse is rejected when marker/MIME/source-truth checks fail.
- **What future passes should remember:** do not debug runtime behavior until truth chain is validated.

## 6) Law/policy prose and runtime surfaces can drift silently

- **What happened:** policy lived in multiple docs/UIs and risked divergence.
- **Why it happened:** no single machine-readable constitutional source was treated as authority.
- **Missing guardrail/invariant:** structured law source tied to runtime-rendered panel.
- **Permanent rule added:** `shared/runtime/stephanosLaws.mjs` is authoritative law source with doc/UI linkage.
- **What future passes should remember:** policy changes require synchronized updates across law source, docs, and tests.

## Reusable meta-rules for all future AI/Codex passes

1. Inspect first; do not infer from one surface.
2. Preserve authoritative models and compatibility boundaries.
3. Prefer small, truth-preserving fixes with explicit diagnostics.
4. Add or update guardrail tests whenever invariant-sensitive behavior changes.
5. Document “why this failed before” in durable files, not only PR context.
