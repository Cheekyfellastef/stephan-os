const SHA40 = /^[0-9a-f]{40}$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

export const FORGE_SHADOW_PODMAN_RUNTIME_SCHEMA = 'stephanos.forge-shadow-podman-runtime.v1';
export const FORGE_SHADOW_PODMAN_RUNTIME_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const FORGE_SHADOW_PODMAN_RUNTIME_VERSION = '15.0.6';
export const FORGE_SHADOW_PODMAN_IMAGE = 'code.forgejo.org/forgejo/forgejo';
export const FORGE_SHADOW_PODMAN_IMAGE_TAG = `${FORGE_SHADOW_PODMAN_RUNTIME_VERSION}-rootless`;
export const FORGE_SHADOW_PODMAN_MACHINE = 'stephanos-forge-shadow';
export const FORGE_SHADOW_PODMAN_CONTAINER = 'stephanos-forge-shadow';
export const FORGE_SHADOW_PODMAN_DATA_VOLUME = 'stephanos-forge-shadow-data';
export const FORGE_SHADOW_PODMAN_HOST = '127.0.0.1';
export const FORGE_SHADOW_PODMAN_PORT = 3340;
export const FORGE_SHADOW_LOCAL_OWNER = 'stephanos-shadow';
export const FORGE_SHADOW_REMOTE_URL = 'https://github.com/Cheekyfellastef/stephan-os.git';
export const FORGE_SHADOW_WINDOWS_HOST_ADAPTER = 'podman-desktop-windows10-wsl2-v1';
export const FORGE_SHADOW_MINIMUM_WINDOWS_BUILD = 19043;
export const FORGE_SHADOW_MAXIMUM_WINDOWS_BUILD_EXCLUSIVE = 22000;
export const FORGE_SHADOW_REQUIRED_WINDOWS_ARCHITECTURE = 'X64';

const WSL2_EVIDENCE = Object.freeze(['default-version-2', 'distribution-version-2']);

export const FORGE_SHADOW_PODMAN_DECISIONS = Object.freeze({
  BLOCKED: 'FORGE_SHADOW_PODMAN_BLOCKED',
  PODMAN_REQUIRED: 'FORGE_SHADOW_PODMAN_PREREQUISITE_REQUIRED',
  MACHINE_INIT_REQUIRED: 'FORGE_SHADOW_PODMAN_MACHINE_INIT_REQUIRED',
  MACHINE_START_REQUIRED: 'FORGE_SHADOW_PODMAN_MACHINE_START_REQUIRED',
  IMAGE_PULL_REQUIRED: 'FORGE_SHADOW_PODMAN_IMAGE_PULL_REQUIRED',
  SERVICE_BOOTSTRAP_REQUIRED: 'FORGE_SHADOW_SERVICE_BOOTSTRAP_REQUIRED',
  MIRROR_BOOTSTRAP_REQUIRED: 'FORGE_SHADOW_MIRROR_BOOTSTRAP_REQUIRED',
  SEAL_REQUIRED: 'FORGE_SHADOW_READ_ONLY_SEAL_REQUIRED',
  PARITY_REQUIRED: 'FORGE_SHADOW_PARITY_PROOF_REQUIRED',
  READY: 'FORGE_SHADOW_M2_READY',
});

const TOP_LEVEL_KEYS = Object.freeze([
  'repository',
  'canonicalMainHead',
  'imageDigest',
  'facts',
]);
const FACT_KEYS = Object.freeze([
  'windowsBuild',
  'windowsHostAdapter',
  'windowsProductName',
  'windowsInstallationType',
  'windowsArchitecture',
  'wsl2Available',
  'wsl2Evidence',
  'podmanPresent',
  'podmanVersion',
  'machineExists',
  'machineRunning',
  'machineRootful',
  'hostPortAvailable',
  'imagePresentByDigest',
  'containerExists',
  'serviceHealthy',
  'bootstrapIdentityPresent',
  'bootstrapCredentialContained',
  'githubCredentialPresent',
  'mirrorPresent',
  'mirrorSourceHead',
  'sealedReadOnlyPosture',
  'parityReady',
  'backupReady',
]);
const BOOLEAN_FACT_KEYS = Object.freeze(FACT_KEYS.filter((key) => ![
  'windowsBuild',
  'windowsHostAdapter',
  'windowsProductName',
  'windowsInstallationType',
  'windowsArchitecture',
  'wsl2Evidence',
  'podmanVersion',
  'mirrorSourceHead',
].includes(key)));
const STRING_FACT_KEYS = Object.freeze([
  'windowsHostAdapter',
  'windowsProductName',
  'windowsInstallationType',
  'windowsArchitecture',
  'wsl2Evidence',
  'podmanVersion',
  'mirrorSourceHead',
]);
const INTEGER_FACT_KEYS = Object.freeze(['windowsBuild']);

