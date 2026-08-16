# Stephanos UI Agent M2 Experience Inventory V1

## Purpose

Advance #1722 and product programme #1776 from a registered read-only UI Agent participant into an evidence-backed inventory of the current Stephanos experience estate.

This milestone deliberately inventories before redesigning. It does not repaint screens, create a second design system, change product behavior, mutate runtime state, or grant the UI Agent implementation authority.

## Inputs

M2 consumes durable source truth such as:

- `apps/index.json` for currently registered app identities;
- `stephanos-ui/src/styles.css` for existing shared workspace/card primitives;
- existing component and app source references;
- explicit device or presentation surfaces such as desktop browser, Windows Edge, iPad, iPhone, WhatsApp, future voice and Quest 3 spatial presentation.

The inventory may be expanded as more exact source registrations are discovered. Missing canonical surfaces remain explicit gaps rather than being invented as live applications.

## Surface model

Each surface records:

```text
surfaceId
surfaceClass
ownerGoal
registrationRef
experienceVersion
componentVersion
responsiveCoverage
accessibilityCoverage
motionCoverage
loadingEmptyErrorCoverage
inputMethods
lastVisualProof
lastInteractionProof
knownExperienceDebt
severity
recommendedNextImprovement
```

Unknown proof or coverage remains `UNKNOWN` / unassessed. The inventory does not use a fabricated beauty score or completion percentage.

## Canonical experience targets

M2 tracks the intended product estate across:

- Stephanos landing page;
- AI Console;
- Goal Dashboard;
- Music Tile;
- VR Research Lab;
- VR Link;
- Sovereignty;
- Wealth;
- Privacy;
- Trading Laboratory;
- Autonomous Build controls;
- Command Deck;
- ignition/recovery presentation;
- desktop browser and Windows Edge;
- iPad and iPhone;
- WhatsApp;
- future voice;
- Quest 3 / spatial presentation.

The first seed is intentionally incomplete. Missing source identities such as VR Link, Sovereignty, Privacy, Trading Laboratory or other not-yet-resolved registrations remain in `missingCanonical` until source truth identifies their canonical surfaces.

## Shared primitive map

The first shared-primitives map records existing source ownership for:

```text
workspace-canvas
workspace-lane
workspace-gutter
panel-card-shell
reduced-motion-contract
```

These point to `stephanos-ui/src/styles.css`, which already contains the current workspace layout, thin-border panel/card shell language and reduced-motion boundary.

The UI Agent should prefer evolving shared primitives over hand-polishing every screen independently, but M2 grants no mutation authority to do so.

## Experience debt

M2 uses the #1722 debt taxonomy, including:

```text
VISUAL_DRIFT
INCONSISTENT_COMPONENT
POOR_INFORMATION_HIERARCHY
CONTROL_CLUTTER
TOUCH_FRICTION
RESPONSIVE_DEFECT
ACCESSIBILITY_DEFECT
MOTION_DEFECT
STATE_TRUTH_DEFECT
EMPTY_OR_ERROR_STATE_DEFECT
CROSS_SURFACE_INCONSISTENCY
SPATIAL_READINESS_GAP
PERFORMANCE_PERCEPTION_GAP
UNKNOWN
```

An uninspected surface begins as `UNKNOWN`, not as healthy.

## Safety and authority

The inventory is read-only analysis state:

```text
sourceMutationAllowed=false
implementationAllowed=false
mergeAllowed=false
deploymentAllowed=false
productAuthority=false
```

M2 does not:

- merge or deploy;
- change the current visual language;
- install fonts, assets or paid services;
- remove evidence or safety controls for visual cleanliness;
- infer a visual proof from source existence;
- turn screenshots or UI observations into mutation authority;
- create another backlog, scheduler, Shared Workspace, memory system or agent registry.

## Focused proof

```bash
node --test shared/agents/uiAgentExperienceInventoryV1.test.mjs
```

The focused suite proves:

- current registered apps can be mapped without inventing live proof;
- missing canonical surface coverage remains visible;
- shared workspace/card/reduced-motion primitives retain source ownership;
- explicit source observations can refine inferred app placeholders;
- unknown debt classes fail closed;
- absolute/unsafe source references fail closed;
- UI Agent M2 remains advisory with no implementation/product authority;
- invalid observation timestamps fail closed.

## Next milestone

M2 should continue source discovery until the canonical user-facing estate is adequately mapped. Then #1722 can advance to:

```text
M3_PUBLISH_CANONICAL_EXPERIENCE_CONTRACT_AND_DESIGN_MAP
```

Only after inventory and experience contract exist should the UI Agent select one high-value real improvement for governed implementation and cross-device proof.
