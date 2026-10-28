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

DOM measurements distinguish three states: PAINTED retains actual nonzero client fragments; VALID_UNPAINTED is a successful empty/all-zero fragment list with compatible degenerate union bounds and is omitted; INVALID_UNAVAILABLE includes missing/throwing APIs, malformed coordinates and contradictory bounds/fragments and remains an error. Union `rect` values provide broad bounds, never a fallback for unavailable DOM paint geometry. Manually declared single-rectangle snapshots remain supported; optional fragment arrays are validated when supplied.

One shared extractor geometry normalizer reads actual `Element.getClientRects()` and `Range.getClientRects()` for controls, badges, nested cards, card boundaries and text. One border-box item builder applies ancestor-only clipping to all box kinds; text retains content self-clipping. Wrapped controls and badges therefore leave the empty corner beside a short final line unpainted, just like wrapped text. Distinct text labels still collide, even if they share a control. A control/badge box may contain its own label. The nearest selected associated card box owns its content even when its own visibility is hidden; a nested card is checked as an outer-boundary item of its immediate parent only when its own box is visible. Use an explicit card selector that includes both outer and inner primitives.

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
The 84 deterministic cases cover malformed/empty evidence, wrapped line fragments, four-edge escape and fractional tolerance, long title/status/hash clipping, genuine ellipsis/full-value evidence, axis-specific scroll, adversarial ancestor clipping, badge/control/text collisions, own-label exemptions, nested boundaries, translation invariance/immutability, serialized extractor usage/hidden ancestors, bordered control/badge/nested-card boxes at 0px and 1px tolerance, true ancestor clipping, originating-element text clipping, cross-kind wrapped paint fragments, real collisions in each line, malformed/contradictory geometry rejection, valid unpainted formatting ranges and boxes, boxless-wrapper descendants, preserved manual inputs, 288 translated/tolerance model cases, and paired clip-applicability cases for boxless, inline, zero-sized and qualified block/flex/grid layouts.

Lesson/invariant: clipping CSS is evidence to inspect, not proof of intentional truncation; retain affordance debt and nearest-card ownership so nested or scrollable layouts cannot hide genuine defects. This supports the parent goal's reusable R5 capability without claiming visual acceptance.

Low-risk scope: one test module and this inventory document. Regression risks: conservative false positives for custom truncation/complex transforms, incomplete selectors and unvisited dynamic content. Unit tests prove the oracle's deterministic behavior only. Source publication, CI, independent review, protected merge, exact-head installation and responsive visual acceptance must each have their own receipt.

## First geometry review repair

Independent review identified false self-clipping of bordered controls, badges and nested cards. The original helper at `b05bff4cec700144bf1ab47fb46ebe2dc7ffc514` fails nine new border/tolerance regressions; all three real-ancestor clipping cases and the originating-text clip case remain required. The repair changes clip-chain origin by measurement kind, preserving the default 1px tolerance and all existing tests. Review finding: https://github.com/Cheekyfellastef/stephan-os/pull/3307#discussion_r4406950263 . Source repair is not independent review approval, merge approval or UI acceptance.

## Second geometry review repair and convergence rule

Review https://github.com/Cheekyfellastef/stephan-os/pull/3307#discussion_r4407011433 identified that wrapped inline controls were measured by their union box while text already used line fragments. The second repair preserved actual client fragments through one extractor normalizer and one shared border-box item builder. It incorrectly treated valid unpainted measurements as errors; the structural review below corrects that model. There is no link-specific exemption and no union fallback for unavailable DOM geometry. The first repair's parent-only border-box clipping and originating-text clipping remain binding.

The deterministic DOM double implements the actual element `getClientRects()` API. The cross-kind model covers controls, badges, nested cards and text, unrelated control/badge/text siblings in the empty short-line corner, real intersections in either painted line, clipping of one fragment, own-label versus sibling-label behavior, and 240 coordinate-translation/tolerance variants. All previous 26 tests remain. On the preceding published helper at `e848c292af8f5ac7b5f9a3af15c4e863170cadf5`, the expanded suite has 11 failures; the normalized model must pass all 43 tests.

