const REQUIRED_LAW_FIELDS = Object.freeze([
  'id',
  'title',
  'shortStatement',
  'fullDescription',
  'category',
  'invariantType',
  'operatorImplication',
  'engineeringImplication',
  'relatedFiles',
  'testCoverageHint',
  'severity',
  'status',
]);

export const STEPHANOS_LAWS_VERSION = '2026-03-27.guardrails-v4';

export const STEPHANOS_LAW_IDS = Object.freeze({
  UNIVERSAL_ENTRY: 'law-universal-entry-not-system-brain',
  RUNTIME_TARGET_DISTINCT: 'law-runtime-target-distinct-from-launcher',
  ENTRY_SEPARATION: 'law-entry-field-separation',
  ENTRY_COMPATIBILITY_ONLY: 'law-entry-compatibility-only',
  BUILD_TRUTH_PARITY: 'law-source-built-served-truth-parity',
  LOCALHOST_PROCESS_TRUTH: 'law-localhost-process-truth-requires-restart-on-drift',
  PROCESS_REUSE_GATES: 'law-process-reuse-requires-marker-mime-parity',
  IMPORT_STRUCTURE_GUARD: 'law-launcher-import-structure-guarded',
  DIAGNOSTICS_BOUNDARY: 'law-diagnostics-isolated-from-primary-launcher',
  ROOT_VS_TILE_ACTION: 'law-root-visit-and-tile-click-are-distinct-actions',
  SHARED_STATE_LAYER: 'law-shared-runtime-state-holds-cross-device-truth',
  DEVICE_EMBODIMENT: 'law-runtime-embodiment-can-vary-by-device',
  REALITY_SYNC: 'law-reality-sync-keeps-displayed-truth-current',
});

