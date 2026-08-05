import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const mailboxPath = 'shared/agents/battleBridgeGitHubCommandMailbox.mjs';
let mailbox = readFileSync(mailboxPath, 'utf8');
mailbox = replaceOnce(
  mailbox,
  "import { MUSIC_SPOTIFY_LINK_OPERATION, MUSIC_SPOTIFY_LINK_SOURCE, validateMusicSpotifyLinkCandidate } from './musicSpotifyLinkBridge.mjs';\n",
  "import { MUSIC_SPOTIFY_LINK_OPERATION, MUSIC_SPOTIFY_LINK_SOURCE, validateMusicSpotifyLinkCandidate } from './musicSpotifyLinkBridge.mjs';\nimport {\n  PROTECTED_OPENCLAW_MERGE_OPERATION,\n  executeProtectedOpenClawMergeOnBattleBridge,\n  protectedOpenClawMergeFields,\n  validateProtectedOpenClawMergeCommand,\n} from './protectedOpenClawMergeMailboxAdapter.mjs';\n",
  'mailbox adapter import',
);
mailbox = replaceOnce(
  mailbox,
  "  'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',\n  MUSIC_SPOTIFY_LINK_OPERATION,",
  "  'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',\n  PROTECTED_OPENCLAW_MERGE_OPERATION,\n  MUSIC_SPOTIFY_LINK_OPERATION,",
  'operation allowlist',
);
mailbox = replaceOnce(
  mailbox,
  "  if (command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF') {",
  "  let protectedMerge = null;\n  if (command.operation === PROTECTED_OPENCLAW_MERGE_OPERATION) {\n    const validation = validateProtectedOpenClawMergeCommand(command, { now });\n    if (!validation.ok) return fail(validation.blocker, validation.details || {});\n    protectedMerge = validation.command;\n  } else {\n    const unexpectedProtectedMergeField = protectedOpenClawMergeFields().find((field) => hasValue(command[field]));\n    if (unexpectedProtectedMergeField) {\n      return fail('PROTECTED_MERGE_FIELD_NOT_ALLOWED', { field: unexpectedProtectedMergeField });\n    }\n  }\n  if (command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF') {",
  'protected merge validation',
);
mailbox = replaceOnce(
  mailbox,
  "  } else if (hasValue(command.prNumber) || hasValue(command.proofScenario)\n    || hasValue(command.proofTarget) || hasValue(command.pullRequestHead)) {",
  "  } else if (command.operation !== PROTECTED_OPENCLAW_MERGE_OPERATION\n    && (hasValue(command.prNumber) || hasValue(command.proofScenario)\n      || hasValue(command.proofTarget) || hasValue(command.pullRequestHead))) {",
  'browser fields exclusion',
);
mailbox = replaceOnce(
  mailbox,
  "      prNumber: command.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF' ? Number(command.prNumber) : 0,",
  "      prNumber: ['RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF', PROTECTED_OPENCLAW_MERGE_OPERATION].includes(command.operation)\n        ? Number(command.prNumber)\n        : 0,",
  'normalized pr number',
);
mailbox = replaceOnce(
  mailbox,
  "      ...(musicSpotifyCandidate ? {",
  "      ...(protectedMerge || {}),\n      ...(musicSpotifyCandidate ? {",
  'normalized protected merge fields',
);
mailbox = replaceOnce(
  mailbox,
  "  queueVerifiedSpotifyLink,\n  readCodexBankedResetStatus = readCodexBankedResetStatusOnBattleBridge,",
  "  queueVerifiedSpotifyLink,\n  executeProtectedOpenClawMerge = executeProtectedOpenClawMergeOnBattleBridge,\n  readCodexBankedResetStatus = readCodexBankedResetStatusOnBattleBridge,",
  'executor parameter',
);
mailbox = replaceOnce(
  mailbox,
  "    RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF: runExactHeadWindowsBrowserProof,\n    [MUSIC_SPOTIFY_LINK_OPERATION]: queueVerifiedSpotifyLink,",
  "    RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF: runExactHeadWindowsBrowserProof,\n    [PROTECTED_OPENCLAW_MERGE_OPERATION]: executeProtectedOpenClawMerge,\n    [MUSIC_SPOTIFY_LINK_OPERATION]: queueVerifiedSpotifyLink,",
  'executor handler',
);
mailbox = replaceOnce(
  mailbox,
  "    prNumber: command?.operation === 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF' ? Number(command?.prNumber || 0) : 0,",
  "    prNumber: ['RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF', PROTECTED_OPENCLAW_MERGE_OPERATION].includes(command?.operation)\n      ? Number(command?.prNumber || 0)\n      : 0,\n    expectedBase: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? String(command?.expectedBase || '') : '',\n    reviewRunId: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? Number(command?.reviewRunId || 0) : 0,\n    reviewRunAttempt: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? Number(command?.reviewRunAttempt || 0) : 0,\n    reviewJobId: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? Number(command?.reviewJobId || 0) : 0,\n    reviewArtifactId: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? Number(command?.reviewArtifactId || 0) : 0,\n    reviewArtifactDigest: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? String(command?.reviewArtifactDigest || '') : '',\n    reviewPayloadSha256: command?.operation === PROTECTED_OPENCLAW_MERGE_OPERATION ? String(command?.reviewPayloadSha256 || '') : '',",
  'receipt protected merge evidence',
);
writeFileSync(mailboxPath, mailbox, 'utf8');