Durable invariant: paint fragments and clip ownership travel with geometry; a union box is not proof of paint. This is the second current-head repair in the same geometry class. If a third current-head P1/P2 in that class is found, stop narrow source patches and perform an explicit structural design review before editing, as required by AGENTS.md. Neither this lesson nor green tests grant independent review, merge, runtime or UI acceptance authority.

## Third published-head finding: structural design review and agreed model

Independent convergence review of published head `e1fa8dfb34c5550eeb88a352ee84967c6287a17d` (test blob `f9eeb62e01490c4c0a11aef7af6326df2fe8a875`, SHA-256 `377613b6f7087715495328939735729a26957026a245de91c91be90ae57eb20d`) found that successfully measured nonpainting text could abort the whole extraction. A standalone soft hyphen, zero-width space or formatting mark can yield zero-area Range geometry; the previous helper omitted it, while that head threw. Its 43 passing tests had conflated valid unpainted results with malformed evidence. This was a third published-head geometry P2, so narrow source patching stopped and an independent structural design review completed before the correction.

The agreed Element-and-Range state model is:

| State | Evidence | Behavior |
| --- | --- | --- |
| PAINTED | Successful APIs; finite ordered bounds/fragments; nonzero union and actual client fragments | Retain nonzero fragments and audit them; box items clip from parent, text retains its originating element clip |
| VALID_UNPAINTED | Successful APIs; empty/all-zero actual client fragments with compatible degenerate union bounds | Omit the painted item, continue other content, and count only painted item records |
| INVALID_UNAVAILABLE | Missing/throwing APIs, malformed/nonfinite/inverted coordinates, or positive bounds paired with empty fragments (or the reverse) | Explicit error; no union fallback, character ignore list or tolerance waiver |

