# Stephanos Canon (Hard Rules)

These are non-optional guardrails for protected work.

## Source and runtime truth
- `apps/stephanos/dist/**` is generated output, never source truth.
- Launcher shell and Mission Console/runtime responsibilities remain separate.
- Runtime truth/adjudicator outputs remain canonical.
- UI must consume final route truth projections, not ad hoc local truth.

## Provider and route truth boundaries
- Selected, executable, and actual providers remain distinct truths.
- Reachability, usability, and browser compatibility remain distinct truths.

## Pane and Command Deck canon
- `CollapsiblePanel` is pane canon.
- Copy buttons must turn green after successful clipboard write.
- Command Deck composer/input/execute flow is protected canon.
- Answer pane must stay visible, scrollable, and auto-scroll to latest final answer.

## Evidence and proof
- Support Snapshot / UI Reality are evidence surfaces, not decoration.
- Browser proof is required for UI work.

## PR content boundaries
- Source-only PRs must not include generated dist/runtime artifacts, `node_modules`, or secrets.
- PR diff range `origin/main...HEAD` must be clean and reviewable.
