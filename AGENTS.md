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

## Anti-native doctrine (non-negotiable)
Do **not** “go native” with local one-off state, pane logic, route logic, provider shortcuts, duplicate surfaces, or isolated telemetry walls. Extend canonical models and shared projections instead.

## Protected Command Deck rules
- Treat composer/input/execute flow as protected surface.
- Preserve answer pane visibility, scrollability, and autoscroll to latest final answer.
- Use pane canon primitives (CollapsiblePanel), not ad hoc replacements.
- Clipboard copy UX must provide success confirmation (green state) after successful write.

## Browser proof + evidence rules
- UI claims require browser proof (not logs only).
- Support Snapshot / UI Reality are evidence surfaces, not decoration.
- Never report healthy/current states without reality proof.

## Ignition + housekeeping direction
- Keep ignition/startup clean, deterministic, and truth-preserving.
- Prefer small guard additions for repeated failure patterns over broad refactors.
- Do not loosen validation to “make it pass.”

## PR hygiene rules
- Default to bounded, source-only changes unless explicitly requested.
- Never stage generated dist/runtime artifacts, `node_modules`, secrets, or root data dumps in source-only PRs.
- PR range must be clean: `origin/main...HEAD`.
- Explain root cause, assumptions, regression risks, and proof.

## Professionalisation clause
Every task should move Stephanos toward production-grade reliability, maintainability, and operator trust—not just local symptom relief.

## Definition of done
A change is done when it:
1. preserves canon/truth boundaries,
2. includes appropriate checks (and browser proof for UI),
3. keeps PR scope clean and reviewable,
4. leaves clear evidence and no hidden side effects.
