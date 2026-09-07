export const STARFIELD_VR_DELIVERY_TRUTH_SCHEMA = 'stephanos.starfield-vr-delivery-truth.v1';
export const STARFIELD_VR_LOCAL_DELIVERY_SCHEMA = 'stephanos.starfield-vr-local-delivery-observation.v1';

const SAFE_SHA = /^[0-9a-f]{40}$/;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const MAX_TEXT = 500;
const REQUIRED_SPLASH_FILES = Object.freeze([
  'scripts/windows/launch-starfield-vr-with-splash.ps1',
  'scripts/windows/install-starfield-vr-desktop-shortcut.ps1',
  'scripts/starfield-vr-launcher-source.test.mjs',
]);

export const STARFIELD_VR_DELIVERY_TRUTH_BOUNDARY = Object.freeze({
  authority: 'read-only-delivery-convergence',
  sourceMutationAuthority: false,
  mergeAuthority: false,
  installAuthority: false,
  launchAuthority: false,
  runtimeMutationAuthority: false,
  liveClaimAuthority: false,
});

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, 'value')) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function plainRecord(value) {
  try {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const out = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
      out[key] = descriptor.value;
    }
    return out;
  } catch {
    return null;
  }
}

function denseStringArray(value, max = 16) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string') || keys.length !== value.length + 1) return null;
    const out = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      if (typeof descriptor.value !== 'string' || descriptor.value.length > MAX_TEXT) return null;
      out.push(descriptor.value);
    }
    return out;
  } catch {
    return null;
  }
}

function safeText(value, max = MAX_TEXT) {
  return typeof value === 'string' && value.length <= max ? value : '';
}

function validTimestamp(value) {
  if (typeof value !== 'string' || !SAFE_TIMESTAMP.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function triState(value) {
  return value === true ? true : value === false ? false : 'unknown';
}

function validateSource(value) {
  const record = plainRecord(value);
  if (!record) return null;
  const allowed = ['repository', 'prNumber', 'branch', 'headSha', 'merged', 'mergeCommitSha', 'currentMainSha', 'changedFiles'];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return null;
  if (record.repository !== 'Cheekyfellastef/stephan-os') return null;
  if (!Number.isSafeInteger(record.prNumber) || record.prNumber <= 0) return null;
  if (!SAFE_BRANCH.test(record.branch || '') || !SAFE_SHA.test(record.headSha || '')) return null;
  if (typeof record.merged !== 'boolean') return null;
  if (record.mergeCommitSha !== '' && !SAFE_SHA.test(record.mergeCommitSha || '')) return null;
  if (!SAFE_SHA.test(record.currentMainSha || '')) return null;
  const changedFiles = denseStringArray(record.changedFiles, 16);
  if (!changedFiles) return null;
  return { ...record, changedFiles };
}

function validateLocal(value) {
  if (value === null || value === undefined) return null;
  const record = plainRecord(value);
  if (!record) return false;
  const allowed = [
    'schemaVersion', 'observedAtUtc', 'desktopIconPresent', 'splashWrapperPresent',
    'shortcutTargetPath', 'shortcutArguments', 'shortcutRoutesThroughSplash',
    'installerReceiptPresent', 'installerReceiptVerdict', 'installedSourceHead',
  ];
  if (Object.keys(record).some((key) => !allowed.includes(key))) return false;
  if (record.schemaVersion !== STARFIELD_VR_LOCAL_DELIVERY_SCHEMA || !validTimestamp(record.observedAtUtc)) return false;
  for (const key of ['desktopIconPresent', 'splashWrapperPresent', 'shortcutRoutesThroughSplash', 'installerReceiptPresent']) {
    if (typeof record[key] !== 'boolean') return false;
  }
  if (!safeText(record.shortcutTargetPath) && record.shortcutTargetPath !== '') return false;
  if (!safeText(record.shortcutArguments, 1000) && record.shortcutArguments !== '') return false;
  if (!safeText(record.installerReceiptVerdict, 120) && record.installerReceiptVerdict !== '') return false;
  if (record.installedSourceHead !== '' && !SAFE_SHA.test(record.installedSourceHead || '')) return false;
  return { ...record };
}

export function assessStarfieldVrDeliveryTruth(input) {
  const record = plainRecord(input);
  const invalid = () => deepFreeze({
    schemaVersion: STARFIELD_VR_DELIVERY_TRUTH_SCHEMA,
    valid: false,
    desktopIconPresent: 'unknown',
    splashSourceBuilt: false,
    splashMerged: false,
    splashInstalled: 'unknown',
    blocker: 'DELIVERY_TRUTH_INPUT_INVALID',
    boundary: STARFIELD_VR_DELIVERY_TRUTH_BOUNDARY,
  });
  if (!record) return invalid();
  if (Object.keys(record).some((key) => !['source', 'local'].includes(key))) return invalid();

  const source = validateSource(record.source);
  const local = validateLocal(record.local);
  if (!source || local === false) return invalid();

  const changed = new Set(source.changedFiles);
  const splashSourceBuilt = REQUIRED_SPLASH_FILES.every((path) => changed.has(path));
  const splashMerged = splashSourceBuilt && source.merged === true && SAFE_SHA.test(source.mergeCommitSha || '');
  const desktopIconPresent = local ? triState(local.desktopIconPresent) : 'unknown';

  let splashInstalled = 'unknown';
  let blocker = '';
  if (!splashSourceBuilt) {
    splashInstalled = false;
    blocker = 'SPLASH_SOURCE_NOT_BUILT';
  } else if (!splashMerged) {
    splashInstalled = false;
    blocker = 'SPLASH_NOT_MERGED';
  } else if (!local) {
    blocker = 'LOCAL_DELIVERY_PROOF_MISSING';
  } else if (!local.desktopIconPresent) {
    splashInstalled = false;
    blocker = 'DESKTOP_ICON_MISSING';
  } else if (!local.splashWrapperPresent || !local.shortcutRoutesThroughSplash) {
    splashInstalled = false;
    blocker = 'SHORTCUT_NOT_ROUTED_THROUGH_SPLASH';
  } else if (!local.installerReceiptPresent || local.installerReceiptVerdict !== 'STARFIELD_VR_SHORTCUT_INSTALLED') {
    splashInstalled = false;
    blocker = 'SHORTCUT_INSTALL_RECEIPT_MISSING';
  } else if (local.installedSourceHead !== source.currentMainSha) {
    splashInstalled = false;
    blocker = 'INSTALLED_SOURCE_HEAD_MISMATCH';
  } else {
    splashInstalled = true;
  }

  return deepFreeze({
    schemaVersion: STARFIELD_VR_DELIVERY_TRUTH_SCHEMA,
    valid: true,
    desktopIconPresent,
    splashSourceBuilt,
    splashMerged,
    splashInstalled,
    source: {
      prNumber: source.prNumber,
      branch: source.branch,
      headSha: source.headSha,
      mergeCommitSha: source.mergeCommitSha,
      currentMainSha: source.currentMainSha,
    },
    local: local ? {
      observedAtUtc: local.observedAtUtc,
      installedSourceHead: local.installedSourceHead,
      shortcutTargetPath: local.shortcutTargetPath,
      shortcutRoutesThroughSplash: local.shortcutRoutesThroughSplash,
    } : null,
    blocker,
    boundary: STARFIELD_VR_DELIVERY_TRUTH_BOUNDARY,
  });
}
