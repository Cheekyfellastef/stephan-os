// Advisory labels for keys the existing canonical validator has already
// rejected. These classifiers never decide configuration or source admission.
// Subsection names and values must never become public diagnostic text.
const fixedCategories = new Map([
  ['core.worktree', 'CORE_WORKTREE'],
  ['core.sparsecheckout', 'CORE_SPARSE_CHECKOUT'],
  ['core.sparsecheckoutcone', 'CORE_SPARSE_CHECKOUT_CONE'],
  ['index.sparse', 'INDEX_SPARSE'],
  ['core.hookspath', 'CORE_HOOKS_PATH'],
  ['core.fsmonitor', 'CORE_FSMONITOR'],
  ['core.trustctime', 'CORE_TRUST_CTIME'],
  ['core.checkstat', 'CORE_CHECK_STAT'],
  ['core.ignorestat', 'CORE_IGNORE_STAT'],
  ['core.untrackedcache', 'CORE_UNTRACKED_CACHE'],
  ['core.sshcommand', 'CORE_SSH_COMMAND'],
  ['core.alternaterefscommand', 'CORE_ALTERNATE_REFS_COMMAND'],
  ['core.askpass', 'CORE_ASKPASS'],
  ['core.gitproxy', 'CORE_GIT_PROXY'],
  ['core.pager', 'CORE_PAGER'],
  ['diff.external', 'DIFF_EXTERNAL'],
  ['include.path', 'INCLUDE_PATH'],
  ['extensions.worktreeconfig', 'EXTENSIONS_WORKTREE_CONFIG'],
  ['gc.recentobjectshook', 'GC_RECENT_OBJECTS_HOOK'],
  ['interactive.difffilter', 'INTERACTIVE_DIFF_FILTER'],
  ['sequence.editor', 'SEQUENCE_EDITOR'],
  ['core.editor', 'CORE_EDITOR'],
  ['commit.gpgsign', 'COMMIT_GPG_SIGN'],
  ['tag.gpgsign', 'TAG_GPG_SIGN'],
]);
const patternedCategories = [
  [/^alias\./, 'ALIAS'],
  [/^credential\./, 'CREDENTIAL'],
  [/^filter\./, 'FILTER'],
  [/^diff\..+\.command$/, 'DIFF_COMMAND'],
  [/^diff\..+\.textconv$/, 'DIFF_TEXTCONV'],
  [/^merge\..+\.driver$/, 'MERGE_DRIVER'],
  [/^branch\..+\.mergeoptions$/, 'BRANCH_MERGE_OPTIONS'],
  [/^remote\..+\.vcs$/, 'REMOTE_VCS'],
  [/^remote\..+\.proxy$/, 'REMOTE_PROXY'],
  [/^remote\..+\.uploadpack$/, 'REMOTE_UPLOAD_PACK'],
  [/^remote\..+\.receivepack$/, 'REMOTE_RECEIVE_PACK'],
  [/^url\./, 'URL_REWRITE'],
  [/^includeif\./, 'INCLUDE_IF'],
  [/^protocol\./, 'PROTOCOL'],
  [/^submodule\..+\.update$/, 'SUBMODULE_UPDATE'],
  [/^gc\..*(hook|command)$/, 'GC_HOOK_OR_COMMAND'],
  [/^pager\./, 'PAGER'],
  [/^gpg\./, 'GPG'],
  [/^http\./, 'HTTP'],
];
const categories = new Set([...fixedCategories.values(),
  ...patternedCategories.map(([, category]) => category), 'UNKNOWN']);
const fixedToken = (value, allowed) => typeof value === 'string' && allowed.includes(value) ? value : 'UNKNOWN';

export function classifyBattleBridgeGitConfigurationRiskV1(key) {
  if (typeof key !== 'string') return 'UNKNOWN';
  return fixedCategories.get(key)
    || patternedCategories.find(([pattern]) => pattern.test(key))?.[1]
    || 'UNKNOWN';
}

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
