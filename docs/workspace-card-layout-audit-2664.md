# Workspace card-layout audit: bounded R1/R5 tooling for #2664

Parent: #2664 — Mission: Stephanos workspace card text integrity sweep.
Task key: `codex-2664-card-layout-audit-20261028`.
Sole manual-source owner: `01a1849f-a069-7281-be3e-5171d5802740`.
Reserved branch: `codex/2664-card-layout-audit-20261028`.
Inventory baseline: `86e372e88e7ec4560f754db6df659cc95e3fb47f` (28 October 2026).

This child task adds a reusable read-only geometry oracle and a source-derived starting inventory. It does not repair app CSS/components, prove the reported Agents defect, complete R1/R5 acceptance, move the goal traffic lights, or close the parent. No UI build, runtime installation, source lease, Forge recovery, Seed, Island, controller or service is changed. Independent exact-head review, protected ready, operator merge and runtime gates remain separate.

## Contract and evidence

`tests/workspace-card-layout-audit.test.mjs` exports two closure-free functions:

- `extractCardLayout(options)` reads the current document and serializes plain card, text-fragment, badge, control and nested-card rectangles in CSS viewport pixels. It makes no DOM/state writes, clicks, fetches or scroll changes.
- `auditCardLayout(snapshot, { tolerance: 1 })` evaluates that snapshot without mutating it. It reports `ESCAPE_X/Y`, `CLIPPED_X/Y` and `COLLISION` findings with card/item identities. A tolerance must be finite and between 0 and 4 CSS pixels. Keep the 1px default unless documented device-specific rounding evidence justifies another value.

An empty selection has coverage `EMPTY`, never a passing workspace. A measured selection is `MEASURED`, never a runtime-health or whole-workspace verdict. Coordinates are axis-aligned rectangles; rotated/skewed geometry needs visual review.

All card/item geometry includes explicit nonempty `rects` containing nonzero paint fragments. Manually constructed snapshots must also provide these fragments; a single box is expressed as `[rect]`. Missing, null, empty or entirely degenerate geometry fails closed. Union `rect` values provide broad bounds; they are never substituted for missing painted fragments.

One shared extractor geometry normalizer reads actual `Element.getClientRects()` and `Range.getClientRects()` for controls, badges, nested cards, card boundaries and text. One border-box item builder applies ancestor-only clipping to all box kinds; text retains content self-clipping. Wrapped controls and badges therefore leave the empty corner beside a short final line unpainted, just like wrapped text. Distinct text labels still collide, even if they share a control. A control/badge box may contain its own label. The nearest selected card owns its content; a nested card is also checked as an outer-boundary item of its immediate parent. Use an explicit card selector that includes both outer and inner primitives.

Control, badge and nested-card rectangles measure border boxes. Their clip chains start at the parent because overflow clips contents, not the element's own border. Text fragments measure contents and retain their originating element's client clip. This distinction preserves real ancestor clipping without treating a 1px or 2px border as lost content.

Computed `overflow: hidden/clip` is not an exemption. The extractor carries the actual ancestor client clip boxes, excluding borders/scrollbars. Ellipsis is recognized only for a text node's own element with `text-overflow: ellipsis`, `white-space: nowrap`, and a `title` equal to its complete normalized text. A nearby tooltip, unrelated title, or aria-label alone cannot waive clipping. This narrow detection is conservative: inspect custom expansion/tooltips separately rather than adding a blanket allow-list.

Actual `auto/scroll` clipping produces `SCROLL_REQUIRES_INTERACTION_PROOF` affordances for the affected axis only. It never waives a different hidden ancestor, orthogonal escape or visible collision. Ellipsis produces `ELLIPSIS_FULL_VALUE` affordances. Both stay in the report; later keyboard/pointer testing must prove access to the full content. Ellipsis never excuses vertical clipping.

The source module conditionally loads Node's test runner only in Node. Browser imports have no Node dependency; either exported function can also be serialized independently for evaluate. The deterministic DOM double exercises that serialization and DOM API usage; it is not a browser layout engine.

## Source-derived selector/workspace inventory

These selectors were read from source at the baseline above. They identify specimens to measure, not evidence that a served route exists or is healthy. Set the root to the selected workspace to avoid combining inactive surfaces. A selector matching zero cards requires investigation.

