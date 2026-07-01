import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const GENERATED_ALLOWLIST = [
  'apps/stephanos/dist/',
  'stephanos-ui/dist/',
  'stephanos-ui/.vite/',
  'stephanos-ui/node_modules/.vite/',
  'tmp/stephanos-ignition/',
];
const DEFAULT_RUNTIME_URL = 'http://127.0.0.1:4173/apps/stephanos/dist/index.html';

function normalizePath(value = '') {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isKnownGeneratedPath(pathname = '') {
  const normalized = normalizePath(pathname);
  return GENERATED_ALLOWLIST.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

export function parseGitPorcelain(statusText = '') {
  return String(statusText)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const renameTarget = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath;
      return { status, path: normalizePath(renameTarget) };
    });
}

export function classifyWorkspaceDirt(statusText = '') {
  const entries = parseGitPorcelain(statusText);
  const safeGenerated = [];
  const unsafe = [];
  for (const entry of entries) {
    if (isKnownGeneratedPath(entry.path)) safeGenerated.push({ ...entry, classification: 'safe-generated' });
    else unsafe.push({ ...entry, classification: 'approval-required' });
  }
  return {
    entries,
    safeGenerated,
    unsafe,
    blocked: unsafe.length > 0,
    summary: unsafe.length > 0
      ? `Blocked by ${unsafe.length} approval-required workspace item(s).`
      : safeGenerated.length > 0
        ? `Safe generated dirt detected: ${safeGenerated.length} item(s).`
        : 'Workspace clean.',
  };
}

export function buildIgnitionStatusModel({
  workspace = classifyWorkspaceDirt(''),
  autofixAttempted = false,
  autofixApplied = [],
  runtimeUrl = DEFAULT_RUNTIME_URL,
  phase = 'preflight',
  error = '',
} = {}) {
  const blocked = Boolean(workspace.blocked || error);
  return {
    title: 'Stephanos Ignition',
    phase,
    state: blocked ? 'blocked' : 'ready',
    stages: [
      { label: 'Finding Stephanos repo', state: 'done' },
      { label: 'Checking workspace dirt', state: 'done' },
      { label: 'Classifying safe vs unsafe dirt', state: workspace.blocked ? 'blocked' : 'done' },
      { label: 'Cleaning only safe generated/runtime stoppers', state: autofixAttempted ? 'done' : 'waiting' },
      { label: 'Checking dependencies', state: blocked ? 'waiting' : 'ready' },
      { label: 'Checking ports and existing runtime', state: blocked ? 'waiting' : 'ready' },
      { label: 'Starting local services', state: blocked ? 'waiting' : 'ready' },
      { label: 'Opening Command Deck', state: blocked ? 'waiting' : 'ready' },
    ],
    blocker: error || (workspace.blocked ? workspace.summary : ''),
    autofixAttempted,
    autofixApplied,
    operatorAction: blocked
      ? 'Review the support snapshot. Commit, stash, or explicitly approve risky source dirt before ignition cleanup continues.'
      : 'Continue ignition. Safe generated stoppers are handled by the concierge.',
    runtimeUrl,
    supportSnapshot: {
      workspaceSummary: workspace.summary,
      safeGenerated: workspace.safeGenerated.map((entry) => entry.path),
      approvalRequired: workspace.unsafe.map((entry) => entry.path),
      safetyBoundaries: [
        'no source deletion',
        'no hidden blockers',
        'known generated auto-fix only',
        'exact-head merge approval still required',
      ],
    },
  };
}

export function renderSplashHtml(model) {
  const rows = model.stages.map((stage) => `<li><strong>${escapeHtml(stage.label)}</strong>: ${escapeHtml(stage.state)}</li>`).join('\n');
  const snapshot = escapeHtml(JSON.stringify(model.supportSnapshot, null, 2));
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(model.title)} ${escapeHtml(model.state)}</title></head>
<body>
  <main data-testid="stephanos-ignition-concierge" data-ignition-state="${escapeHtml(model.state)}">
    <h1>${escapeHtml(model.title)}</h1>
    <p><strong>Phase:</strong> ${escapeHtml(model.phase)}</p>
    <ol>${rows}</ol>
    ${model.blocker ? `<section><h2>Blocked by</h2><p>${escapeHtml(model.blocker)}</p></section>` : ''}
    <section><h2>Operator action</h2><p>${escapeHtml(model.operatorAction)}</p></section>
    <section><h2>Command Deck</h2><a href="${escapeHtml(model.runtimeUrl)}">${escapeHtml(model.runtimeUrl)}</a></section>
    <section><h2>Copy support snapshot</h2><pre>${snapshot}</pre></section>
  </main>
