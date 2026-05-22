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
  { label: 'apps/stephanos/dist/', test: (f) => f.startsWith('apps/stephanos/dist/') },
  { label: 'stephanos-ui/dist/', test: (f) => f.startsWith('stephanos-ui/dist/') },
  { label: 'node_modules/', test: (f) => f.includes('/node_modules/') || f.startsWith('node_modules/') },
  { label: 'data/', test: (f) => f.startsWith('data/') },
  { label: 'stephanos-server/data/', test: (f) => f.startsWith('stephanos-server/data/') },
  { label: 'runtime/', test: (f) => f.startsWith('runtime/') },
  { label: 'logs/', test: (f) => f.startsWith('logs/') },
  { label: '.cache/', test: (f) => f.startsWith('.cache/') },
  { label: 'coverage/', test: (f) => f.startsWith('coverage/') },
  { label: 'binary-extension', test: (f) => /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|zip|7z|tar|gz|wasm|map)$/i.test(f) },
  { label: 'secrets/token-like', test: (f) => /(secret|token|credential|\.env(\.|$))/i.test(f) },
];

const stagedFiles = listFiles('git diff --cached --name-only --diff-filter=ACMR');
const headFiles = listFiles('git show --name-only --pretty="" --diff-filter=ACMR HEAD');
const filesToCheck = [...new Set([...stagedFiles, ...headFiles])];

const offenders = [];
for (const file of filesToCheck) {
  const matches = forbiddenMatchers.filter((matcher) => matcher.test(file)).map((matcher) => matcher.label);
  if (matches.length > 0) offenders.push({ file, matches });
}

if (offenders.length > 0) {
  console.error('[stephanos:guard:pr-clean] Forbidden staged/HEAD files detected:');
  offenders.forEach((offender) => {
    console.error(`- ${offender.file} (${offender.matches.join(', ')})`);
  });
  console.error('Source-only PRs must exclude generated dist/runtime/node_modules/secrets/binaries.');
  process.exit(1);
}

console.log('[stephanos:guard:pr-clean] OK: no forbidden staged/HEAD artifacts detected.');
