#!/usr/bin/env node
// Separate fixed frontend startup; never a general maintenance-hold exemption.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createStephanosDistServer } from './serve-stephanos-dist.mjs';
import { repoRoot, createStephanosDistManifest, computeStephanosDistManifestFingerprint } from './stephanos-build-utils.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const SCHEMA = 'stephanos.frontend-start-only.v1';
const MAX_BYTES = 128 * 1024 * 1024;
const fail = code => { throw new Error(code); };
const HEX = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const node = 'C:\\Program Files\\nodejs\\node.exe';
const git = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git';
const environment = process.platform === 'win32'
  ? { SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', PATH: 'C:\\Windows\\System32', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: 'NUL', GIT_TERMINAL_PROMPT: '0' }
  : { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };

function capture(args, root, input) {
  const result = spawnSync(git, args, { cwd: root, env: environment, input,
    shell: false, windowsHide: true, timeout: 10_000, maxBuffer: MAX_BYTES });
  if (result.error || result.status !== 0) fail('FRONTEND_LOCAL_SOURCE_UNPROVEN');
  return result.stdout;
}

export function collectFrontendVisibilitySnapshotV1({ root = repoRoot, expectedHead, expectedDistFingerprint } = {}) {
  if (!HEX.test(expectedHead ?? '') || !DIGEST.test(expectedDistFingerprint ?? '')) fail('FRONTEND_EXACT_IDENTITY_REQUIRED');
  const head = capture(['rev-parse', 'HEAD'], root).toString().trim();
  if (head !== expectedHead) fail('FRONTEND_INSTALLED_HEAD_CHANGED');
  if (capture(['branch', '--show-current'], root).toString().trim() !== 'main') fail('FRONTEND_CANONICAL_MAIN_REQUIRED');
  // Source identity is local and offline. No fetch, source update, build or lease
  // write occurs. Dist is separately bound to the approved existing fingerprint.
  capture(['diff', '--quiet', '--no-ext-diff', 'HEAD', '--', 'scripts', 'shared', 'package.json', 'stephanos-ui/package.json'], root);
  const manifest = createStephanosDistManifest({ rootDir: root });
  if (manifest.fingerprint !== expectedDistFingerprint) fail('FRONTEND_ASSET_FINGERPRINT_CHANGED');
  const files = new Map();
  let total = 0;
  const put = (path, bytes) => {
    total += bytes.length;
    if (bytes.length > 32 * 1024 * 1024 || total > MAX_BYTES || files.size >= 4096) fail('FRONTEND_SNAPSHOT_LIMIT');
    files.set(path, Buffer.from(bytes));
  };
  // Launcher files come from exact local Git objects, never unrestricted disk.
  const names = capture(['ls-tree', '-rz', '--name-only', 'HEAD', '--',
    'index.html', 'main.js', 'style.css', 'stephanos-icon.png', 'system', 'modules', 'shared', 'assets', 'apps'], root)
    .toString().split('\0').filter(path => !path.startsWith('apps/stephanos/dist/')
      && (/^[A-Za-z0-9_./-]+\.(?:html|js|mjs|css|svg|png|ico|webp|woff2?|ttf)$/.test(path)
        || /^apps\/(?:index\.json|[A-Za-z0-9_-]+\/app\.json)$/.test(path)));
  if (!names.includes('index.html') || !names.includes('main.js') || names.length > 4096) fail('FRONTEND_LAUNCHER_UNPROVEN');
  const objects = capture(['cat-file', '--batch'], root, names.map(path => `HEAD:${path}\n`).join(''));
  let offset = 0;
  for (const path of names) {
    const end = objects.indexOf(10, offset);
    const match = objects.subarray(offset, end).toString().match(/^[a-f0-9]{40} blob ([0-9]+)$/);
    if (end < offset || !match) fail('FRONTEND_SOURCE_OBJECT_INVALID');
    const size = Number(match[1]);
    offset = end + 1;
    if (!Number.isSafeInteger(size) || size < 0 || offset + size >= objects.length || objects[offset + size] !== 10) fail('FRONTEND_SOURCE_OBJECT_INVALID');
    put(path, objects.subarray(offset, offset + size));
    offset += size + 1;
  }
  if (offset !== objects.length) fail('FRONTEND_SOURCE_OBJECT_INVALID');
  for (const entry of manifest.entries) {
    const path = resolve(root, 'apps/stephanos/dist', entry.path);
    const bytes = readFileSync(path);
    if (bytes.length !== entry.size || hash(bytes) !== entry.sha256) fail('FRONTEND_ASSET_CHANGED_DURING_CAPTURE');
    put(`apps/stephanos/dist/${entry.path}`, bytes);
  }
  const metadata = JSON.parse(files.get('apps/stephanos/dist/stephanos-build.json'));
  if (!HEX.test(metadata.gitCommit ?? '') || !DIGEST.test(metadata.sourceFingerprint ?? '')) fail('FRONTEND_ASSET_METADATA_UNPROVEN');
  capture(['cat-file', '-e', `${metadata.gitCommit}^{commit}`], root);
  capture(['merge-base', '--is-ancestor', metadata.gitCommit, head], root);
  // The immutable bytes preserve shell/runtime entry separation. Add an honest
  // visible restriction notice without rewriting generated output on disk.
  const notice = '<aside role="status" style="position:relative;z-index:2147483647;background:#482d00;color:white;padding:12px">Frontend visibility mode: controls and external connections are disabled. Existing build ' + metadata.gitCommit.slice(0, 12) + '; installed source ' + head.slice(0, 12) + '. Repair custody remains held; backend and builder health are not certified.</aside>';
  for (const path of ['index.html', 'apps/stephanos/dist/index.html']) {
    const html = files.get(path)?.toString('utf8');
    if (!html || !/<body\b[^>]*>/i.test(html)) fail('FRONTEND_ENTRY_INVALID');
    files.set(path, Buffer.from(html.replace(/<body\b[^>]*>/i, match => match + notice)));
  }
  // Existing mount directory URLs use the same immutable index bytes.
  const servedFingerprint = computeStephanosDistManifestFingerprint([...files]
    .map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes) })).sort((a, b) => a.path < b.path ? -1 : 1));
  files.set('apps/stephanos/dist/', files.get('apps/stephanos/dist/index.html'));
  if (capture(['rev-parse', 'HEAD'], root).toString().trim() !== head) fail('FRONTEND_INSTALLED_HEAD_CHANGED');
  return { files, receipt: Object.freeze({ schemaVersion: SCHEMA, service: 'stephanos-dist-server',
    ok: true, frontendAvailable: false, mode: 'visibility-only', installedHead: head,
    existingBuildHead: metadata.gitCommit, sourceCurrent: metadata.gitCommit === head,
    runtimeMarker: metadata.runtimeMarker || null, gitCommit: metadata.gitCommit,
    buildTimestamp: metadata.buildTimestamp || null, intendedMode: 'launcher-root',
    runtimeUrl: 'http://127.0.0.1:4173/apps/stephanos/dist/',
    launcherCriticalSourceTruth: ['main.js', 'modules/command-deck/command-deck.js', 'system/module_loader.js', 'system/workspace.js']
      .map(path => ({ path, exists: files.has(path), sha256: files.has(path) ? hash(files.get(path)) : null })),
    approvedDistFingerprint: manifest.fingerprint, servedFingerprint,
    controlsEnabled: false, externalConnectionsEnabled: false, custodyReleased: false,
    backendHealth: 'UNVERIFIED', gatewayHealth: 'UNVERIFIED', builderHealth: 'UNVERIFIED' }) };
}

