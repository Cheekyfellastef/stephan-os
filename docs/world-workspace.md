# World Workspace (v1 prototype)

The World Workspace is a first-class launcher tile and workspace in Stephanos OS.

## Primary entry + compact pane split
- **Primary experience:** landing-page tile (`World Workspace`) opens `apps/world-workspace/index.html`.
- **Secondary companion:** Stephanos Tile world pane remains compact status/control only and is not the main globe surface.

## Current scope
- Semi-realistic 3D globe workspace (rotation + zoom/orbit controls).
- Local illustrative/simulated sample assets with truth fields.
- Layer toggles for Cities, Naval Assets, Air Assets, Infrastructure, Routes, Labels.
- Clickable detail card with representation mode, confidence, freshness, source label.
- Explicit truth banner: demo-only, not live intelligence tracking.

## Three.js loading model (current MVP hardening)
- `apps/world-workspace/index.html` defines a pinned browser import map for `three` and `three/addons/`.
- `apps/world-workspace/world.js` imports `three` and `three/addons/controls/OrbitControls.js` via that map.
- This avoids unresolved bare specifiers in the browser runtime and keeps a consistent, single-version source for both core Three.js and OrbitControls.
- Current ownership remains CDN-backed (pinned URL) and should be treated as MVP-safe, not final dependency ownership.

## Truth policy
This v1 surface **does not** provide live military tracking. Moving military assets are simulated and clearly marked illustrative.

## Future dependency ownership path
- Migrate World Workspace 3D modules to project-managed dependencies (`three` in `package.json`) with a dedicated build/serve path for this app.
- Keep `apps/world-workspace/index.html` launch semantics stable while changing only module ownership behind the scenes.

## Expansion direction
- Richer globe materials, markers, and scene FX.
- Public infrastructure adapters + shared schema integration.
- Weather/satellite overlays.
- Scenario/simulation timeline controls.
- Truth-aware public source ingestion pipelines.
