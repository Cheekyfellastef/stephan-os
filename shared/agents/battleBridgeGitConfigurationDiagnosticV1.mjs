// Independent public vocabulary for untrusted producer diagnostics. No raw
// key, subsection or value is accepted here, and no source authority is added.
const categories = new Set([
  'ALIAS', 'CORE_WORKTREE', 'CORE_SPARSE_CHECKOUT', 'CORE_SPARSE_CHECKOUT_CONE', 'INDEX_SPARSE',
  'CORE_HOOKS_PATH', 'CORE_FSMONITOR', 'CORE_TRUST_CTIME', 'CORE_CHECK_STAT', 'CORE_IGNORE_STAT',
  'CORE_UNTRACKED_CACHE', 'CORE_SSH_COMMAND', 'CORE_ALTERNATE_REFS_COMMAND', 'CORE_ASKPASS',
  'CORE_GIT_PROXY', 'CORE_PAGER', 'DIFF_EXTERNAL', 'CREDENTIAL', 'FILTER', 'DIFF_COMMAND',
  'DIFF_TEXTCONV', 'MERGE_DRIVER', 'BRANCH_MERGE_OPTIONS', 'REMOTE_VCS', 'REMOTE_PROXY',
  'REMOTE_UPLOAD_PACK', 'REMOTE_RECEIVE_PACK', 'URL_REWRITE', 'INCLUDE_PATH', 'INCLUDE_IF',
  'PROTOCOL', 'EXTENSIONS_WORKTREE_CONFIG', 'SUBMODULE_UPDATE', 'GC_HOOK_OR_COMMAND',
  'GC_RECENT_OBJECTS_HOOK', 'PAGER', 'INTERACTIVE_DIFF_FILTER', 'SEQUENCE_EDITOR', 'CORE_EDITOR',
  'GPG', 'COMMIT_GPG_SIGN', 'TAG_GPG_SIGN', 'HTTP', 'UNKNOWN',
]);
const fixedToken = (value, allowed) => typeof value === 'string' && allowed.includes(value) ? value : 'UNKNOWN';

export function projectBattleBridgeGitConfigurationDiagnosticV1(value = {}) {
  value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const risks = Array.isArray(value.riskCategories) && value.riskCategories.length <= categories.size
    ? Array.from(value.riskCategories, category =>
      typeof category === 'string' && categories.has(category) ? category : 'UNKNOWN')
    : ['UNKNOWN'];
  return Object.freeze({
    stage: fixedToken(value.stage, ['BEFORE_FETCH', 'AFTER_FETCH']),
    originCount: fixedToken(value.originCount, ['ZERO', 'ONE', 'MULTIPLE']),
    originMatch: fixedToken(value.originMatch, ['CANONICAL', 'NONCANONICAL']),
    riskCategories: Object.freeze([...new Set(risks)].sort()),
  });
}
