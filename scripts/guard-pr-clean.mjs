import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const STRICT_BASE = 'origin/main';
const STRICT_RANGE = `${STRICT_BASE}...HEAD`;
const VERDICTS = {
  strictPass: 'PASS_STRICT_REMOTE_PROOF',
  strictRemoteUnavailable: 'FAIL_REMOTE_UNAVAILABLE',
  localPassRemoteUnavailable: 'PASS_LOCAL_CLEAN_REMOTE_UNAVAILABLE',
  failDirty: 'FAIL_DIRTY',
  failGeneratedDist: 'FAIL_GENERATED_DIST',
  failOpenClawRootDirt: 'FAIL_OPENCLAW_ROOT_DIRT',
  failProtectedCanon: 'FAIL_PROTECTED_CANON',
  failUnknown: 'FAIL_UNKNOWN',
};

const forbiddenMatchers = [
  { reason: 'generated dist: apps/stephanos/dist/**', test: (f) => f.startsWith('apps/stephanos/dist/') },
  { reason: 'generated dist: stephanos-ui/dist/**', test: (f) => f.startsWith('stephanos-ui/dist/') },
  { reason: 'OpenClaw root workspace dirt', test: (f) => f === '.openclaw' || f.startsWith('.openclaw/') || f === 'memory' || f.startsWith('memory/') || ['COMMANDS.md', 'DREAMS.md', 'HEARTBEAT.md', 'IDENTITY.md', 'MEMORY.md', 'SOUL.md', 'TOOLS.md', 'USER.md', 'exec_output.txt', 'workspace_contents.txt'].includes(f) },
  { reason: 'dependency artifact: node_modules/**', test: (f) => f.includes('/node_modules/') || f.startsWith('node_modules/') },
  { reason: 'runtime/generated data: data/**', test: (f) => f.startsWith('data/') },
  { reason: 'runtime/generated data: stephanos-server/data/**', test: (f) => f.startsWith('stephanos-server/data/') },
  { reason: 'runtime/generated data: runtime/**', test: (f) => f.startsWith('runtime/') },
  { reason: 'runtime/generated data: **/runtime-data/**', test: (f) => f.includes('/runtime-data/') || f.startsWith('runtime-data/') },
  { reason: 'logs: logs/** or *.log', test: (f) => f.startsWith('logs/') || /(^|\/)logs\//i.test(f) || /(^|\/)[^/]+\.log$/i.test(f) },
  { reason: 'cache/coverage artifact', test: (f) => f.startsWith('.cache/') || f.startsWith('coverage/') || f.includes('/.cache/') || f.includes('/coverage/') },
  { reason: 'screenshot/image artifact', test: (f) => /(^|\/)(screenshots?|artifacts?)\//i.test(f) || /\.(png|jpg|jpeg|gif|webp|ico|bmp|tiff?|svg)$/i.test(f) },
  { reason: 'archive artifact', test: (f) => /\.(zip|7z|tar|gz|tgz|bz2|xz|rar)$/i.test(f) },
  { reason: 'font/binary artifact', test: (f) => /\.(woff2?|ttf|otf|eot|exe|dll|dylib|so|wasm|bin|pdf)$/i.test(f) },
  { reason: 'secret/env/token-like path', test: (f) => /(^|\/)(\.env($|\.)|.*(secret|secrets|token|credential|credentials|apikey|api-key|private-key|id_rsa).*)/i.test(f) },
];

const protectedCommandDeckFiles = [
  'stephanos-ui/src/components/AIConsole.jsx',
  'stephanos-ui/src/hooks/useAIConsole.js',
  'stephanos-ui/src/components/MissionConsoleTile.jsx',
  'stephanos-ui/src/styles.css',
  'stephanos-ui/src/components/CollapsiblePanel.jsx',
  'stephanos-ui/src/state/aiStore.js',
  'stephanos-ui/src/state/supportSnapshot.js',
  'stephanos-ui/src/state/uiRealityStatus.js',
];
const proofSignals = [
  'tests/command-deck-protected-canon.test.mjs',
  'stephanos-ui/src/components/AIConsole.render.test.mjs',
  'playwright.config',
  '.spec.',
];

function runGit(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', options.quiet ? 'pipe' : 'inherit'] });
}

function tryGit(args) {
  try {
    return { ok: true, stdout: runGit(args, { quiet: true }) };
  } catch (error) {
    return { ok: false, error, stdout: error?.stdout?.toString?.() ?? '', stderr: error?.stderr?.toString?.() ?? error?.message ?? '' };
  }
}

function lines(output) {
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

function unique(items) {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

function resolveRef(ref = STRICT_BASE) {
  const result = tryGit(['rev-parse', '--verify', `${ref}^{commit}`]);
  return result.ok ? result.stdout.trim() : null;
}

function strictProofStatus() {
  const originMainCommit = resolveRef(STRICT_BASE);
  if (originMainCommit) return { available: true, ref: STRICT_BASE, commit: originMainCommit, range: STRICT_RANGE, source: 'origin-main' };

  const upstream = tryGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const upstreamRef = upstream.ok ? upstream.stdout.trim() : '';
  if (upstreamRef && upstreamRef !== '@{u}') {
    const upstreamCommit = resolveRef(upstreamRef);
    if (upstreamCommit) return { available: true, ref: upstreamRef, commit: upstreamCommit, range: `${upstreamRef}...HEAD`, source: 'upstream-tracking-branch' };
  }

  return {
    available: false,
    ref: STRICT_BASE,
    upstreamRef,
    reason: upstream.ok ? 'origin/main and upstream tracking branch cannot be resolved' : 'origin/main cannot be resolved and current branch has no upstream tracking branch',
  };
}

function changedFilesForRange(range = STRICT_RANGE) {
  return lines(runGit(['diff', '--name-only', '--diff-filter=ACMR', range]));
}

function numstatRowsForRange(range = STRICT_RANGE) {
  return lines(runGit(['diff', '--numstat', range]));
}

function changedFilesForLocal() {
  const staged = lines(runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR']));
  const unstaged = lines(runGit(['diff', '--name-only', '--diff-filter=ACMR']));
  const untracked = lines(runGit(['ls-files', '--others', '--exclude-standard']));
  return { staged, unstaged, untracked };
}

function resolveLocalFallbackDiffBase() {
  const mainBase = tryGit(['merge-base', 'HEAD', 'main']);
  const baseSha = mainBase.ok ? mainBase.stdout.trim() : '';
  if (baseSha) return { label: 'merge-base main...HEAD', range: `${baseSha}...HEAD`, available: true, strict: false };

  const headParent = resolveRef('HEAD~1');
  if (headParent) return { label: 'HEAD~1..HEAD', range: 'HEAD~1..HEAD', available: true, strict: false };

  return { label: 'unavailable', range: '', available: false, strict: false };
}

function binaryFilesFromNumstatRows(rows) {
  return rows
    .map((row) => row.split('\t'))
    .filter((parts) => parts.length >= 3)
    .filter(([added, deleted]) => added === '-' || deleted === '-')
    .map((parts) => parts.slice(2).join('\t'));
}

function localBinaryFiles(localFiles) {
  const rows = [
    ...lines(runGit(['diff', '--cached', '--numstat'])),
    ...lines(runGit(['diff', '--numstat'])),
  ];
  const binary = binaryFilesFromNumstatRows(rows);

  for (const file of localFiles.untracked) {
    if (!existsSync(file)) continue;
    try {
      const sample = readFileSync(file, { encoding: null, flag: 'r' }).subarray(0, 8000);
      if (sample.includes(0)) binary.push(file);
    } catch {
      // Ignore unreadable files here; path matchers still apply and Git will fail if they are staged later.
    }
  }

  return unique(binary);
}

function forbiddenReasons(file) {
  return forbiddenMatchers.filter((matcher) => matcher.test(file)).map((matcher) => matcher.reason);
}

function artifactOffenders(files, surface) {
  const offenders = [];
  for (const file of unique(files)) {
    const reasons = forbiddenReasons(file);
    for (const reason of reasons) offenders.push({ surface, file, reason });
  }
  return offenders;
}

function binaryOffenders(files, surface) {
  return unique(files).map((file) => ({ surface, file, reason: 'binary file detected by git diff --numstat' }));
}

function commandDeckProofOffenders(files, surface) {
  const uniqueFiles = unique(files);
  const touchedProtectedFile = uniqueFiles.some((file) => protectedCommandDeckFiles.some((protectedFile) => file === protectedFile));
  const hasProofSignal = uniqueFiles.some((file) => proofSignals.some((signal) => file.includes(signal)));
  if (!touchedProtectedFile || hasProofSignal) return [];
  return [{
    surface,
    file: protectedCommandDeckFiles.filter((protectedFile) => uniqueFiles.includes(protectedFile)).join(', '),
    reason: 'Protected Command Deck files changed without UI proof updates',
  }];
}

function allowedFiles(files) {
  return unique(files).filter((file) => forbiddenReasons(file).length === 0);
}

function formatList(title, files) {
  const body = unique(files);
  console.log(title);
  if (body.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const file of body) console.log(`  - ${file}`);
}

function printOffenders(offenders) {
  console.error('[stephanos:guard:pr-clean] Offenders:');
  for (const offender of offenders) {
    console.error(`  - ${offender.file} [${offender.surface}] — ${offender.reason}`);
  }
}

function classifyOffenders(offenders) {
  if (offenders.some((offender) => /generated dist/i.test(offender.reason))) return VERDICTS.failGeneratedDist;
  if (offenders.some((offender) => /OpenClaw root workspace dirt/i.test(offender.reason))) return VERDICTS.failOpenClawRootDirt;
  if (offenders.some((offender) => /Protected Command Deck/i.test(offender.reason))) return VERDICTS.failProtectedCanon;
  if (offenders.length > 0) return VERDICTS.failDirty;
  return VERDICTS.failUnknown;
}

export function analyzeStrictPr() {
  const proof = strictProofStatus();
  if (!proof.available) {
    return {
      mode: 'strict',
      proof,
      diffBase: { label: 'unavailable', range: STRICT_RANGE, available: false, strict: true },
      changedFiles: [],
      allowedFiles: [],
      offenders: [],
      verdict: VERDICTS.strictRemoteUnavailable,
    };
  }

  const changedFiles = unique(changedFilesForRange(proof.range));
  const numstatRows = numstatRowsForRange(proof.range);
  const offenders = [
    ...artifactOffenders(changedFiles, proof.range),
    ...binaryOffenders(binaryFilesFromNumstatRows(numstatRows), proof.range),
    ...commandDeckProofOffenders(changedFiles, proof.range),
  ];
  return {
    mode: 'strict',
    proof,
    diffBase: { label: proof.range, range: proof.range, available: true, strict: true },
    changedFiles,
    allowedFiles: allowedFiles(changedFiles),
    offenders,
    verdict: offenders.length > 0 ? classifyOffenders(offenders) : VERDICTS.strictPass,
  };
}

export function analyzeLocalFallback() {
  const local = changedFilesForLocal();
  const allFiles = unique([...local.staged, ...local.unstaged, ...local.untracked]);
  const fallbackDiff = resolveLocalFallbackDiffBase();
  const fallbackFiles = fallbackDiff.available ? unique(changedFilesForRange(fallbackDiff.range)) : [];
  const offenders = [
    ...allFiles.map((file) => ({ surface: 'local working tree', file, reason: 'changed/untracked file remains after expected cleanup' })),
    ...artifactOffenders(local.staged, 'staged'),
    ...artifactOffenders(local.unstaged, 'unstaged'),
    ...artifactOffenders(local.untracked, 'untracked'),
    ...binaryOffenders(localBinaryFiles(local), 'local working tree'),
    ...commandDeckProofOffenders(allFiles, 'local working tree'),
  ];
  if (!fallbackDiff.available) {
    offenders.push({ surface: 'local fallback diff', file: 'HEAD', reason: 'local fallback diff base unavailable' });
  }
  return {
    mode: 'local',
    proof: strictProofStatus(),
    diffBase: fallbackDiff,
    fallbackFiles,
    changedFiles: allFiles,
    allowedFiles: allowedFiles(allFiles),
    offenders,
    local,
    verdict: offenders.length > 0 ? classifyOffenders(offenders) : VERDICTS.localPassRemoteUnavailable,
  };
}

function exitForAnalysis(analysis, { successMessage, unavailableMessage, verdictPrefix }) {
  if (verdictPrefix) console.log(`${verdictPrefix}=${analysis.verdict}`);
  if (analysis.diffBase) console.log(`STEPHANOS_PR_CLEAN_DIFF_BASE=${analysis.diffBase.label}`);
  if (analysis.proof && !analysis.proof.available && unavailableMessage) console.error(unavailableMessage);
  if (analysis.verdict === VERDICTS.strictRemoteUnavailable) process.exit(1);
  if (analysis.offenders.length > 0) {
    console.error(`[stephanos:guard:pr-clean] FAILED (${analysis.mode} mode).`);
    printOffenders(analysis.offenders);
    process.exit(1);
  }
  console.log(successMessage);
}

function runStrictMode() {
  const analysis = analyzeStrictPr();
  formatList(`[stephanos:guard:pr-clean] Changed files in ${analysis.diffBase.label}:`, analysis.changedFiles);
  formatList('[stephanos:guard:pr-clean] Allowed changed files:', analysis.allowedFiles);
  exitForAnalysis(analysis, {
    successMessage: `[stephanos:guard:pr-clean] OK: strict PR proof passed for ${analysis.diffBase.label}.`,
    unavailableMessage: `[stephanos:guard:pr-clean] Strict PR proof unavailable: ${analysis.proof.reason}.`,
    verdictPrefix: 'STEPHANOS_PR_CLEAN_STRICT_VERDICT',
  });
}

function runLocalMode() {
  const analysis = analyzeLocalFallback();
  formatList('[stephanos:guard:pr-clean:local] Local changed/untracked files:', analysis.changedFiles);
  formatList('[stephanos:guard:pr-clean:local] Locally allowed source files:', analysis.allowedFiles);
  if (!analysis.proof.available) {
    console.error(`[stephanos:guard:pr-clean:local] Strict PR proof unavailable: ${analysis.proof.reason}. Local fallback is not strict PR proof.`);
  }
  formatList(`[stephanos:guard:pr-clean:local] Fallback diff files in ${analysis.diffBase.label}:`, analysis.fallbackFiles);
  exitForAnalysis(analysis, {
    successMessage: '[stephanos:guard:pr-clean:local] OK: local clean fallback passed. Strict remote PR proof not claimed.',
    verdictPrefix: 'STEPHANOS_PR_CLEAN_LOCAL_VERDICT',
  });
}

function runPrepareMode() {
  const local = analyzeLocalFallback();
  const strict = analyzeStrictPr();
  const changed = unique([...strict.changedFiles, ...local.changedFiles]);
  const allowed = allowedFiles(changed);

  formatList('[stephanos:pr:prepare] Exact changed-file list:', changed);
  formatList('[stephanos:pr:prepare] Allowed-file list:', allowed);

  const offenders = [...local.offenders, ...strict.offenders];
  if (!strict.proof.available) {
    console.error('[stephanos:pr:prepare] Strict PR proof is required but unavailable: origin/main cannot be resolved.');
    process.exit(1);
  }
  if (offenders.length > 0) {
    console.error('[stephanos:pr:prepare] FAILED: PR candidate is not source-only clean.');
    printOffenders(offenders);
    process.exit(1);
  }

  console.log('[stephanos:pr:prepare] OK: local guard and strict origin/main...HEAD proof passed.');
}

function main() {
  const arg = process.argv[2] ?? '--strict';
  if (arg === '--strict' || arg === 'strict') return runStrictMode();
  if (arg === '--local' || arg === 'local') return runLocalMode();
  if (arg === '--prepare' || arg === 'prepare') return runPrepareMode();
  console.error(`Unknown guard mode: ${arg}`);
  console.error('Usage: node scripts/guard-pr-clean.mjs [--strict|--local|--prepare]');
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
