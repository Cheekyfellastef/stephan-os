# Hosted Workspace Hydration Bridge V1

## Purpose

Hosted Stephanos workspaces must be able to hydrate live state from the Battle Bridge backend without learning backend topology, reintroducing localhost assumptions, or creating workspace-specific proxy code.

The hydration bridge extends the existing Hosted Execution Bridge rather than creating a second transport.

## Contract

A hosted workspace asks for hydration by workspace identity and an optional bounded dataset list.

The canonical backend route is:

`GET /api/shared-workspace/hydrate?workspace=<workspace-id>&datasets=<comma-separated-datasets>`

The response is a read-only `stephanos.workspace-hydration.v1` envelope containing independently classified datasets. One failed feed does not hide healthy feeds.

Supported datasets in V1:

- `dashboard`
- `vr-capability`
- `vr-playtest`
- `spatial-telemetry`

Unknown workspaces default to `dashboard` so every hosted workspace has a canonical live-state path. Known VR workspaces receive richer defaults.

## Shell bridge

When a workspace is opened inside the launcher iframe, the shell advertises an on-demand hydration bridge.

A same-origin child can call `requestWorkspaceHydration(...)`. The client first asks the parent shell. The shell validates that the request came from the currently active iframe and that the requested workspace identity matches the active workspace. It then performs the backend request using the existing Hosted Execution Bridge and returns the hydration envelope.

Cross-origin iframes are not given Shared Workspace state.

If a workspace is hosted standalone, the same client falls back to the existing HTTPS hosted execution bridge directly.

## Truth and sovereignty rules

- No hosted surface may fall back to phone, tablet, or browser localhost.
- Backend topology stays in the shell/runtime bridge, not individual workspaces.
- Hydration is read-only.
- Dataset failures remain visible as `partial` or `unavailable`; the bridge does not fabricate green state.
- The backend remains the canonical runtime source. Browser mirrors are not promoted to runtime truth.
- New hydration datasets must be added to the backend allowlist and classified independently.

## Adoption pattern

Workspace code should import `shared/runtime/workspaceHydrationBridge.mjs` and call:

```js
const hydration = await requestWorkspaceHydration({
  workspaceId: 'vr-research-lab',
});
```

The workspace should render from `hydration.datasets` and preserve the dataset state/reason fields in its UI diagnostics.