| Surface | Source evidence | Card selector / boundary |
| --- | --- | --- |
| Launcher landing tiles | `main.js` renders and inspects the landing registry; `index.html` defines workspace chrome | `.app-tile`; launcher cards are distinct from runtime panes |
| Launcher diagnostics / companion panels | `index.html` | `.runtime-strip-card,.companion-deck-card,.runtime-diagnostics-card,.stephanos-law-card` |
| Agents | `stephanos-ui/src/components/AgentsWorkspaceCanvas.jsx` | root `[data-testid="agents-uplift-workspace"]`; cards `.uplift-deck-card,.uplift-stat-deck > article,.agent-uplift-queue-card,.agent-constellation-card,.agent-gap-card` |
| Agents compact tile | `stephanos-ui/src/components/AgentsTile.jsx` | audit its shared pane boundary as well as expanded Agents cards |
| Flywheel | `stephanos-ui/src/components/FlywheelWorkspaceCanvas.jsx` | root `[data-testid="flywheel-uplift-workspace"]`; cards `.uplift-deck-card,.uplift-stat-deck > article,.outcome-seed-truth-grid > article`; include heatmap/timeline visual inspection |
| Flywheel Seed Canopy | `stephanos-ui/src/components/FlywheelSeedCanopy.jsx` and its CSS | root `[data-testid="flywheel-seed-canopy"]`; `.seed-canopy__card` |
| Shared runtime panes / Mission Console | `stephanos-ui/src/components/CollapsiblePanel.jsx`, `StephanosSurfacePane.jsx`, `stephanos-ui/src/App.jsx` | `.collapsible-panel`; inspect `.panel-header-row,.panel-heading-copy,.panel-header-actions,.panel-body` and protected composer/answer behavior manually |
| Mission / goal / controller feed | `stephanos-ui/src/components/MissionOperationsPanel.jsx` | `[data-testid="mission-operations-item"],[data-testid="mission-control-live-projection"],[data-testid="build-concierge-panel"]`; do not reinterpret displayed claims as authority |
| Capability Radar | `stephanos-ui/src/components/CapabilityRadarTile.jsx` | `.capability-radar-card` |
| Skill Forge / uplift | `stephanos-ui/src/components/SkillForgeTile.jsx` and `SkillForgeObservatory.css` | root `[data-testid="skill-forge-observatory"]`; `.skill-panel,.skill-agent-card,.skill-blueprint-card` |
| Shared proof index | `stephanos-ui/src/components/SharedWorkspaceProofIndex.jsx` and its CSS | `[data-testid="shared-workspace-proof-index"],.shared-proof-index__entries > li` |
| Cockpit projection | `stephanos-ui/src/state/cockpitProjection.js` | `.cockpit-shortcut-card,[data-cockpit-block="detail-card"]`; audit expanded and compact separately |
| Graph / conversation cards | `GraphNodeCard.jsx`, `GraphStatsCard.jsx`, `ConversationCanvasCard.jsx` under the same component directory | `.graph-card,.conversation-canvas-card` |
| Stephanos AI separate app | `apps/stephanos-ai/index.html`, `workspace.js`, `workspace.css` | `.context-card,.message`; inspect the agent-list and action-grid buttons as additional card candidates |
| World Workspace | `apps/world-workspace/index.html`, `world.css`; runtime tile `WorldWorkspaceTile.jsx` | separate app `.detail-card`; runtime `.tile-card` |
| VR Research Lab | `apps/vr-research-lab/index.html` generates `.card` and defines collapsible panels | `.panel,.card`; include dynamically populated targets, techniques, experiments, watcher and answer panel |
| VR Capability Atlas | `apps/vr-capability-atlas/index.html` | `.card`, including `#outcomes,#sources,#methodsGrid` descendants; badges `.badge,.status` need explicit badge selector extension |
| Starfield VR Reference Lab | `apps/starfield-vr-reference-lab/reference-lab.js` | `.reference-card` (button cards, with `data-reference-id`); inspect detail/telemetry surfaces separately |
| VR Link | `apps/vr-link/index.html` | source confirms navigation `a.button`; card classification remains pending served inspection; do not invent `.card` coverage |
| Gaming telemetry | `stephanos-ui/src/components/GamingResourceTile.jsx` uses shared pane structure and summary/filter sections | shared `.collapsible-panel`; source and served telemetry remain separate truths |

