# Route Truth Audit

## Purpose
Fast workflow for diagnosing route/provider truth drift without collapsing launcher/runtime boundaries.

## When to use
- Route labels disagree with executed behavior.
- Hosted session appears to use localhost assumptions.
- Home-node/backend looks healthy but launch still fails.

## Inspect in this order
1. `shared/runtime/stephanosLaws.mjs` (law IDs relevant to routing/runtime/build truth).
2. `shared/runtime/runtimeStatusModel.mjs` and `shared/runtime/runtimeAdjudicator.mjs`.
3. `stephanos-ui/src/state/finalRouteTruthView.js` and route truth consumers.
4. `system/apps/app_validator.js` + launch path files (`modules/command-deck/command-deck.js`, `system/workspace.js`).
5. `scripts/verify-stephanos-dist.mjs` + `scripts/serve-stephanos-dist.mjs` when stale-truth symptoms appear.

## Diagnostic questions
- What is the canonical `finalRouteTruth`, and does UI render from it?
- Is session context local vs non-local, and were loopback values sanitized?
- Are requested/selected/executable provider stages distinct in both data and labels?
- Is fallback explicitly marked when active?
- Are source/build/served markers consistent?

## Common traps
- Treating `entry` or legacy compatibility fields as authoritative.
- Assuming backend reachability implies launchable route/provider semantics.
- Debugging UI without validating dist/runtime freshness.

## Expected outputs
- One confirmed root cause with affected truth layer(s).
- Minimal fix direction that preserves existing architecture.
- Regression test targets and guardrail updates needed.