export async function bindFrontendVisibilitySnapshotV1(snapshot, { port = 4173, host = '127.0.0.1' } = {}) {
  const server = createStephanosDistServer({ visibilitySnapshot: {
    files: snapshot.files, receipt: { ...snapshot.receipt, frontendAvailable: true },
  } });
  await new Promise((yes, no) => { server.once('error', no); server.listen({ port, host, exclusive: true }, yes); });
  return server;
}

export function isExactFrontendListenerV1(witness, { expectedHead, expectedDistFingerprint, script = fileURLToPath(import.meta.url) }) {
  if (witness?.schemaVersion !== 'stephanos.frontend-listener.v1' || witness.owners?.length !== 1) return false;
  const owner = witness.owners[0];
  // Node's Windows argv quoting is deterministic for these fixed ASCII flags
  // and one spaced path. Accept only that exact serve invocation, never another
  // node process, arbitrary listener, or an HTTP self-description alone.
  const quote = value => /\s/.test(value) ? `"${value}"` : value;
  const expected = [node, script, 'serve', '--expected-head', expectedHead,
    '--expected-dist-fingerprint', expectedDistFingerprint, '--operator-approved'].map(quote).join(' ');
  return Number.isSafeInteger(owner.pid) && owner.pid > 0
    && owner.executablePath?.toLowerCase() === node.toLowerCase() && owner.commandLine === expected;
}