const operatorPath = 'shared/agents/openClawGitHubOperator.mjs';
let operator = readFileSync(operatorPath, 'utf8');
operator = replaceOnce(
  operator,
  "  const expectedHeadSha = text(input.expectedHeadSha).toLowerCase();\n  const actualHeadSha = text(input.actualHeadSha).toLowerCase();",
  "  const expectedHeadSha = text(input.expectedHeadSha).toLowerCase();\n  const actualHeadSha = text(input.actualHeadSha).toLowerCase();\n  const requireExactBaseSha = input.requireExactBaseSha === true;\n  const expectedBaseSha = text(input.expectedBaseSha).toLowerCase();\n  const actualBaseSha = text(input.actualBaseSha).toLowerCase();",
  'operator base variables',
);
operator = replaceOnce(
  operator,
  "    if (!LOWERCASE_SHA_PATTERN.test(expectedHeadSha)) blockers.push('Exact lowercase pull request head SHA is required.');\n    if (actualHeadSha !== expectedHeadSha) blockers.push('Pull request head SHA changed or could not be verified.');",
  "    if (!LOWERCASE_SHA_PATTERN.test(expectedHeadSha)) blockers.push('Exact lowercase pull request head SHA is required.');\n    if (actualHeadSha !== expectedHeadSha) blockers.push('Pull request head SHA changed or could not be verified.');\n    if (requireExactBaseSha && !LOWERCASE_SHA_PATTERN.test(expectedBaseSha)) blockers.push('Exact lowercase pull request base SHA is required.');\n    if (requireExactBaseSha && actualBaseSha !== expectedBaseSha) blockers.push('Pull request base SHA changed or could not be verified.');",
  'operator base validation',
);
operator = replaceOnce(
  operator,
  "    expectedHeadSha,\n    actualHeadSha,",
  "    expectedHeadSha,\n    actualHeadSha,\n    requireExactBaseSha,\n    expectedBaseSha,\n    actualBaseSha,",
  'operator output base fields',
);
writeFileSync(operatorPath, operator, 'utf8');

const executorPath = 'scripts/openclaw-github-operator.mjs';
let executor = readFileSync(executorPath, 'utf8');
executor = replaceOnce(
  executor,
  "    '--json', 'headRefOid,baseRefName,mergeable,state',",
  "    '--json', 'headRefOid,baseRefName,baseRefOid,mergeable,state',",
  'executor base oid query',
);
executor = replaceOnce(
  executor,
  "    actualHeadSha: viewPayload.headRefOid,\n    baseBranch: viewPayload.baseRefName,",
  "    actualHeadSha: viewPayload.headRefOid,\n    actualBaseSha: viewPayload.baseRefOid,\n    baseBranch: viewPayload.baseRefName,",
  'executor actual base sha',
);
writeFileSync(executorPath, executor, 'utf8');

unlinkSync('.github/workflows/protected-openclaw-merge-mailbox-adapter-builder.yml');
unlinkSync('scripts/apply-protected-openclaw-merge-mailbox-adapter.mjs');
