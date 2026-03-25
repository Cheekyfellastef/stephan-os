# Stephanos Runtime Adjudicator

## What this is

`shared/runtime/runtimeAdjudicator.mjs` is the deterministic runtime truth engine for Stephanos.  
It computes one canonical per-session/device runtime truth from the existing route/provider pipeline and emits structured issues for diagnostics and future self-repair planning.

## Inputs it evaluates

- Normalized runtime context (`sessionKind`, `deviceContext`, origin/backend/home-node context).
- Final route decision outputs (`finalRoute`, `finalRouteTruth`, `routeEvaluations`).
- Provider decision outputs (requested/selected/active provider + provider health).
- Route plan + fallback state.
- Guardrail invariant report.

## Runtime Truth output shape

The adjudicator emits `runtimeStatusModel.runtimeTruth` with grouped truth:

- `session`
  - `sessionKind`, `deviceContext`, `localEligible`, `hostedSession`, `nonLocalSession`
- `route`
  - `requestedMode`, `effectiveMode`, `candidates`, `selectedRouteKind`
  - `preferredTarget`, `actualTarget`, `source`, `winningReason`, `fallbackActive`
- `reachabilityTruth`
  - `backendReachable`, `uiReachableState`, `uiReachable`
  - `selectedRouteReachable`, `selectedRouteUsable`
  - `localAvailable`, `homeNodeAvailable`, `cloudAvailable`, `distAvailable`
- `provider`
  - `requestedProvider`, `selectedProvider`, `executableProvider`
  - `providerHealthState`, `providerReason`, `fallbackProviderUsed`
- `diagnostics`
  - `invariantWarnings`, `blockingIssues`, `operatorGuidance`
  - `validationState`, `appLaunchState`

Legacy flat projection fields are still emitted on `runtimeTruth` for compatibility.

## Invariants enforced here

- Hosted/non-local session must never resolve to loopback/localhost actual target.
- Non-local session must never select `local-desktop` route.
- Backend/UI reachability must remain independently adjudicated.
- Selected provider must not be promoted to executable provider unless validated healthy.
- Dist fallback must remain explicitly marked as fallback when active.
- Runtime truth is always recomputed (`computedFromPersistence: false`) and never authoritative persisted core truth.

## Structured issue output

`runtimeStatusModel.runtimeAdjudication.issues` is a normalized issue list:

- `code`
- `severity` (`error` / `warning`)
- `category`
- `message`
- `likelyCause`
- `suggestedAction`
- `details`

This is intentionally deterministic and planner-friendly for future self-repair systems.

## Downstream usage rules

- UI/status/diagnostics should read adjudicated runtime truth and issue outputs.
- Do not recompute route/provider semantics in UI from raw partial fields.
- Do not persist adjudicated runtime truth as durable shared/core truth.
