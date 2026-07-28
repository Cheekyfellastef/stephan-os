# Stephanos OS — Project Intent Pack (Codex Guardrails)

Stephanos is a launcher-shell + runtime system with strict truth boundaries. Read this first, then any task-specific docs.

## Stephanos OS North Star
Build a persistent, cross-device human+AI mission operating system that preserves operator intent, reduces cognitive load, enforces architectural canon, verifies reality, and compounds professional quality over time.

## Roles
- **Operator:** sets mission intent, approves direction, defines quality bar.
- **Codex:** executes bounded changes that preserve canon/truth, proves outcomes, avoids local symptom-only fixes.
- **OpenClaw/Harness direction:** evolve toward approval-gated orchestration where Codex/OpenClaw/future agents run through shared truth + evidence contracts.

## Architecture canon (must preserve)
- Launcher shell (`/`) and Mission Console/runtime remain separate responsibilities.
- Keep `launchEntry`, `runtimeEntry`, `launcherEntry` distinct (`entry` is compatibility fallback only).
- Dist (`apps/stephanos/dist/**`) is generated output, never source truth.
- Runtime adjudication/truth systems remain canonical; UI consumes final projected truth.
- Keep provider intent/selected/executable/actual truths distinct.
- Keep reachability/usability/browser compatibility truths distinct.

## Canonical-adapter doctrine
- Do not create local one-off state, pane logic, route logic, provider shortcuts, duplicate authority surfaces, or isolated telemetry walls.
- Platform-specific adapters are allowed when they derive from canonical shared state, remain replaceable, publish bounded receipts, and cannot become an independent source of truth.
- Extend canonical models and shared projections whenever behaviour or authority must be reused across surfaces.

## Rule application and risk tiers
Apply rules to the authority surface actually affected; do not impose high-risk ceremony on unrelated low-risk work.

- **Constitutional rules always remain hard:** no fabricated proof, secret exposure, destructive Git, arbitrary command/filesystem authority, duplicate mutating lanes, silent authority expansion, or merge/deployment outside required approval gates.
- **Authority-bearing evidence fails closed:** identity, issue/PR/branch/head binding, approval, dependency completion, execution route, lease ownership, review/check status, proof, deployment state, runtime state, security policy, and spending authority.
- **Advisory evidence degrades safely:** labels, descriptions, presentation metadata, optional summaries, and non-authoritative decoration may become `UNKNOWN` or warning-bearing without stopping unrelated scheduling.
- **Low risk:** documentation, fixtures, test-only changes, and non-authoritative presentation metadata. Require focused deterministic proof and exact-head delta verification.
- **Standard risk:** ordinary source logic and shared projections. Require relevant complete tests and independent exact-head review.
- **High risk:** security, approval, controller authority, credentials, runtime mutation, deployment, provider switching, spending, and destructive capability. Require specialist review, complete exact-head proof, and all operator gates.
- Exact-head operator merge approval remains required unless a separately implemented, proven, and explicitly authorised standing-authority envelope says otherwise.

## Protected Command Deck rules
- Treat composer/input/execute flow as protected surface.
- Preserve answer pane visibility, scrollability, and autoscroll to latest final answer.
- Use pane canon primitives (CollapsiblePanel), not ad hoc replacements.
- Clipboard copy UX must provide success confirmation (green state) after successful write.

## Browser proof + evidence rules
- Require browser proof when a change affects browser-visible behaviour, interaction, visual truth, served-state claims, or UI/runtime integration.
- Do not require browser proof for documentation, test-only work, internal source validation, or backend logic that does not change browser behaviour.
- Support Snapshot / UI Reality are evidence surfaces, not decoration.
- Never report healthy/current authority-bearing states without reality proof.

## Ignition + convergence direction
- Keep ignition/startup clean, deterministic, and truth-preserving.
- Prefer the smallest **systemic** correction, not the smallest textual patch.
- First repair: fix the bounded defect and add a regression.
- Second related repair: strengthen the shared invariant/state model and adversarial tests.
- Third current-head P1/P2 repair round in the same invariant class: stop narrow guard accumulation and perform structural design review before another patch.
- Repeated invariant failures must produce model/property tests or an explicit architectural debt record.
- Do not loosen validation to “make it pass.”

## Human–AI Flywheel closure
- Every completed **programme goal** must deliver the requested result, add or confirm a reusable capability, and publish a new shared lesson/invariant or explicitly reference an existing applicable lesson.
- Child commits, fixture repairs, comments, and bounded sub-tasks may contribute to the parent goal outputs; they do not need to invent artificial capabilities or lessons individually.
- A goal with abnormal repair churn is not complete until its systemic lesson and convergence evidence are durable.

## PR hygiene rules
- Default to bounded, source-only changes unless explicitly requested.
- Never stage generated dist/runtime artifacts, `node_modules`, secrets, or root data dumps in source-only PRs.
- PR range must be clean: `origin/main...HEAD`.
- Explain root cause, assumptions, regression risks, applicable risk tier, and proof.

## Professionalisation clause
- Every programme goal must preserve or improve production-grade reliability, maintainability, operator trust, and reusable capability.
- Individual bounded repairs should remain narrow when they contribute to a proven goal-level outcome; do not gold-plate or expand scope merely to appear comprehensive.

## Definition of done
A change is done when it:
1. preserves canon/truth boundaries,
2. satisfies the proof required by its affected risk and authority surfaces,
3. keeps PR scope clean and reviewable,
4. leaves clear evidence and no hidden side effects,
5. contributes to the parent goal’s result/capability/lesson contract or explicitly records bounded debt.