The [CSSOM View Range geometry algorithm](https://drafts.csswg.org/cssom-view/#dom-range-getboundingclientrect) includes empty and zero-area results. This is a geometry-state distinction, not a special exemption for particular characters. The extractor caches card geometry before ownership projection; boxless cards cannot become painted boundaries, and boxless controls/badges cannot hide painted descendant text or suppress genuine sibling collisions. A selection containing only unpainted cards/items has EMPTY coverage. The existing manual single-rectangle snapshot contract remains supported; exact union equality is not imposed on manual inputs.

The structural regression suite retains prior border, wrapped-fragment, real-collision, ancestor-clip and label tests. It adds SHY/ZWSP/formatting ranges alone and mixed with painted collisions, equivalent Element states, malformed/throwing APIs, contradictory positive/empty measurements, boxless wrapper descendants, manual-input continuity, and invariance under translation or addition of remote unpainted geometry. There are 53 deterministic tests and 288 translated/tolerance model cases. The expanded suite has seven failures against the published helper; the corrected model must pass all 53. Deterministic DOM doubles remain distinct from real-browser acceptance.

Durable convergence lesson: absence of paint, absence of measurement and invalid measurement are different states. Preserve paint fragments and clip ownership without turning valid nonpainting content into a failure, or missing evidence into healthy geometry. The structural review, red/green proof, independent exact-head review and later operator gate remain separate evidence. No parent-goal completion or UI/runtime fix is claimed.

## Structural clip applicability refinement before publication

Internal review of the unpublished 53-test candidate found that a boxless wrapper could still invent a zero client clip. Paint presence, associated boxes and overflow applicability are separate facts. The refined structural contract was independently reviewed before implementation; no extra source publication or external-review request was made for that intermediate candidate.

| Ancestor evidence | Overflow-clip projection |
| --- | --- |
| `display:contents`, `display:none`, or no associated box | No clip from that element; continue to later ancestors |
| Ordinary non-replaced HTML `inline` / `inline flow` | No overflow clip; zero clientWidth/clientHeight is normal and is not used to infer clipping |
| Qualified block, flow-root, inline-block, flex, inline-flex, grid, inline-grid and their supported two-keyword forms | Apply the declared client-box clip even when its width or height is zero |
| Table/native-form/replaced/SVG/other unqualified layout with active non-visible overflow | Explicit unsupported overflow-clip error; do not invent a clip or silently call it healthy |
| Unqualified layout with visible overflow | No clipping operation to project |

The shared normalizer retains actual raw client-rectangle presence separately from positive-area paint fragments. Therefore a genuine zero-width block remains an associated clipping box, while a boxless wrapper does not. A later genuine clipping ancestor remains effective beyond an ineligible wrapper. Border-box items still start their chain at the parent and text still includes its own eligible content clip; there is no blanket skip for unpainted ancestors.

This bounded qualification follows [CSS Overflow applicability](https://drafts.csswg.org/css-overflow-3/#overflow-properties), [CSSOM View client dimensions](https://drafts.csswg.org/cssom-view/#dom-element-clientwidth) and [CSS Display box generation](https://drafts.csswg.org/css-display/#box-generation). It does not implement all native, table, SVG, replaced-element or fragmented-layout clipping behavior. Unsupported active clipping remains outside the automatic proof contract and requires qualified visual/browser evidence or an explicit subsequent capability extension.

Paired regressions cover contents versus real zero-width/height block clips, normal inline versus inline-block, all supported shorthand/two-keyword equivalences, contained and clipped block/flex/grid variants, explicit unqualified-active failures, visible-overflow neutrality, and genuine clipping beyond ineligible wrappers. The suite has 61 tests; four of the expanded tests fail against the frozen preceding candidate, and the refined candidate must pass all 61. The border-box regression uses a non-replaced anchor control within the qualified clipping domain; native active clipping is independently tested as unsupported. This preserves the earlier geometric invariant without silently claiming native clipping coverage.

Internal exact-byte verification and the focused read-only structural review are complete for source SHA-256 `38d712a549eae8ae127addca510620ac9816f34f9b207398fe4f2b20e6285b43`; the reviewer reported no justified P1/P2. Source publication, full current-head CI, one fresh independent external review and a new operator approval remain separate gates. Neither internal verification nor this design record implies those later outcomes.

## Exact structural convergence proof packet

| Exact helper/model under test | Passed | Failed | Total |
| --- | ---: | ---: | ---: |
| Published `e1fa8dfb34c5550eeb88a352ee84967c6287a17d` helpers with the complete new regression suite | 49 | 12 | 61 |
| Frozen intermediate structural model `b9f7bb86e2cc5e4c7903253a658d1e747f8dafe93a60797f2c7e6ad73840e9bf` with the clip-applicability regressions | 57 | 4 | 61 |
| Refined candidate source SHA-256 `38d712a549eae8ae127addca510620ac9816f34f9b207398fe4f2b20e6285b43` | 61 | 0 | 61 |

Focused command: `node --test tests/workspace-card-layout-audit.test.mjs`, Node v24.13.1; zero skipped tests. The published-head red run keeps the actual published helper prefix unchanged and substitutes only the expanded test/DOM-double section. The candidate also passes `node --check`. Parent independently reran all 61 tests against the same candidate source and verified Git blob `fd565624f0b2909c2ff54d5443c28fa76706fab5`. That internal replay and the completed focused internal review are distinct from subsequent hosted CI, external current-head code review and operator merge approval.

The source remained frozen while its final internal check ran. Publication is limited to this document and the existing audit module on the same reserved branch. The follow-on UI candidate, Forge/recovery, source lease, canonical checkout and served runtime remain outside this repair.

## Fourth published-head finding: structural render eligibility review

External review [visibility override finding](https://github.com/Cheekyfellastef/stephan-os/pull/3307#discussion_r4407241656) at published head `9ec1b1fe4ea0916aa1c2803a940fbea84b40e793` identified that a hidden ancestor incorrectly removed explicitly visible cards and labels. Narrow patching stopped; an independent structural render-eligibility review completed before this correction. The same review covered CSS-overridden HTML hidden metadata and content suppression to avoid accumulating another ancestor exception.

Three distinct predicates now govern projection:

| Predicate | Contract |
| --- | --- |
| Layout boundary | Selected associated box with usable nonzero geometry and no genuine subtree suppressor. An own visibility-hidden/collapsed box still bounds visible descendants. |
| Own-box paint | Boundary eligibility plus the element's own computed visibility. Ancestor visibility never vetoes an explicitly visible descendant. |
| Direct-content paint | Own visibility plus applicable content suppression, including the element itself. Descendant traversal continues even when the current element's own text is invisible. |

Computed display:none suppresses a subtree. Zero opacity on a qualified generated rendering box suppresses the composed subtree; unsupported boxless/native combinations error explicitly. Raw HTML hidden metadata is not paint authority: effective computed CSS and geometry decide. Content-visibility:hidden suppresses contents, while the container's own border box remains eligible. Its strict ancestors suppress box/boundary projection; direct text also checks self. Qualified non-replaced HTML block, flow-root, inline-block, flex, inline-flex, grid, inline-grid and supported aliases are admitted. Ordinary non-replaced inline and display:contents declarations cannot gain content-containment suppression. Unqualified active native/table/ruby/SVG layouts and uncertain automatic skipping error rather than guess. The layout vocabulary is shared with overflow qualification, while the predicates remain distinct.

This follows [CSS visibility](https://drafts.csswg.org/css-display/#visibility), [HTML hidden rendering](https://html.spec.whatwg.org/multipage/interaction.html#the-hidden-attribute), [content visibility](https://drafts.csswg.org/css-contain-2/#content-visibility), and [containment applicability](https://drafts.csswg.org/css-contain-2/#containment-size). Malformed computed evidence remains an explicit error. Hidden ancestors retain genuine overflow clips, invisible controls cannot grant label-owner collision exemptions, and invisible nested card boxes are omitted from the parent's painted items while their layout ownership remains available to visible descendants.

The prior fragment/clip/manual-input model and all 61 preceding tests remain. The deterministic DOM double now declares effective computed content visibility rather than relying on absent CSS metadata. Added tests cover visible overrides, hidden layout boundaries, inherited-hidden item omission, true subtree suppression, raw hidden CSS overrides, container-box versus content suppression, inapplicable inline/contents containment, unsupported and malformed evidence, retained hidden clips, label ownership, and translation/irrelevant-hidden-branch invariance.

| Exact helper under the complete 84-test suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Unchanged published head 9ec1b1fe4ea0916aa1c2803a940fbea84b40e793 helpers | 67 | 17 | 0 |
| Frozen candidate source SHA-256 0fae9a7e5b66ced6986f93871e9d125518780103de3896a3581bd3db57d08cac | 84 | 0 | 0 |

Candidate Git blob: `58c4712395ff90ae50cea4bb28a72c63b5e753dc`. Node v24.13.1; node --check passes. Parent independently reran 84/84 on the exact stable bytes. The independent focused reviewer also reran 84/84 with matching before/after hash and found no justified P1/P2. Internal verification is complete; publication, final-head hosted CI, one fresh external current-head review and fresh operator approval remain distinct subsequent gates. The prior operator approval does not transfer.

The permitted integration check evaluated both exact functions read-only on the already served Agents page at 1280 x 720, DPR 1. Extractor function SHA-256: `71d5808fd7e87ae237699160e6ddabc858fb28bd32313abf0e8661e4ec63139f`; audit function SHA-256: `34e5aa5b8036be8303635b4821e36948f7d14afa875a1bcb67514a6d534e5345`. It measured 25 layout boundaries and 250 painted item records, reporting six text Range-box collision candidates and no affordances. These candidates require visual adjudication; glyph overlap was not established. The current fallback data has five short identities, so the original long-name/hash issue remains unproven.

The observed served build was independently read as head `73e1a79c03cb9dafe8fb17d77a45a9ac502e32ce`, fingerprint `0a98e303d083ae5951402cbc854a2a9e7dbd7075127cf10bda8a64b9b81a4ed8`, built 2026-10-28T18:41:26.709Z. It is not the audit source or a later UI repair. No CSS/DOM/state mutation, source installation, service/listener change, viewport override or denied-file-fixture rendering occurred. Default tool serialization replaced shared geometry references with placeholders, and full snapshot text exceeded its transport limit; running both exact helpers together returned the bounded complete report without losing geometry. This is helper integration evidence only.

Durable convergence invariant: layout ownership, own-box paint, direct-content paint, geometry validity and clip applicability are separate truths. Inheritance is resolved on the measured element; only genuine, qualified subtree suppressors justify ancestor exclusion. Counts describe layout boundaries and painted records, not a complete browser paint model, visual acceptance or runtime health.
