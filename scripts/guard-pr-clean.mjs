import { execSync } from 'node:child_process';

function listFiles(command) {
  try {
    return execSync(command, { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const forbiddenMatchers = [
  { label: 'apps/stephanos/dist/**', test: (f) => f.startsWith('apps/stephanos/dist/') },
  { label: 'stephanos-ui/dist/**', test: (f) => f.startsWith('stephanos-ui/dist/') },
  { label: 'node_modules/**', test: (f) => f.includes('/node_modules/') || f.startsWith('node_modules/') },
  { label: 'data/**', test: (f) => f.startsWith('data/') },
  { label: 'stephanos-server/data/**', test: (f) => f.startsWith('stephanos-server/data/') },
  { label: 'runtime/**', test: (f) => f.startsWith('runtime/') },
  { label: 'logs/**', test: (f) => f.startsWith('logs/') },
  { label: '.cache/**', test: (f) => f.startsWith('.cache/') },
  { label: 'coverage/**', test: (f) => f.startsWith('coverage/') },
  { label: 'binary-extension', test: (f) => /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|zip|7z|tar|gz|wasm|map)$/i.test(f) },
  { label: 'secrets/token-like', test: (f) => /(^|\/)(\.env(\.|$)|.*(secret|token|credential).*)/i.test(f) },
];

const surfaces = [
  { name: 'HEAD', files: listFiles('git show --name-only --pretty="" --diff-filter=ACMR HEAD') },
  { name: 'staged', files: listFiles('git diff --cached --name-only --diff-filter=ACMR') },
  { name: 'unstaged', files: listFiles('git diff --name-only --diff-filter=ACMR') },
  { name: 'untracked', files: listFiles('git ls-files --others --exclude-standard') },
];

const offendersBySurface = [];
for (const surface of surfaces) {
  const offenders = [];
  for (const file of [...new Set(surface.files)]) {
    const matches = forbiddenMatchers.filter((matcher) => matcher.test(file)).map((matcher) => matcher.label);
    if (matches.length > 0) offenders.push({ file, matches });
  }
  if (offenders.length > 0) offendersBySurface.push({ surface: surface.name, offenders });
}

if (offendersBySurface.length > 0) {
  console.error('PR clean guard failed: forbidden files are present before make_pr. Remove generated dist/node_modules/runtime data before PR creation.');
  for (const group of offendersBySurface) {
    console.error(`- surface=${group.surface}`);
    for (const offender of group.offenders) {
      console.error(`  - ${offender.file} (${offender.matches.join(', ')})`);
    }
  }
  process.exit(1);
}

const filesToCheck = [...new Set(surfaces.flatMap((surface) => surface.files))];

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
const touchedProtectedFile = filesToCheck.some((file) => protectedCommandDeckFiles.some((protectedFile) => file === protectedFile || file.startsWith(`${protectedFile.replace(/\\/g, '/')}/`)));
const hasProofSignal = filesToCheck.some((file) => proofSignals.some((signal) => file.includes(signal)));
if (touchedProtectedFile && !hasProofSignal) {
  console.error('[stephanos:guard:pr-clean] Protected Command Deck files changed without UI proof updates.');
  console.error('Required: include command-deck protected canon test/harness updates (e.g. tests/command-deck-protected-canon.test.mjs).');
  process.exit(1);
}

console.log('[stephanos:guard:pr-clean] OK: no forbidden artifacts in HEAD/staged/unstaged/untracked surfaces.');
