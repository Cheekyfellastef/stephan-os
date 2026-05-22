# Stephanos Protected Workflow

Use this workflow for Stephanos protected-surface tasks.

## 1) Audit first
- Inspect touched surfaces and identify canonical truth sources before edits.
- Confirm whether task affects launcher shell, Mission Console/runtime, Command Deck, routing, provider truth, or ignition.

## 2) Identify protected surfaces
- Mark any protected UI flows (composer/input/execute, answer pane, pane primitives, copy UX).
- Mark truth boundaries (source/build/serve/browser truth, provider stage distinctions).

## 3) Classify risk
- Low: docs/comments only.
- Medium: source logic with no user-visible UI behavior shift.
- High: routing/provider truth/Command Deck/answer pane/ignition semantics.

## 4) Preserve canon with bounded changes
- Prefer source-only, minimal-scope edits.
- Do not introduce one-off local state models or duplicate surfaces.
- Avoid broad refactors unless explicitly requested.

## 5) Validate appropriately
- Run relevant tests/checks for touched surfaces.
- Run `npm run stephanos:guard:pr-clean`.
- If scripts/package/build flow changed, run `npm run stephanos:build` and `npm run stephanos:verify`.
- For UI behavior changes, require browser proof evidence.

## 6) Report proof honestly
- State what was validated, what was not, and why.
- Do not claim healthy/current/proven status without evidence.

## 7) Add guard on repeated failure patterns
- If similar issue has recurred, add a small guard/check to reduce recurrence.
