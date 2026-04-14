# Stephanos Surface Conventions (Style Bible)

This is the shared default for promoted classic-static surfaces that should feel Stephanos-native instead of one-off.

## Mission Console transport + timeout policy

- Mission Console-like surfaces must route AI requests through `queryStephanosAI` (`shared/ai/stephanosClient.mjs`) and backend `/api/ai/chat`.
- Do not add local fetch wrappers with bespoke timeout defaults.
- Runtime context should project canonical timeout fields (`timeoutPolicy`, `timeoutMs`, `timeoutSource`, execution route truth) so request timeout posture matches main Mission Console behavior.

## Mission Console layout parity

- Prompt/input containers should use full available pane width (`width: 100%`, `min-width: 0`) unless a responsive breakpoint requires reduction.
- Prompt regions should inherit the same anchored, full-pane composition as main console surfaces (toolbar + full-width prompt + output body).

## Shared collapsible panel treatment

- Promoted static surfaces should use `initStephanosSurfacePanels` (`shared/runtime/stephanosSurfacePanels.mjs`) for panel shelling/state persistence.
- Collapsible headers should use the shared Stephanos rotating knob + chevron treatment, with clear expanded/collapsed state reflection (`aria-expanded`, icon rotation, persisted state).
- Do not fork local lookalike panel controls when the shared surface-panel helper can be extended instead.