function listenerWitness() {
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./windows/read-stephanos-frontend-listener.ps1', import.meta.url))],
    { env: environment, shell: false, windowsHide: true, timeout: 10_000, encoding: 'utf8', maxBuffer: 8192 });
  if (result.error || result.status !== 0) fail('FRONTEND_LISTENER_OWNER_UNPROVEN');
  try { return JSON.parse(result.stdout); } catch { fail('FRONTEND_LISTENER_OWNER_UNPROVEN'); }
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.shift();
  const allowed = new Set(['--expected-head', '--expected-dist-fingerprint', '--operator-approved']);
  const flags = {};
  while (args.length) {
    const flag = args.shift();
    if (!allowed.has(flag) || Object.hasOwn(flags, flag)) fail('FRONTEND_ARGUMENTS_INVALID');
    flags[flag] = flag === '--operator-approved' ? true : args.shift();
  }
  if (!['status', 'start', 'serve'].includes(mode)) fail('FRONTEND_ARGUMENTS_INVALID');
  if (process.platform !== 'win32' || resolve(repoRoot).toLowerCase() !== 'c:\\users\\stephan callear\\documents\\github\\stephan-os') fail('FRONTEND_FIXED_INSTALLATION_REQUIRED');
  if (realpathSync(process.execPath).toLowerCase() !== realpathSync(node).toLowerCase()) fail('FRONTEND_FIXED_EXECUTABLE_REQUIRED');
  const expectedHead = flags['--expected-head'], expectedDistFingerprint = flags['--expected-dist-fingerprint'];
  const snapshot = collectFrontendVisibilitySnapshotV1({ expectedHead, expectedDistFingerprint });
  if (mode === 'status') return { ...snapshot.receipt, frontendAvailable: false, action: 'validated-not-started' };
  if (flags['--operator-approved'] !== true) fail('FRONTEND_OPERATOR_APPROVAL_REQUIRED');
  const witness = listenerWitness();
  if (witness?.schemaVersion !== 'stephanos.frontend-listener.v1' || !Array.isArray(witness.owners)) fail('FRONTEND_LISTENER_OWNER_UNPROVEN');
  if (witness.owners.length && !isExactFrontendListenerV1(witness, { expectedHead, expectedDistFingerprint })) fail('FRONTEND_FOREIGN_OR_DIFFERENT_LISTENER');
  // Only reuse our exact visibility receipt. No restart request or foreign kill.
  if (witness.owners.length) {
    try {
    const response = await fetch('http://127.0.0.1:4173/__stephanos/health', { signal: AbortSignal.timeout(1000) });
    const existing = await response.json();
    const after = listenerWitness();
    if (response.ok && isExactFrontendListenerV1(after, { expectedHead, expectedDistFingerprint })
      && after.owners[0].pid === witness.owners[0].pid && existing.frontendAvailable === true
      && existing.schemaVersion === SCHEMA && existing.mode === 'visibility-only'
      && existing.installedHead === expectedHead && existing.servedFingerprint === snapshot.receipt.servedFingerprint)
      return { ...existing, action: 'already-running' };
    fail('FRONTEND_FOREIGN_OR_DIFFERENT_LISTENER');
    } catch { fail('FRONTEND_EXISTING_LISTENER_PROOF_FAILED'); }
  }
  if (mode === 'serve') {
    const server = await bindFrontendVisibilitySnapshotV1(snapshot);
    const bound = listenerWitness();
    if (!isExactFrontendListenerV1(bound, { expectedHead, expectedDistFingerprint }) || bound.owners[0].pid !== process.pid) {
      await new Promise(done => server.close(done));
      fail('FRONTEND_EXCLUSIVE_LISTENER_UNPROVEN');
    }
    const receipt = { ...snapshot.receipt, frontendAvailable: true, action: 'started' };
    process.send?.(receipt); process.disconnect?.();
    return receipt;
  }
  const child = spawn(node, [fileURLToPath(import.meta.url), 'serve', '--expected-head', expectedHead,
    '--expected-dist-fingerprint', expectedDistFingerprint, '--operator-approved'],
  { cwd: repoRoot, env: environment, detached: true, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  return await new Promise(resolveResult => {
    let done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); if (child.connected) child.disconnect(); child.unref(); resolveResult(value); };
    const timer = setTimeout(() => finish({ ok: false, blocker: 'FRONTEND_STARTUP_UNPROVEN', custodyReleased: false }), 15_000);
    child.once('message', finish);
    child.once('error', () => finish({ ok: false, blocker: 'FRONTEND_START_FAILED', custodyReleased: false }));
    child.once('exit', () => finish({ ok: false, blocker: 'FRONTEND_START_FAILED', custodyReleased: false }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = await main(); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 2; }
  catch (error) { const result = { schemaVersion: SCHEMA, ok: false, blocker: error.message, custodyReleased: false };
    process.send?.(result); process.disconnect?.(); console.log(JSON.stringify(result)); process.exitCode = 2; }
}