Shared styles to inspect before future repairs: `stephanos-ui/src/styles.css` (pane/header and uplift/Agents/card rules), `shared/styles/stephanos-panels.css`, plus the component/app-specific CSS named above. This tool introduces no competing card primitive.

The baseline Git tree also contains app manifests for agents, capability-radar, cockpit, experimental, flywheel, galaxians, goal-dashboard, ideas, mission-console, music-tile, openclaw, skill-forge, spatial-bridge, starfield-vr-reference-lab, stephanos-ai, stephanos, vr-capability-atlas, vr-link, vr-research-lab, wealth-simulation-scenarios, wealthapp and world-workspace. Manifest existence is not active launcher admission. The remaining app-specific card variants and dynamically discovered projects require served inventory; this table must not be called an exhaustive R1 sweep.

`system/workspace.js` owns workspace opening and iframe creation; `system/apps/entry_rules.js` owns entry resolution. Preserve `launchEntry`, `runtimeEntry` and `launcherEntry` distinctions. Do not infer served inventory from generated `apps/stephanos/dist` or the small legacy `projects_registry.json` alone.

Re-derive inventory after source moves (read-only commands from repository root):

```powershell
git rev-parse HEAD
rg --files apps -g app.json
rg -n 'className|data-testid|data-agent-id' stephanos-ui/src/components/AgentsWorkspaceCanvas.jsx stephanos-ui/src/components/FlywheelWorkspaceCanvas.jsx
rg -n 'card|tile|panel' stephanos-ui/src/styles.css shared/styles/stephanos-panels.css
rg -n 'card|badge|pill|chip' apps/vr-research-lab/index.html apps/vr-capability-atlas/index.html apps/starfield-vr-reference-lab/reference-lab.js
rg -n 'launchEntry|runtimeEntry|launcherEntry|iframe' system/workspace.js system/apps/entry_rules.js
node --test tests/workspace-card-layout-audit.test.mjs
```

## Later responsive browser proof: exact usage

Use a separate approved QA checkout/output directory containing the exact reviewed test bytes. Do not build or alter the shared Battle Bridge checkout to run this oracle. No browser proof was executed by this child task.

In an already authorized browser automation session, import the module on the Node side and pass the extractor itself to Playwright evaluate (closure-free; no module serving, CSP bypass, global injection or local HTTP server needed):

```js
import { auditCardLayout, extractCardLayout } from './tests/workspace-card-layout-audit.test.mjs';
import { writeFile } from 'node:fs/promises';

// page/frame must already point at the intended served workspace.
// Do not call navigation/activation as part of the read-only extractor.
const snapshot = await page.evaluate(extractCardLayout, {
  rootSelector: '[data-testid="agents-uplift-workspace"]',
  cardSelector: '.uplift-deck-card,.uplift-stat-deck > article,.agent-uplift-queue-card,.agent-constellation-card,.agent-gap-card',
});
const report = auditCardLayout(snapshot);
await writeFile('agents-1920x1080.json', JSON.stringify({ snapshot, report }, null, 2));
console.log({ coverage: report.coverage, cards: report.cardCount,
  findings: report.findings, affordances: report.affordances });
```

Importing this `.test.mjs` in Node also registers its deterministic tests. For a browser-side import in a QA origin that already serves the exact file as JavaScript with an allowed MIME type:

```js
const { extractCardLayout, auditCardLayout } =
  await import('/tests/workspace-card-layout-audit.test.mjs');
const snapshot = extractCardLayout({ cardSelector: '.reference-card' });
const report = auditCardLayout(snapshot);
console.log({ snapshot, report });
```

Do not assume the production server exposes `/tests`; use evaluate when it does not. Both functions are independent; if needed serialize `extractCardLayout.toString()` to an existing browser evaluator with its ordinary argument handling. Do not interpolate selectors or page text into executable source.

For iframe workspaces use the selected frame's `frame.evaluate(extractCardLayout, options)`. A top-level audit does not cross iframe boundaries. Shadow DOM, canvas/WebGL/VR headset UI, pseudo-elements, input values, complex transforms, font legibility, z-index occlusion and visual contrast require separate inspection. Cards outside a clipped scroll viewport must be visited through approved interactions; a single extraction cannot prove their readability.

