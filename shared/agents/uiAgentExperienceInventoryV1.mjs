import { createHash } from 'node:crypto';

export const UI_AGENT_EXPERIENCE_INVENTORY_SCHEMA_VERSION = 'stephanos.ui-agent.experience-inventory.v1';
export const UI_AGENT_EXPERIENCE_SURFACE_SCHEMA_VERSION = 'stephanos.ui-agent.experience-surface.v1';
export const UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION = 'stephanos.ui-agent.shared-primitive.v1';

export const UI_AGENT_SURFACE_CLASSES = Object.freeze([
  'REGISTERED_APP',
  'EMBEDDED_STEPhANOS_SURFACE'.replace('hANOS', 'HANOS'),
  'DEVICE_PRESENTATION',
  'TEXT_OR_MESSAGING_PRESENTATION',
  'VOICE_PRESENTATION',
  'SPATIAL_PRESENTATION',
  'FUTURE_PRODUCT_SURFACE',
]);

export const UI_AGENT_EXPERIENCE_DEBT_CLASSES = Object.freeze([
  'VISUAL_DRIFT',
  'INCONSISTENT_COMPONENT',
  'POOR_INFORMATION_HIERARCHY',
  'CONTROL_CLUTTER',
  'TOUCH_FRICTION',
  'RESPONSIVE_DEFECT',
  'ACCESSIBILITY_DEFECT',
  'MOTION_DEFECT',
  'STATE_TRUTH_DEFECT',
  'EMPTY_OR_ERROR_STATE_DEFECT',
  'CROSS_SURFACE_INCONSISTENCY',
  'SPATIAL_READINESS_GAP',
  'PERFORMANCE_PERCEPTION_GAP',
  'UNKNOWN',
]);

export const UI_AGENT_REQUIRED_PROOF_CLASSES = Object.freeze([
  'SOURCE_INVENTORY',
  'DESKTOP_VISUAL',
  'TABLET_VISUAL',
  'PHONE_VISUAL',
  'KEYBOARD_INTERACTION',
  'TOUCH_INTERACTION',
  'REDUCED_MOTION',
  'LOADING_ERROR_OFFLINE',
  'WINDOWS_EDGE_INTERACTION',
  'SPATIAL_OR_QUEST',
]);

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_SOURCE_REF = /^[a-z0-9][a-z0-9._/:-]{0,255}$/i;

const CANONICAL_PRODUCT_SURFACE_IDS = Object.freeze([
  'stephanos-landing-page',
  'ai-console',
  'goal-dashboard',
  'music-tile',
  'vr-research-lab',
  'vr-link',
  'sovereignty',
  'wealth',
  'privacy',
  'trading-laboratory',
  'autonomous-build-controls',
  'command-deck',
  'ignition-splash',
  'desktop-browser',
  'windows-edge',
  'ipad',
  'iphone',
  'whatsapp',
  'voice',
  'quest3-spatial',
]);