</body>
</html>
`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function getGitStatus() {
  const result = run('git', ['status', '--porcelain=v1']);
  if (result.error || result.status !== 0) throw new Error(`git status failed: ${result.error?.message || result.stderr || result.status}`);
  return result.stdout || '';
}

function applySafeAutofix(classification) {
  const applied = [];
  for (const entry of classification.safeGenerated) {
    if (entry.status === '??') {
      rmSync(resolve(entry.path), { recursive: true, force: true });
      applied.push(`removed untracked generated ${entry.path}`);
    } else {
      const result = run('git', ['restore', '--', entry.path], { stdio: 'pipe' });
      if (result.error || result.status !== 0) throw new Error(`safe generated restore failed for ${entry.path}: ${result.error?.message || result.stderr || result.status}`);
      applied.push(`restored generated ${entry.path}`);
    }
  }
  return applied;
}

function openFile(pathname) {
  if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', 'start', '', pathname]);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const approveSafeAutofix = args.has('--approve-safe-autofix');
  const dryRun = args.has('--dry-run');
  const proofOnly = args.has('--proof');
  const outDir = resolve('tmp/stephanos-ignition');
  mkdirSync(outDir, { recursive: true });

  let classification = classifyWorkspaceDirt(getGitStatus());
  let autofixApplied = [];
  let autofixAttempted = false;
  if (!classification.blocked && classification.safeGenerated.length > 0 && approveSafeAutofix && !dryRun) {
    autofixAttempted = true;
    autofixApplied = applySafeAutofix(classification);
    classification = classifyWorkspaceDirt(getGitStatus());
  }

  const model = buildIgnitionStatusModel({ workspace: classification, autofixAttempted, autofixApplied, phase: proofOnly || dryRun || classification.blocked ? 'preflight' : 'launching' });
  const splashPath = join(outDir, 'ignition-splash.html');
  const snapshotPath = join(outDir, 'ignition-support-snapshot.json');
  writeFileSync(splashPath, renderSplashHtml(model), 'utf8');
  writeFileSync(snapshotPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  console.log(`STEPHANOS_IGNITION_CONCIERGE_V1 state=${model.state}`);
  console.log(`splash=${splashPath}`);
  console.log(`snapshot=${snapshotPath}`);

  if (classification.blocked) {
    openFile(splashPath);
    process.exitCode = 2;
    return;
  }
  if (dryRun || proofOnly) return;

  openFile(splashPath);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const launch = run(npm, ['run', 'stephanos:ignite', '--', '--skip-auto-pull'], { stdio: 'inherit' });
  if (launch.error || launch.status !== 0) {
    const errorModel = buildIgnitionStatusModel({ workspace: classifyWorkspaceDirt(getGitStatus()), autofixAttempted, autofixApplied, phase: 'blocked', error: `Underlying ignition command failed: ${launch.error?.message || launch.status}` });
    writeFileSync(splashPath, renderSplashHtml(errorModel), 'utf8');
    writeFileSync(snapshotPath, `${JSON.stringify(errorModel, null, 2)}\n`, 'utf8');
    process.exitCode = launch.status || 1;
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('stephanos-ignition-concierge.mjs')) {
  main().catch((error) => {
    const model = buildIgnitionStatusModel({ phase: 'blocked', error: error.message });
    mkdirSync(resolve('tmp/stephanos-ignition'), { recursive: true });
    writeFileSync(resolve('tmp/stephanos-ignition/ignition-splash.html'), renderSplashHtml(model), 'utf8');
    writeFileSync(resolve('tmp/stephanos-ignition/ignition-support-snapshot.json'), `${JSON.stringify(model, null, 2)}\n`, 'utf8');
    console.error(error);
    process.exitCode = 1;
  });
}
