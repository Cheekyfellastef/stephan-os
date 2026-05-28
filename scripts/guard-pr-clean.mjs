import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const STRICT_BASE = 'origin/main';
const STRICT_RANGE = `${STRICT_BASE}...HEAD`;

const forbiddenMatchers = [
  { reason: 'generated dist: apps/stephanos/dist/**', test: (f) => f.startsWith('apps/stephanos/dist/') },
  { reason: 'generated dist: stephanos-ui/dist/**', test: (f) => f.startsWith('stephanos-ui/dist/') },
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
  const commit = resolveRef(STRICT_BASE);
  return commit ? { available: true, ref: STRICT_BASE, commit } : { available: false, ref: STRICT_BASE };
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

export function analyzeStrictPr() {
  const proof = strictProofStatus();
  if (!proof.available) {
    return {
      mode: 'strict',
      proof,
      changedFiles: [],
      allowedFiles: [],
      offenders: [{ surface: 'strict PR proof', file: STRICT_BASE, reason: 'origin/main cannot be resolved; strict PR mode fails closed' }],
    };
  }

  const changedFiles = unique(changedFilesForRange());
  const numstatRows = numstatRowsForRange();
  const offenders = [
    ...artifactOffenders(changedFiles, STRICT_RANGE),
    ...binaryOffenders(binaryFilesFromNumstatRows(numstatRows), STRICT_RANGE),
    ...commandDeckProofOffenders(changedFiles, STRICT_RANGE),
  ];
  return { mode: 'strict', proof, changedFiles, allowedFiles: allowedFiles(changedFiles), offenders };
}

export function analyzeLocalFallback() {
  const local = changedFilesForLocal();
  const allFiles = unique([...local.staged, ...local.unstaged, ...local.untracked]);
  const offenders = [
    ...artifactOffenders(local.staged, 'staged'),
    ...artifactOffenders(local.unstaged, 'unstaged'),
    ...artifactOffenders(local.untracked, 'untracked'),
    ...binaryOffenders(localBinaryFiles(local), 'local working tree'),
    ...commandDeckProofOffenders(allFiles, 'local working tree'),
  ];
  return {
    mode: 'local',
    proof: strictProofStatus(),
    changedFiles: allFiles,
    allowedFiles: allowedFiles(allFiles),
    offenders,
    local,
  };
}

function exitForAnalysis(analysis, { successMessage, unavailableMessage }) {
  if (analysis.proof && !analysis.proof.available && unavailableMessage) {
    console.error(unavailableMessage);
  }
  if (analysis.offenders.length > 0) {
    console.error(`[stephanos:guard:pr-clean] FAILED (${analysis.mode} mode).`);
    printOffenders(analysis.offenders);
    process.exit(1);
  }
  console.log(successMessage);
}

function runStrictMode() {
  const analysis = analyzeStrictPr();
  formatList('[stephanos:guard:pr-clean] Changed files in origin/main...HEAD:', analysis.changedFiles);
  formatList('[stephanos:guard:pr-clean] Allowed changed files:', analysis.allowedFiles);
  exitForAnalysis(analysis, {
    successMessage: '[stephanos:guard:pr-clean] OK: strict PR proof passed for origin/main...HEAD.',
    unavailableMessage: '[stephanos:guard:pr-clean] Strict PR proof unavailable: origin/main cannot be resolved.',
  });
}

function runLocalMode() {
  const analysis = analyzeLocalFallback();
  formatList('[stephanos:guard:pr-clean:local] Local changed/untracked files:', analysis.changedFiles);
  formatList('[stephanos:guard:pr-clean:local] Locally allowed source files:', analysis.allowedFiles);
  if (!analysis.proof.available) {
    console.error('[stephanos:guard:pr-clean:local] Strict PR proof unavailable: origin/main cannot be resolved. Local fallback is not PR-clean proof.');
  }
  exitForAnalysis(analysis, {
    successMessage: '[stephanos:guard:pr-clean:local] OK: local fallback found no forbidden staged/unstaged/untracked files. Strict PR proof not claimed.',
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
