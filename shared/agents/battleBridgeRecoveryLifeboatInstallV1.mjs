export const BATTLE_BRIDGE_LIFEBOAT_INSTALL_SCHEMA = 'stephanos.battle-bridge-recovery-lifeboat-install.v1';
export const BATTLE_BRIDGE_LIFEBOAT_TASK_NAME = 'Stephanos Battle Bridge Recovery Lifeboat';
export const BATTLE_BRIDGE_LIFEBOAT_ROOT_SUFFIX = 'Stephanos\\BattleBridgeRecoveryLifeboat';
export const BATTLE_BRIDGE_LIFEBOAT_ACTIVE_LAUNCHER = 'launch-active-bank-v1.ps1';
export const BATTLE_BRIDGE_LIFEBOAT_BANK_RUNNER = 'run-battle-bridge-recovery-lifeboat-bank-v1.ps1';
export const BATTLE_BRIDGE_LIFEBOAT_FIXED_ACTION = 'actions/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1';

const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

function blocked(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    schemaVersion: BATTLE_BRIDGE_LIFEBOAT_INSTALL_SCHEMA,
    blocker,
    installPlan: null,
    activeBankOverwriteAllowed: false,
    dualBankOverwriteAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    gitMutationAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
    ...details,
  });
}

function normalizeBankId(value) {
  return value === 'A' || value === 'B' ? value : '';
}

export function planBattleBridgeRecoveryLifeboatInstall({
  candidateVersion = '',
  candidateManifestSha256 = '',
  activeBank = '',
  activeManifestSha256 = '',
  activeSelfTestVerdict = '',
  activeHeartbeatFresh = false,
  platform = 'win32',
} = {}) {
  if (platform !== 'win32') return blocked('LIFEBOAT_INSTALL_WINDOWS_REQUIRED');
  if (!VERSION.test(candidateVersion)) return blocked('LIFEBOAT_INSTALL_VERSION_INVALID');
  if (!SHA256.test(candidateManifestSha256)) return blocked('LIFEBOAT_INSTALL_MANIFEST_INVALID');

  const normalizedActiveBank = normalizeBankId(activeBank);
  if (!normalizedActiveBank) {
    return Object.freeze({
      ok: true,
      schemaVersion: BATTLE_BRIDGE_LIFEBOAT_INSTALL_SCHEMA,
      blocker: '',
      installPlan: Object.freeze({
        mode: 'BOOTSTRAP_SINGLE_KNOWN_GOOD_BANK',
        targetBank: 'A',
        rollbackBank: '',
        candidateVersion,
        candidateManifestSha256,
        productionRedundancyReadyAfter: false,
        reason: 'A second distinct proven bank is required before A/B rollback can be claimed.',
      }),
      activeBankOverwriteAllowed: false,
      dualBankOverwriteAllowed: false,
      arbitraryPathAllowed: false,
      arbitraryTaskNameAllowed: false,
      arbitraryExecutableAllowed: false,
      arbitraryShellAllowed: false,
      gitMutationAllowed: false,
      sourceMutationAllowed: false,
      pcRestartAllowed: false,
    });
  }

  if (!SHA256.test(activeManifestSha256)) return blocked('LIFEBOAT_ACTIVE_MANIFEST_INVALID');
  if (activeSelfTestVerdict !== 'PASS' || activeHeartbeatFresh !== true) {
    return blocked('LIFEBOAT_ACTIVE_BANK_NOT_KNOWN_GOOD', { activeBank: normalizedActiveBank });
  }
  if (candidateManifestSha256 === activeManifestSha256) {
    return blocked('LIFEBOAT_CANDIDATE_NOT_DISTINCT', { activeBank: normalizedActiveBank });
  }

  const targetBank = normalizedActiveBank === 'A' ? 'B' : 'A';
  return Object.freeze({
    ok: true,
    schemaVersion: BATTLE_BRIDGE_LIFEBOAT_INSTALL_SCHEMA,
    blocker: '',
    installPlan: Object.freeze({
      mode: 'STAGE_INACTIVE_BANK',
      targetBank,
      rollbackBank: normalizedActiveBank,
      candidateVersion,
      candidateManifestSha256,
      requireCandidateSelfTestPass: true,
      requireCandidateHeartbeatFresh: true,
      atomicActiveBankSwitchRequired: true,
      retainRollbackBankRequired: true,
      productionRedundancyReadyAfter: true,
    }),
    activeBankOverwriteAllowed: false,
    dualBankOverwriteAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    arbitraryShellAllowed: false,
    gitMutationAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
  });
}