Collect later proof for every inventoried workspace/variant at:

1. The actual Battle Bridge window size that reproduces the reported Agents issue (record actual CSS viewport, zoom and device-pixel ratio).
2. 1920 x 1080.
3. 2560 x 1440.
4. A supported narrower desktop/tablet width (record dimensions and why supported).

At each size, wait for fonts/data and stable layout; record served build/head identity independently, workspace route/frame URL, timestamp, selector and matched count, expanded/collapsed state, JSON findings/affordances and screenshots. Recheck after resize and the normal interactions that reveal additional cards. Exercise long names, 40-character hashes, large IDs/proof counts and truthful UNKNOWN / STALE / UNREACHABLE content using an approved fixture surface, not writes to canonical state.

Inspect every finding, every intentional affordance and all zero-match selections. Verify keyboard focus, hit targets, full-value access, scroll reachability, protected answer visibility/scroll/autoscroll and composer behavior separately. Never waive a finding solely because it is inconvenient or add global overflow hiding to make the audit quiet.

## Verification and durable lesson

Focused command: `node --test tests/workspace-card-layout-audit.test.mjs`.
The 43 deterministic cases cover malformed/empty evidence, wrapped line fragments, four-edge escape and fractional tolerance, long title/status/hash clipping, genuine ellipsis/full-value evidence, axis-specific scroll, adversarial ancestor clipping, badge/control/text collisions, own-label exemptions, nested boundaries, translation invariance/immutability, serialized extractor usage/hidden ancestors, bordered control/badge/nested-card boxes at 0px and 1px tolerance, true ancestor clipping, originating-element text clipping, cross-kind wrapped paint fragments, real collisions in each line, missing/degenerate geometry rejection, and 240 translated/tolerance model cases.

Lesson/invariant: clipping CSS is evidence to inspect, not proof of intentional truncation; retain affordance debt and nearest-card ownership so nested or scrollable layouts cannot hide genuine defects. This supports the parent goal's reusable R5 capability without claiming visual acceptance.

Low-risk scope: one test module and this inventory document. Regression risks: conservative false positives for custom truncation/complex transforms, incomplete selectors and unvisited dynamic content. Unit tests prove the oracle's deterministic behavior only. Source publication, CI, independent review, protected merge, exact-head installation and responsive visual acceptance must each have their own receipt.

## First geometry review repair

Independent review identified false self-clipping of bordered controls, badges and nested cards. The original helper at `b05bff4cec700144bf1ab47fb46ebe2dc7ffc514` fails nine new border/tolerance regressions; all three real-ancestor clipping cases and the originating-text clip case remain required. The repair changes clip-chain origin by measurement kind, preserving the default 1px tolerance and all existing tests. Review finding: https://github.com/Cheekyfellastef/stephan-os/pull/3307#discussion_r4406950263 . Source repair is not independent review approval, merge approval or UI acceptance.

## Second geometry review repair and convergence rule

Review https://github.com/Cheekyfellastef/stephan-os/pull/3307#discussion_r4407011433 identified that wrapped inline controls were measured by their union box while text already used line fragments. The systemic correction makes actual nonzero client fragments mandatory for every measurement kind, through one extractor normalizer and one shared border-box item builder. There is no link-specific exemption and no union fallback for unavailable geometry. The first repair's parent-only border-box clipping and originating-text clipping remain binding.

The deterministic DOM double implements the actual element `getClientRects()` API. The cross-kind model covers controls, badges, nested cards and text, unrelated control/badge/text siblings in the empty short-line corner, real intersections in either painted line, clipping of one fragment, own-label versus sibling-label behavior, and 240 coordinate-translation/tolerance variants. All previous 26 tests remain. On the preceding published helper at `e848c292af8f5ac7b5f9a3af15c4e863170cadf5`, the expanded suite has 11 failures; the normalized model must pass all 43 tests.

Durable invariant: paint fragments and clip ownership travel with geometry; a union box is not proof of paint. This is the second current-head repair in the same geometry class. If a third current-head P1/P2 in that class is found, stop narrow source patches and perform an explicit structural design review before editing, as required by AGENTS.md. Neither this lesson nor green tests grant independent review, merge, runtime or UI acceptance authority.