export const stephanosLaws = Object.freeze([
  {
    id: STEPHANOS_LAW_IDS.UNIVERSAL_ENTRY,
    title: 'Root launcher is universal entry, not full system brain',
    shortStatement: 'The root launcher is the doorway for every device, but it does not replace runtime/state truth.',
    fullDescription: 'The root path (/) remains the tile-first launcher shell and universal boot surface. It should stay stable and lightweight, while deeper continuity/memory/runtime behavior lives in shared runtime/state layers and validated runtime targets.',
    category: 'entry',
    invariantType: 'hard',
    operatorImplication: 'Use root launcher for safe entry and orientation; do not assume it contains full mission runtime state.',
    engineeringImplication: 'Protect tile-first launcher behavior and keep Mission Console/runtime concerns separate from launcher shell code paths.',
    relatedFiles: ['index.html', 'main.js', 'modules/command-deck/command-deck.js'],
    testCoverageHint: 'tests/root-launcher-guardrails.test.mjs',
    severity: 'critical',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.RUNTIME_TARGET_DISTINCT,
    title: 'Runtime target stays distinct from launcher shell target',
    shortStatement: 'Mission Console/runtime route is separate from launcher shell identity.',
    fullDescription: 'Stephanos must preserve a distinct runtime target for active operations while root launcher identity remains independent. Runtime target resolution cannot overwrite launcher-shell truth.',
    category: 'runtime',
    invariantType: 'hard',
    operatorImplication: 'If runtime is degraded, root shell can still load. Treat that as degraded runtime, not full system success.',
    engineeringImplication: 'Maintain dedicated runtimeEntry and launchEntry resolution logic; never force launcherEntry as runtime destination when runtime target is valid.',
    relatedFiles: ['system/apps/app_validator.js', 'modules/command-deck/command-deck.js', 'system/workspace.js'],
    testCoverageHint: 'tests/stephanos-entry-guardrails.test.mjs',
    severity: 'critical',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.ENTRY_SEPARATION,
    title: 'launcherEntry/runtimeEntry/launchEntry must not collapse',
    shortStatement: 'Launch semantics stay explicit and ordered: launchEntry → runtimeEntry → entry.',
    fullDescription: 'Stephanos launch semantics require dedicated fields for launcher shell, runtime, and context-specific launch target. Field collapsing obscures intent and causes route regressions in launcher and workspace paths.',
    category: 'entry',
    invariantType: 'hard',
    operatorImplication: 'When launch behavior is wrong, inspect launcherEntry, runtimeEntry, and launchEntry before any restart.',
    engineeringImplication: 'Any normalization or launch-resolution edit must preserve field separation and fallback order.',
    relatedFiles: ['system/apps/app_validator.js', 'modules/command-deck/command-deck.js', 'system/workspace.js'],
    testCoverageHint: 'tests/stephanos-entry-guardrails.test.mjs, tests/command-deck-guardrails.test.mjs',
    severity: 'critical',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.ENTRY_COMPATIBILITY_ONLY,
    title: 'app.entry is compatibility fallback only',
    shortStatement: 'app.entry can mirror launchEntry for compatibility but cannot become authoritative truth.',
    fullDescription: 'Older paths may still consume app.entry. Stephanos keeps this field as compatibility output only while authoritative intent remains in separated launch fields.',
    category: 'compatibility',
    invariantType: 'hard',
    operatorImplication: 'If only app.entry looks correct while separated fields drift, treat it as a law violation.',
    engineeringImplication: 'Do not write new code that prefers app.entry over launchEntry/runtimeEntry when separated fields exist.',
    relatedFiles: ['system/apps/app_validator.js', 'modules/command-deck/command-deck.js'],
    testCoverageHint: 'tests/stephanos-entry-guardrails.test.mjs',
    severity: 'high',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.BUILD_TRUTH_PARITY,
    title: 'Source, built, and served truth must align',
    shortStatement: 'Verification fails when source, dist build metadata, and served artifacts diverge.',
    fullDescription: 'Stephanos correctness depends on parity between repository source, generated dist artifacts, and what local services actually serve. Build markers, timestamps, and metadata checks are required trust gates.',
    category: 'build-truth',
    invariantType: 'hard',
    operatorImplication: 'Run build + verify before trusting a runtime route after significant edits or recoveries.',
    engineeringImplication: 'Do not bypass build marker checks, dist verification, or serve-time proof steps.',
    relatedFiles: ['scripts/build-stephanos-ui.mjs', 'scripts/verify-stephanos-dist.mjs', 'scripts/serve-stephanos-dist.mjs', 'apps/stephanos/dist/stephanos-build.json'],
    testCoverageHint: 'tests/stephanos-dist-build.test.mjs',
    severity: 'critical',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.LOCALHOST_PROCESS_TRUTH,
    title: 'Localhost process truth requires restart when mirror drift is detected',
    shortStatement: 'A healthy localhost process is not authoritative when mirror drift requires ignition restart.',
    fullDescription: 'Stephanos treats localhost health as one signal only. When localhost mirror truth drifts from authoritative marker/build truth, operators must restart ignition/serve processes before treating localhost status as canonical.',
    category: 'build-truth',
    invariantType: 'hard',
    operatorImplication: 'If localhost mirror drift and restart-required flags are both true, restart the process and re-verify truth markers.',
    engineeringImplication: 'Keep localhost drift and ignition restart signals wired into truth contradictions and do not downgrade them to informational-only.',
    relatedFiles: ['shared/runtime/truthEngine.mjs', 'scripts/serve-stephanos-dist.mjs', 'scripts/verify-stephanos-dist.mjs'],
    testCoverageHint: 'tests/truth-engine.test.mjs + stale-process reuse guard checks',
    severity: 'high',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.PROCESS_REUSE_GATES,
    title: 'Healthy process alone is insufficient for reuse',
    shortStatement: 'Reuse requires service identity, marker parity, and MIME/build checks.',
    fullDescription: 'A responding localhost process is not equivalent to serving current Stephanos truth. Runtime reuse is safe only when health marker, build marker, served index marker, and module MIME expectations all pass.',
    category: 'build-truth',
    invariantType: 'hard',
    operatorImplication: 'If health is green but behavior is stale, restart with verification and inspect marker mismatches.',
    engineeringImplication: 'Keep stale-process guard checks strict and fail fast on parity mismatches.',
    relatedFiles: ['scripts/serve-stephanos-dist.mjs', 'scripts/verify-stephanos-dist.mjs', 'docs/stephanos-guardrails-v2.md'],
    testCoverageHint: 'scripts/verify-stephanos-dist.mjs execution + stale-process reuse guard checks',
    severity: 'critical',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.IMPORT_STRUCTURE_GUARD,
    title: 'Launcher-critical import structure is guarded and enforced',
    shortStatement: 'Imports stay top-of-file and duplicate bindings fail verification before merge.',
    fullDescription: 'Launcher-critical modules fail fast when import structure is invalid. Duplicate imported bindings and imports placed after executable code are blocked by the import-structure guard to prevent tile-registry outages caused by syntax/module-load failures.',
    category: 'build-truth',
    invariantType: 'hard',
    operatorImplication: 'If a launcher tile outage follows a module syntax error, run stephanos:guard:imports and treat failures as hard blockers.',
    engineeringImplication: 'Keep imports at top-level import section only, forbid duplicate imported bindings, and wire guard failures into verification gates.',
    relatedFiles: ['scripts/guard-import-structure.mjs', 'tests/import-guard.test.mjs', 'scripts/verify-stephanos-dist.mjs', 'modules/command-deck/command-deck.js'],
    testCoverageHint: 'tests/import-guard.test.mjs + npm run stephanos:guard:imports',
    severity: 'critical',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.DIAGNOSTICS_BOUNDARY,
    title: 'Diagnostics/status surfaces are isolated by default',
    shortStatement: 'Secondary diagnostics never render in primary launcher body unless explicitly enabled.',
    fullDescription: 'Primary launcher body remains focused on tile-first entry. Runtime diagnostics/status views are isolated in dedicated secondary mounts and require explicit opt-in or toggles.',
    category: 'diagnostics-boundary',
    invariantType: 'hard',
    operatorImplication: 'Unexpected diagnostics content in main tile area is a policy regression, not a cosmetic issue.',
    engineeringImplication: 'Keep diagnostics rendering behind isolated mounts and explicit enable flags.',
    relatedFiles: ['main.js', 'index.html', 'modules/command-deck/command-deck.js'],
    testCoverageHint: 'tests/root-launcher-guardrails.test.mjs, tests/command-deck-guardrails.test.mjs',
    severity: 'high',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.ROOT_VS_TILE_ACTION,
    title: 'Direct root visit and tile click are distinct actions',
    shortStatement: 'Visiting / and launching a tile have different semantics and must stay separate.',
    fullDescription: 'Opening root launcher is orientation/entry behavior; clicking a tile is an explicit launch action that should respect runtime launch resolution. Conflating the two causes wrong-target regressions.',
    category: 'routing',
    invariantType: 'hard',
    operatorImplication: 'If root and tile click land on the same route unexpectedly, check target resolution chain.',
    engineeringImplication: 'Maintain separate logic for root-shell rendering and tile-click launch flows.',
    relatedFiles: ['main.js', 'modules/command-deck/command-deck.js', 'system/workspace.js'],
    testCoverageHint: 'tests/root-launcher-guardrails.test.mjs + launcher/command-deck guardrail tests',
    severity: 'high',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.SHARED_STATE_LAYER,
    title: 'Shared runtime/state layer holds persistent cross-device truth',
    shortStatement: 'Identity, memory, preferences, and continuity belong to shared runtime/state contracts.',
    fullDescription: 'Stephanos cross-device continuity depends on shared/runtime models that persist durable truth beyond one route or shell session, while keeping ephemeral route adjudication scoped as runtime truth.',
    category: 'state',
    invariantType: 'directional',
    operatorImplication: 'Expect continuity settings and identity context to survive device or route transitions where supported.',
    engineeringImplication: 'Extend shared/runtime contracts for durable truth instead of embedding persistence logic in launcher-only UI.',
    relatedFiles: ['shared/runtime/truthContract.mjs', 'docs/core-truth-vs-runtime-truth.md', 'shared/runtime/stephanosSessionMemory.mjs'],
    testCoverageHint: 'shared/runtime/* truth contract tests + session memory tests',
    severity: 'high',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.REALITY_SYNC,
    title: 'Reality Sync keeps displayed truth converged with latest detected truth',
    shortStatement: 'Launcher surfaces must detect stale displayed build truth and reconcile toward newer authoritative truth.',
    fullDescription: 'Stephanos launcher/runtime surfaces should continuously correlate displayed build markers/timestamps with authoritative source/build/served truth. When newer truth is detected, stale state must be surfaced and reconciled safely without aggressive or infinite refresh loops.',
    category: 'build-truth',
    invariantType: 'hard',
    operatorImplication: 'If displayed marker is stale, Truth Panel must show the mismatch and whether auto-refresh is enabled or paused.',
    engineeringImplication: 'Keep reality-sync polling, stale detection, refresh loop guards, and operator toggles wired through shared runtime/session memory paths.',
    relatedFiles: ['shared/runtime/realitySync.mjs', 'shared/runtime/truthEngine.mjs', 'shared/runtime/renderTruthPanel.mjs', 'main.js', 'modules/system-panel/system-panel.js'],
    testCoverageHint: 'tests/reality-sync.test.mjs, tests/truth-engine.test.mjs, tests/system-panel-toggle-state.test.mjs',
    severity: 'high',
    status: 'active',
  },
  {
    id: STEPHANOS_LAW_IDS.DEVICE_EMBODIMENT,
    title: 'Runtime embodiment may vary by device inside one Stephanos identity',
    shortStatement: 'Different device surfaces can coexist while sharing one architectural identity.',
    fullDescription: 'Stephanos should support route/device-specific runtime embodiments (desktop, tablet, phone, local node, hosted shell) without fragmenting the underlying identity and continuity model.',
    category: 'cross-device-architecture',
    invariantType: 'directional',
    operatorImplication: 'Different device experiences are expected when they preserve shared identity and truth contracts.',
    engineeringImplication: 'Device adaptation should branch at embodiment layer, not by duplicating launcher/runtime truth models.',
    relatedFiles: ['docs/stephanos-laws.md', 'docs/stephanos-guardrails-v2.md', 'shared/runtime/stephanosLocalUrls.mjs'],
    testCoverageHint: 'routing/runtime target tests and future device-profile contract tests',
    severity: 'medium',
    status: 'active',
  },
]);

export function getStephanosLawCategories() {
  return Object.freeze(Array.from(new Set(stephanosLaws.map((law) => law.category))));
}

export function getStephanosLawById(lawId) {
  return stephanosLaws.find((law) => law.id === lawId) || null;
}

export function validateStephanosLawShape(law) {
  const candidate = law && typeof law === 'object' ? law : {};
  const missingFields = REQUIRED_LAW_FIELDS.filter((field) => {
    if (!(field in candidate)) {
      return true;
    }

    if (field === 'relatedFiles') {
      return !Array.isArray(candidate.relatedFiles) || candidate.relatedFiles.length === 0;
    }

    return String(candidate[field] || '').trim().length === 0;
  });

  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}