function text(value) {
  return String(value ?? '').trim();
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function factTypeBlockers(facts) {
  const blockers = [];
  for (const key of BOOLEAN_FACT_KEYS) {
    if (typeof facts?.[key] !== 'boolean') blockers.push(`runtime-fact-type-invalid:${key}`);
  }
  for (const key of STRING_FACT_KEYS) {
    if (typeof facts?.[key] !== 'string') blockers.push(`runtime-fact-type-invalid:${key}`);
  }
  for (const key of INTEGER_FACT_KEYS) {
    if (!Number.isSafeInteger(facts?.[key]) || facts[key] < 0) blockers.push(`runtime-fact-type-invalid:${key}`);
  }
  return blockers;
}

function authority() {
  return Object.freeze({
    directMainWrite: false,
    githubRefWrite: false,
    forcePush: false,
    branchDeletion: false,
    arbitraryShell: false,
    arbitraryPowerShell: false,
    arbitraryExecutable: false,
    arbitraryPath: false,
    arbitraryNetworkTarget: false,
    publicExposure: false,
    tailscaleExposure: false,
    runnerRegistration: false,
    actionsExecution: false,
    githubCredentialCreation: false,
    githubCredentialUse: false,
    credentialPersistence: false,
    credentialLogging: false,
    hostSourceMount: false,
    hostSocketMount: false,
    defaultPodmanConnectionUse: false,
    merge: false,
  });
}

function fixedIdentity(imageDigest) {
  return Object.freeze({
    repository: FORGE_SHADOW_PODMAN_RUNTIME_REPOSITORY,
    forgejoVersion: FORGE_SHADOW_PODMAN_RUNTIME_VERSION,
    imageReference: `${FORGE_SHADOW_PODMAN_IMAGE}@${imageDigest}`,
    imageTagForResolutionOnly: `${FORGE_SHADOW_PODMAN_IMAGE}:${FORGE_SHADOW_PODMAN_IMAGE_TAG}`,
    machineName: FORGE_SHADOW_PODMAN_MACHINE,
    connectionName: FORGE_SHADOW_PODMAN_MACHINE,
    containerName: FORGE_SHADOW_PODMAN_CONTAINER,
    dataVolume: FORGE_SHADOW_PODMAN_DATA_VOLUME,
    host: FORGE_SHADOW_PODMAN_HOST,
    port: FORGE_SHADOW_PODMAN_PORT,
    localOwner: FORGE_SHADOW_LOCAL_OWNER,
    remoteUrl: FORGE_SHADOW_REMOTE_URL,
    windowsHostAdapter: FORGE_SHADOW_WINDOWS_HOST_ADAPTER,
    minimumWindowsBuild: FORGE_SHADOW_MINIMUM_WINDOWS_BUILD,
    maximumWindowsBuildExclusive: FORGE_SHADOW_MAXIMUM_WINDOWS_BUILD_EXCLUSIVE,
    requiredWindowsArchitecture: FORGE_SHADOW_REQUIRED_WINDOWS_ARCHITECTURE,
  });
}

function action(kind, details = {}) {
  return Object.freeze({ kind, ...details });
}

export function planForgeShadowPodmanRuntime(input = {}) {
  const blockers = [];
  if (!exactKeys(input, TOP_LEVEL_KEYS)) blockers.push('runtime-input-schema-unbounded');
  const repository = text(input.repository);
  const canonicalMainHead = text(input.canonicalMainHead).toLowerCase();
  const imageDigest = text(input.imageDigest).toLowerCase();
  const facts = input.facts && typeof input.facts === 'object' && !Array.isArray(input.facts) ? input.facts : {};
  if (!exactKeys(facts, FACT_KEYS)) blockers.push('runtime-facts-schema-unbounded');
  blockers.push(...factTypeBlockers(facts));

  if (repository !== FORGE_SHADOW_PODMAN_RUNTIME_REPOSITORY) blockers.push('repository-not-allowlisted');
  if (!SHA40.test(canonicalMainHead)) blockers.push('canonical-main-head-invalid');
  if (!SHA256_DIGEST.test(imageDigest)) blockers.push('forgejo-image-digest-invalid');

  if (!blockers.some((blocker) => blocker.startsWith('runtime-fact-type-invalid:'))) {
    if (facts.windowsHostAdapter !== FORGE_SHADOW_WINDOWS_HOST_ADAPTER) {
      blockers.push('windows-host-adapter-not-allowlisted');
    }
    if (facts.windowsInstallationType !== 'Client' || !/^Windows 10(?:\s|$)/.test(facts.windowsProductName)) {
      blockers.push('windows-10-client-not-proved');
    }
    if (
      facts.windowsBuild < FORGE_SHADOW_MINIMUM_WINDOWS_BUILD
      || facts.windowsBuild >= FORGE_SHADOW_MAXIMUM_WINDOWS_BUILD_EXCLUSIVE
    ) {
      blockers.push('windows-10-build-range-not-proved');
    }
    if (facts.windowsArchitecture !== FORGE_SHADOW_REQUIRED_WINDOWS_ARCHITECTURE) {
      blockers.push('windows-x64-not-proved');
    }
    if (facts.wsl2Available !== true || !WSL2_EVIDENCE.includes(facts.wsl2Evidence)) {
      blockers.push('wsl2-not-proved');
    }
    if (facts.githubCredentialPresent !== false) blockers.push('github-credential-not-allowed');
    if (facts.machineRootful === true) blockers.push('podman-machine-rootful-not-allowed');
    if (facts.bootstrapCredentialContained === false && facts.bootstrapIdentityPresent === true) {
      blockers.push('bootstrap-credential-not-contained');
    }
    if (facts.mirrorPresent === true && facts.mirrorSourceHead.trim().toLowerCase() !== canonicalMainHead) {
      blockers.push('mirror-source-head-mismatch');
    }
  }

  const base = {
    schemaVersion: FORGE_SHADOW_PODMAN_RUNTIME_SCHEMA,
    repository,
    canonicalMainHead,
    imageDigest,
    identity: fixedIdentity(imageDigest),
    authority: authority(),
  };

  if (blockers.length) {
    return Object.freeze({
      ...base,
      valid: false,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.BLOCKED,
      blockers: Object.freeze([...new Set(blockers)]),
      nextAction: null,
    });
  }

  if (facts.podmanPresent !== true || facts.podmanVersion.trim() !== '6.0.2') {
    return Object.freeze({
      ...base,
      valid: true,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.PODMAN_REQUIRED,
      blockers: Object.freeze([]),
      nextAction: action('INSTALL_OR_PROVE_FIXED_PODMAN_6_0_2_USER_SCOPE', {
        requiresSeparateHostPrerequisiteAuthorization: true,
      }),
    });
  }

  if (facts.machineExists !== true) {
    return Object.freeze({
      ...base,
      valid: true,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.MACHINE_INIT_REQUIRED,
      blockers: Object.freeze([]),
      nextAction: action('INIT_FIXED_ROOTLESS_WSL_PODMAN_MACHINE', {
        executable: 'podman.exe',
        argv: Object.freeze([
          'machine', 'init', '--provider', 'wsl', '--rootful=false', '--cpus', '4',
          '--memory', '4096', '--disk-size', '40', '--update-connection=false', FORGE_SHADOW_PODMAN_MACHINE,
        ]),
      }),
    });
  }

  if (facts.machineRunning !== true) {
    return Object.freeze({
      ...base,
      valid: true,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.MACHINE_START_REQUIRED,
      blockers: Object.freeze([]),
      nextAction: action('START_FIXED_PODMAN_MACHINE', {
        executable: 'podman.exe',
        argv: Object.freeze(['machine', 'start', '--update-connection=false', FORGE_SHADOW_PODMAN_MACHINE]),
      }),
    });
  }

  if (facts.imagePresentByDigest !== true) {
    return Object.freeze({
      ...base,
      valid: true,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.IMAGE_PULL_REQUIRED,
      blockers: Object.freeze([]),
      nextAction: action('PULL_EXACT_FORGEJO_DIGEST', {
        executable: 'podman.exe',
        argv: Object.freeze([
          '--connection', FORGE_SHADOW_PODMAN_MACHINE,
          'pull', `${FORGE_SHADOW_PODMAN_IMAGE}@${imageDigest}`,
        ]),
      }),
    });
  }

  if (facts.containerExists !== true) {
    if (facts.hostPortAvailable !== true) {
      return Object.freeze({
        ...base,
        valid: false,
        decision: FORGE_SHADOW_PODMAN_DECISIONS.BLOCKED,
        blockers: Object.freeze(['fixed-loopback-port-not-available']),
        nextAction: null,
      });
    }
    return Object.freeze({
      ...base,
      valid: true,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.SERVICE_BOOTSTRAP_REQUIRED,
      blockers: Object.freeze([]),
      nextAction: action('START_FIXED_FORGEJO_BOOTSTRAP_CONTAINER', {
        bootstrapOnly: true,
        podmanConnection: FORGE_SHADOW_PODMAN_MACHINE,
        localCredentialCreation: 'isolated-random-local-only',
        credentialPersistenceAllowed: false,
        credentialLoggingAllowed: false,
        githubCredentialAllowed: false,
      }),
    });
  }

  if (facts.serviceHealthy !== true || facts.bootstrapIdentityPresent !== true) {
    return Object.freeze({
      ...base,
      valid: true,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.SERVICE_BOOTSTRAP_REQUIRED,
      blockers: Object.freeze([]),
      nextAction: action('COMPLETE_LOCAL_ONLY_FORGE_BOOTSTRAP', {
        podmanConnection: FORGE_SHADOW_PODMAN_MACHINE,
        localOwner: FORGE_SHADOW_LOCAL_OWNER,
        randomPasswordGeneratedByForgeCli: true,
        temporaryRepositoryTokenScope: 'write:repository,write:user',
        temporaryTokenTransport: 'fixed-installer-process-memory-only',
        tokenPersistenceAllowed: false,
        tokenLoggingAllowed: false,
        tokenMustBeRevokedImmediatelyAfterMirrorCreation: true,
        githubCredentialAllowed: false,
      }),
    });
  }

  if (facts.mirrorPresent !== true) {
    return Object.freeze({
      ...base,
      valid: true,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.MIRROR_BOOTSTRAP_REQUIRED,
      blockers: Object.freeze([]),
      nextAction: action('CREATE_ONE_EXACT_PUBLIC_PULL_MIRROR', {
        remoteUrl: FORGE_SHADOW_REMOTE_URL,
        authentication: 'none-public-read',
        automaticSync: false,
        targetOwner: FORGE_SHADOW_LOCAL_OWNER,
        targetRepository: 'stephan-os',
      }),
    });
  }

  if (facts.sealedReadOnlyPosture !== true) {
    return Object.freeze({
      ...base,
      valid: true,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.SEAL_REQUIRED,
      blockers: Object.freeze([]),
      nextAction: action('SEAL_FINAL_READ_ONLY_FORGE_POSTURE', {
        podmanConnection: FORGE_SHADOW_PODMAN_MACHINE,
        disableRegistration: true,
        disableSsh: true,
        disableActions: true,
        disablePackages: true,
        disableMigrations: true,
        disablePushCreate: true,
        disableNewMirrors: true,
        disablePeriodicMirrorUpdates: true,
        readOnlyRootFilesystem: true,
        dropAllCapabilities: true,
        noNewPrivileges: true,
        writableDataSurface: '/var/lib/gitea',
        boundedEphemeralWritableSurfaces: Object.freeze(['/run', '/tmp', '/var/tmp']),
        runnerRegistration: false,
        webhookCreation: false,
        publicExposure: false,
        tailscaleExposure: false,
      }),
    });
  }

  if (facts.parityReady !== true || facts.backupReady !== true) {
    return Object.freeze({
      ...base,
      valid: true,
      decision: FORGE_SHADOW_PODMAN_DECISIONS.PARITY_REQUIRED,
      blockers: Object.freeze([]),
      nextAction: action('PROVE_EXACT_PARITY_AND_RESTORABLE_BACKUP', {
        podmanConnection: FORGE_SHADOW_PODMAN_MACHINE,
        requiredParitySchema: 'stephanos.forge-shadow-parity.v1',
        statusRecord: 'status/forge-shadow-runtime.json',
        proofRecord: 'proofs/forge-shadow-parity.json',
      }),
    });
  }

  return Object.freeze({
    ...base,
    valid: true,
    decision: FORGE_SHADOW_PODMAN_DECISIONS.READY,
    blockers: Object.freeze([]),
    nextAction: null,
    readyForM3: true,
  });
}