export const UI_AGENT_M2_SHARED_PRIMITIVES = Object.freeze([
  Object.freeze({
    schemaVersion: UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION,
    primitiveId: 'workspace-canvas',
    sourceRef: 'stephanos-ui/src/styles.css',
    selectorOrExport: '.stephanos-workspace-canvas',
    role: 'responsive bounded workspace layout',
  }),
  Object.freeze({
    schemaVersion: UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION,
    primitiveId: 'workspace-lane',
    sourceRef: 'stephanos-ui/src/styles.css',
    selectorOrExport: '.stephanos-workspace-lane',
    role: 'primary content lane',
  }),
  Object.freeze({
    schemaVersion: UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION,
    primitiveId: 'workspace-gutter',
    sourceRef: 'stephanos-ui/src/styles.css',
    selectorOrExport: '.stephanos-workspace-gutter',
    role: 'spatial breathing room and depth boundary',
  }),
  Object.freeze({
    schemaVersion: UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION,
    primitiveId: 'panel-card-shell',
    sourceRef: 'stephanos-ui/src/styles.css',
    selectorOrExport: '.panel,.provider-dock,.result-card,.graph-card,.simulation-result-card,.api-banner,.api-connection-banner,.custom-provider-panel,.provider-card',
    role: 'shared thin-border card and panel surface language',
  }),
  Object.freeze({
    schemaVersion: UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION,
    primitiveId: 'reduced-motion-contract',
    sourceRef: 'stephanos-ui/src/styles.css',
    selectorOrExport: '@media (prefers-reduced-motion: reduce)',
    role: 'motion accessibility boundary',
  }),
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function safeId(value) {
  return SAFE_ID.test(text(value));
}

function sourceRef(value) {
  return SAFE_SOURCE_REF.test(text(value));
}

function timestamp(value) {
  const candidate = text(value);
  const ms = Date.parse(candidate);
  return Boolean(candidate && Number.isFinite(ms) && new Date(ms).toISOString() === candidate);
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function freezeList(value) {
  return Object.freeze([...value]);
}

function surface(input = {}) {
  return Object.freeze({
    schemaVersion: UI_AGENT_EXPERIENCE_SURFACE_SCHEMA_VERSION,
    surfaceId: text(input.surfaceId),
    surfaceClass: text(input.surfaceClass),
    ownerGoal: text(input.ownerGoal),
    registrationRef: text(input.registrationRef),
    experienceVersion: text(input.experienceVersion, 'UNASSESSED'),
    componentVersion: text(input.componentVersion, 'UNASSESSED'),
    responsiveCoverage: text(input.responsiveCoverage, 'UNKNOWN'),
    accessibilityCoverage: text(input.accessibilityCoverage, 'UNKNOWN'),
    motionCoverage: text(input.motionCoverage, 'UNKNOWN'),
    loadingEmptyErrorCoverage: text(input.loadingEmptyErrorCoverage, 'UNKNOWN'),
    inputMethods: freezeList(list(input.inputMethods)),
    lastVisualProof: text(input.lastVisualProof),
    lastInteractionProof: text(input.lastInteractionProof),
    knownExperienceDebt: freezeList(list(input.knownExperienceDebt)),
    severity: text(input.severity, 'UNKNOWN'),
    recommendedNextImprovement: text(input.recommendedNextImprovement, 'AUDIT_REQUIRED'),
  });
}

function inferredSurfaceFromRegisteredApp(appId) {
  const normalized = text(appId);
  const surfaceId = ({
    stephanos: 'stephanos-landing-page',
    'goal-dashboard': 'goal-dashboard',
    'music-tile': 'music-tile',
    'vr-research-lab': 'vr-research-lab',
    wealthapp: 'wealth',
    cockpit: 'command-deck',
  })[normalized] || `app:${normalized}`;
  return surface({
    surfaceId,
    surfaceClass: 'REGISTERED_APP',
    ownerGoal: 'UNKNOWN',
    registrationRef: 'apps/index.json',
    inputMethods: ['POINTER', 'KEYBOARD'],
    knownExperienceDebt: ['UNKNOWN'],
  });
}

export function validateUiAgentSharedPrimitive(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { valid:false, errors:['record-must-be-object'] };
  if (record.schemaVersion !== UI_AGENT_SHARED_PRIMITIVE_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  if (!safeId(record.primitiveId)) errors.push('primitiveId-invalid');
  if (!sourceRef(record.sourceRef)) errors.push('sourceRef-invalid');
  if (!text(record.selectorOrExport)) errors.push('selectorOrExport-required');
  if (!text(record.role)) errors.push('role-required');
  return Object.freeze({ valid:errors.length === 0, errors:Object.freeze(errors) });
}

export function validateUiAgentExperienceSurface(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { valid:false, errors:['record-must-be-object'] };
  if (record.schemaVersion !== UI_AGENT_EXPERIENCE_SURFACE_SCHEMA_VERSION) errors.push('schema-version-mismatch');
  if (!safeId(record.surfaceId) && !/^app:[a-z0-9][a-z0-9._-]{0,100}$/i.test(text(record.surfaceId))) errors.push('surfaceId-invalid');
  if (!UI_AGENT_SURFACE_CLASSES.includes(text(record.surfaceClass))) errors.push('surfaceClass-invalid');
  if (!text(record.registrationRef)) errors.push('registrationRef-required');
  if (!Array.isArray(record.inputMethods) || record.inputMethods.length === 0) errors.push('inputMethods-required');
  if (!Array.isArray(record.knownExperienceDebt)) errors.push('knownExperienceDebt-must-be-array');
  for (const debt of record.knownExperienceDebt || []) {
    if (!UI_AGENT_EXPERIENCE_DEBT_CLASSES.includes(text(debt))) errors.push(`experience-debt-invalid:${debt}`);
  }
  return Object.freeze({ valid:errors.length === 0, errors:Object.freeze(errors) });
}

export function buildUiAgentExperienceInventory(input = {}) {
  const registeredApps = freezeList(list(input.registeredApps));
  const explicitSurfaces = Array.isArray(input.explicitSurfaces) ? input.explicitSurfaces.map((item) => surface(item)) : [];
  const inferred = registeredApps.map(inferredSurfaceFromRegisteredApp);
  const byId = new Map();
  for (const candidate of [...inferred, ...explicitSurfaces]) byId.set(candidate.surfaceId, candidate);
  const surfaces = freezeList([...byId.values()].sort((a, b) => a.surfaceId.localeCompare(b.surfaceId)));
  const sharedPrimitives = freezeList((input.sharedPrimitives || UI_AGENT_M2_SHARED_PRIMITIVES).map((item) => Object.freeze({ ...item })));
  const validationErrors = [];
  for (const record of surfaces) {
    const verdict = validateUiAgentExperienceSurface(record);
    validationErrors.push(...verdict.errors.map((error) => `${record.surfaceId}:${error}`));
  }
  for (const record of sharedPrimitives) {
    const verdict = validateUiAgentSharedPrimitive(record);
    validationErrors.push(...verdict.errors.map((error) => `${record.primitiveId}:${error}`));
  }
  const coveredCanonical = CANONICAL_PRODUCT_SURFACE_IDS.filter((id) => byId.has(id));
  const missingCanonical = CANONICAL_PRODUCT_SURFACE_IDS.filter((id) => !byId.has(id));
  const observedAtUtc = text(input.observedAtUtc);
  if (!timestamp(observedAtUtc)) validationErrors.push('observedAtUtc-invalid');
  const inventoryId = `ui-inventory-${hash({ registeredApps, surfaces, sharedPrimitives, observedAtUtc }).slice(0, 24)}`;
  return Object.freeze({
    schemaVersion: UI_AGENT_EXPERIENCE_INVENTORY_SCHEMA_VERSION,
    inventoryId,
    participantId: 'user-interface-agent',
    lifecycleState: 'READ_ONLY_CANDIDATE',
    observedAtUtc,
    registeredApps,
    surfaces,
    sharedPrimitives,
    coverage: Object.freeze({
      canonicalTargetCount: CANONICAL_PRODUCT_SURFACE_IDS.length,
      coveredCanonicalCount: coveredCanonical.length,
      coveredCanonical: freezeList(coveredCanonical),
      missingCanonical: freezeList(missingCanonical),
    }),
    nextMilestone: missingCanonical.length > 0
      ? 'M2_COMPLETE_SOURCE_AND_PRESENTATION_SURFACE_DISCOVERY'
      : 'M3_PUBLISH_CANONICAL_EXPERIENCE_CONTRACT_AND_DESIGN_MAP',
    authority: Object.freeze({
      sourceMutationAllowed:false,
      implementationAllowed:false,
      mergeAllowed:false,
      deploymentAllowed:false,
      productAuthority:false,
    }),
    valid: validationErrors.length === 0,
    validationErrors: freezeList(validationErrors),
  });
}

export function createUiAgentM2SeedInventory(input = {}) {
  const registeredApps = input.registeredApps || [];
  const explicitSurfaces = [
    { surfaceId:'ai-console', surfaceClass:'EMBEDDED_STEPHANOS_SURFACE', ownerGoal:'#1308', registrationRef:'stephanos-ui/src/components/AIConsole.jsx', inputMethods:['KEYBOARD','POINTER','TOUCH'], knownExperienceDebt:['UNKNOWN'] },
    { surfaceId:'desktop-browser', surfaceClass:'DEVICE_PRESENTATION', ownerGoal:'#1722', registrationRef:'presentation:desktop-browser', inputMethods:['KEYBOARD','POINTER'], knownExperienceDebt:['UNKNOWN'] },
    { surfaceId:'windows-edge', surfaceClass:'DEVICE_PRESENTATION', ownerGoal:'#1722', registrationRef:'presentation:windows-edge', inputMethods:['KEYBOARD','POINTER'], knownExperienceDebt:['UNKNOWN'] },
    { surfaceId:'ipad', surfaceClass:'DEVICE_PRESENTATION', ownerGoal:'#1722', registrationRef:'presentation:ipad', inputMethods:['TOUCH'], knownExperienceDebt:['UNKNOWN'] },
    { surfaceId:'iphone', surfaceClass:'DEVICE_PRESENTATION', ownerGoal:'#1722', registrationRef:'presentation:iphone', inputMethods:['TOUCH'], knownExperienceDebt:['UNKNOWN'] },
    { surfaceId:'whatsapp', surfaceClass:'TEXT_OR_MESSAGING_PRESENTATION', ownerGoal:'#1280', registrationRef:'presentation:whatsapp', inputMethods:['TEXT'], knownExperienceDebt:['UNKNOWN'] },
    { surfaceId:'voice', surfaceClass:'VOICE_PRESENTATION', ownerGoal:'#1308', registrationRef:'presentation:future-voice', inputMethods:['VOICE'], knownExperienceDebt:['UNKNOWN'] },
    { surfaceId:'quest3-spatial', surfaceClass:'SPATIAL_PRESENTATION', ownerGoal:'#1760', registrationRef:'presentation:quest3-spatial', inputMethods:['GAZE','CONTROLLER','VOICE'], knownExperienceDebt:['SPATIAL_READINESS_GAP'] },
    ...(input.explicitSurfaces || []),
  ];
  return buildUiAgentExperienceInventory({ ...input, registeredApps, explicitSurfaces });
}
