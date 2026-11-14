// Parse-only closure proof: repository modules are never linked or evaluated.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const maintenance = process.argv.includes('--maintenance-v3');
const fixtureRoot = process.argv.find(value => value.startsWith('--fixture-root='))?.slice(15);
const root = fixtureRoot ? pathToFileURL(path.resolve(fixtureRoot) + path.sep) : new URL('../../', import.meta.url);
const omitted = process.argv.find(value => value.startsWith('--omit='))?.slice(7);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let paths;
// The fixed profile must not read maintenance-only fixture declarations.
if (maintenance) {
  const source = fs.readFileSync(new URL('scripts/sovereign-maintenance-installer-source-admission-v3.mjs', root), 'utf8');
  const declaration = source.match(/^export const MAINTENANCE_SOURCE_CLOSURE_V3 = Object\.freeze\((\[[\s\S]*?\])\);/m);
  if (!declaration) throw Error('MAINTENANCE_CLOSURE_DECLARATION_UNPROVEN');
  paths = JSON.parse(declaration[1]);
} else {
  const closure = JSON.parse(fs.readFileSync(new URL('shared/agents/sovereignFixedRuntimeSourceClosureV1.json', root)));
  if (closure.schemaVersion !== 'stephanos.fixed-runtime-source-closure.v1' || Object.keys(closure).sort().join(',') !== 'paths,schemaVersion')
    throw Error('FIXED_CLOSURE_DECLARATION_UNPROVEN');
  paths = closure.paths;
}
if (!Array.isArray(paths) || !paths.length || paths.length > 512 || new Set(paths).size !== paths.length
  || paths.some(file => typeof file !== 'string' || file.includes('\\') || file.startsWith('/') || file.includes(':')
    || file.split('/').some(part => !part || part === '.' || part === '..')))
  throw Error('CLOSURE_MEMBER_DECLARATION_UNPROVEN');
const members = new Set(paths.filter(file => file !== omitted));
const missing = [], bare = [], edges = new Map(), seen = new Set();
const fixedRoots = ['scripts/sovereign-commander-mcp.mjs', 'scripts/sovereign-commander-http.mjs',
  'scripts/sovereign-fixed-runtime-source-task-v1.mjs', 'scripts/mission-orchestrator-worker-supervised.mjs',
  'scripts/mission-orchestrator-worker.mjs', 'scripts/completion-guardian.mjs',
  'scripts/sovereign-commander-goal-builder-repair.mjs', 'scripts/sovereign-commander-fleet-goal-supervisor.mjs',
  'scripts/sovereign-commander-spatial-workspace.mjs',
  'scripts/sovereign-controller-lane-status.mjs', 'scripts/battle-bridge-goal-discovery-heartbeat.mjs'];
const requiredRoots = maintenance ? ['scripts/sovereign-maintenance-custody-store-v1.mjs',
  'scripts/sovereign-maintenance-journal-source-proof-v2.mjs'] : fixedRoots;
const capturedReadAdapters = {
  'shared/agents/sovereignDirectoryCreateV1.mjs': 'b3a9f5f60d7d0990b31fa9f491c349832f9fad2cba802484e2b1c2c67106e43a',
  'shared/agents/sovereignSearchSessionsV1.mjs': '028dfe0243714cd047671e27365e18e59a16791edc92895a76a4332b77d5de34',
  'shared/agents/sovereignFileCopyV1.mjs': 'f0903634deda4888e65b5a806f53292578c42930481ec77f0e3ebf34685619ff',
  'shared/agents/sovereignFileMoveV1.mjs': 'edb13d36cbe7c74d27834069d803601f13493919f0d6409fbb2ba1c82fc6a910',
  'shared/agents/sovereignPdfWriteV1.mjs': '90c5e0ecb3d1fdc354af1dbedcd04c24a2910e3fedb3277aa838168214164330',
};
const capturedProcessAdapterSha256 = 'c0e7d5e221ec5dc3c5579c6dd88a45cde393bc2484984ea4bfdd0c11e1e3549f';
for (const target of requiredRoots) if (!members.has(target)) missing.push({ role: 'profile-root', target });
// Checking all admitted JS members also covers a newly reachable import in a
// packaged library outside the previous selected-root traversal. This cannot
// expand package membership: missing edges remain failures, never copied files.
const queue = [...new Set([...requiredRoots, ...paths.filter(file => /\.(mjs|js)$/.test(file))])].sort();
function edge(file, spec, role) {
  if (spec.startsWith('node:')) return;
  if (!spec.startsWith('.')) { bare.push({ file, spec, role }); return; }
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  if (spec.includes('\\') || spec.includes('?') || spec.includes('#') || spec.includes('%')
    || target.startsWith('../') || path.posix.isAbsolute(target)) {
    missing.push({ file, spec, target, role, outsideRepository: true }); return;
  }
  const item = { file, target, role };
  edges.set(JSON.stringify(item), item);
  if (!members.has(target) || !fs.existsSync(new URL(target, root))) missing.push(item);
  if (role === 'import') {
    if (!/\.(mjs|js)$/.test(target)) missing.push({ ...item, unsupportedModule: true });
    else queue.push(target);
  }
}
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!members.has(file) || !fs.existsSync(new URL(file, root))) {
    missing.push({ role: 'module', target: file }); continue;
  }
  const bytes = fs.readFileSync(new URL(file, root));
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const module = new vm.SourceTextModule(source);
  for (const spec of module.dependencySpecifiers) edge(file, spec, 'import');
  // Conservative source scan: unsupported computed dynamic imports are held.
  // It may over-report text examples; it never executes them to infer a target.
  // The import-structure guard's own reviewed regex is not an import call.
  const scan = file === 'scripts/guard-import-structure.mjs'
    ? source.replace("const IMPORT_START_PATTERN = /^\\s*import(?:\\s+|\\{|'|\")/;", '') : source;
  const call = /\bimport(?:(?:\s+)|(?:\/\*[\s\S]*?\*\/)|(?:\/\/[^\r\n]*[\r\n]))*\(/g;
  for (const match of scan.matchAll(call)) {
    const tail = scan.slice(match.index + match[0].length);
    const literal = tail.match(/^\s*(['"])([^'"\\\r\n]+)\1\s*\)/);
    if (!literal) missing.push({ file, role: 'import', unknownDynamicImport: true });
    else edge(file, literal[2], 'import');
  }
  if (Object.hasOwn(capturedReadAdapters, file)) {
    // The finite read-edge interpretation applies to this exact reviewed adapter,
    // not to arbitrary matching declarations hidden in comments or unused code.
    // A changed adapter must have its dependency model independently reviewed.
    const normalized = source.replace(/\r\n/g, '\n');
    if (digest(normalized) !== capturedReadAdapters[file])
      missing.push({ file, runtimeReadSourceUnproven: true });
    for (const binding of ['SCRIPT', 'NATIVE']) {
      const declaration = source.match(new RegExp('^const ' + binding + ' = fileURLToPath\\(new URL\\(([\x22\x27])([^\x22\x27\\r\\n]+)\\1, import\\.meta\\.url\\)\\);', 'm'));
      const pin = source.match(new RegExp('^const ' + binding + '_SHA256 = ([\x22\x27])([a-f0-9]{64})\\1;', 'm'));
      if (!declaration || !pin) { missing.push({ file, runtimeReadBinding: binding }); continue; }
      edge(file, declaration[2], 'runtime-read');
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), declaration[2]));
      if (members.has(target) && fs.existsSync(new URL(target, root))
        && digest(fs.readFileSync(new URL(target, root))) !== pin[2])
        missing.push({ file, target, runtimeReadPinMismatch: true });
    }
  }
  if (file === 'shared/agents/sovereignProcessSessionsV1.mjs') {
    // Exact reviewed two-profile dependency model. The hash binds this finite
    // interpretation to the adapter; it does not authorize computed discovery.
    if (digest(source.replace(/\r\n/g, '\n')) !== capturedProcessAdapterSha256)
      missing.push({ file, runtimeReadSourceUnproven: true });
    for (const [spec, pin] of [
      ['../../scripts/windows/status-battle-bridge-recovery-mesh.ps1', 'd48756676ed2fe75214c298d26c3010d08c219c2ed12ab6475998d5272645e03'],
      ['../../scripts/windows/status-battle-bridge-worker-watchdog.ps1', '948d3b7ae81589301741d2975d2f5b0878f9592e085d29e768873231d7cb0230'],
    ]) {
      edge(file, spec, 'runtime-read');
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (members.has(target) && fs.existsSync(new URL(target, root))
        && digest(fs.readFileSync(new URL(target, root))) !== pin)
        missing.push({ file, target, runtimeReadPinMismatch: true });
    }
  }
  if (file === 'scripts/windows/battle-bridge-mobile-install-native-v1.mjs') {
    // Reviewed finite observation and protected-client adapter. The probe is
    // captured source below. The separately enrolled fixed native helper has
    // its own retained ACL/certificate/release gate, not a caller source path.
    // Re-review this complete interpretation after any adapter source change.
    if (digest(source.replace(/\r\n/g, '\n')) !== 'd0599051b1f77877983182d3dece1308b60a2789b58febaa600e919f1d0a9863')
      missing.push({ file, runtimeReadSourceUnproven: true });
    const declaration = source.match(/^const PROBE = fileURLToPath\(new URL\((['"])([^'"\r\n]+)\1, import\.meta\.url\)\);/m);
    if (!declaration) missing.push({ file, runtimeReadBinding: 'PROBE' });
    else {
      edge(file, declaration[2], 'runtime-exec');
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), declaration[2]));
      if (members.has(target) && fs.existsSync(new URL(target, root)) &&
        digest(fs.readFileSync(new URL(target, root), 'utf8').replace(/\r\n/g, '\n')) !==
          '337ccbc676dbc44aa96f3344c15c499536b1fa2070a196b2385329c53d967913')
        missing.push({ file, target, runtimeReadPinMismatch: true });
    }
  }
}
// Existing custody inputs are retained. They do not grant additional filesystem
// discovery or make this guard an installation/activation authority.
for (const target of maintenance ? [] : ['scripts/windows/read-sovereign-maintenance-boot-witness.ps1',
  'scripts/windows/read-sovereign-maintenance-owner-v2.ps1', 'scripts/windows/sovereign-maintenance-audit-anchor.ps1',
  'scripts/windows/sovereign-maintenance-journal-policy-v2.ps1', 'scripts/windows/install-sovereign-fixed-runtime-v1.ps1'])
  if (!members.has(target) || !fs.existsSync(new URL(target, root))) missing.push({ runtimeRead: target });
// The preparation profile uses these fixed existing build/probe inputs. The
// persistent launcher is deliberately outside this finite execution closure.
for (const target of maintenance ? [] : ['shared/agents/sovereignSpatialWorkspaceV1.mjs',
  'scripts/windows/prepare-spatial-workspace.ps1', 'scripts/windows/install-spatial-window.ps1',
  'scripts/windows/build-spatial-window.ps1', 'scripts/windows/start-spatial-window-host.ps1',
  'scripts/windows/spatial-window-install-lock.ps1',
  'src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp', 'scripts/spatial-window-host.mjs',
  'shared/vr/spatialDesktopSurfaceContractV1.mjs'])
  if (!members.has(target) || !fs.existsSync(new URL(target, root))) missing.push({ spatialPreparationInput: target });
// Fixed PowerShell execution/dot-source edges for the fresh PassThruPinned
// build path. The persistent launcher is only a shortcut target, never invoked.
if (!maintenance) for (const [file, spec] of [
  ['scripts/windows/prepare-spatial-workspace.ps1', './install-spatial-window.ps1'],
  ['scripts/windows/prepare-spatial-workspace.ps1', './spatial-window-install-lock.ps1'],
  ['scripts/windows/prepare-spatial-workspace.ps1', './install-stephanos-spatial-workspace-shortcut.ps1'],
  ['scripts/windows/install-spatial-window.ps1', './build-spatial-window.ps1'],
  ['scripts/windows/install-spatial-window.ps1', './spatial-window-install-lock.ps1'],
  ['scripts/windows/build-spatial-window.ps1', './spatial-window-install-lock.ps1'],
  ['scripts/windows/install-stephanos-spatial-workspace-shortcut.ps1', './spatial-window-install-lock.ps1'],
  ['scripts/windows/start-spatial-window-host.ps1', './spatial-window-install-lock.ps1'],
]) edge(file, spec, 'runtime-exec');
const coverage = [];
if (!maintenance) {
  // Exact reviewed applicability evidence for the legacy HTTP exec edge. This
  // exception is limited to the production Windows fixed profile. Changed gates
  // must be reassessed; an optional-looking pathname is never a generic bypass.
  const applicabilityPins = {
  "scripts/sovereign-commander-http.mjs": "0af461df59d540ce86d0db86a9dbc0295790eec4dc17c152bf29cad80a54d27a",
  "scripts/sovereign-fixed-runtime-parent-v1.mjs": "e999aa177ace3f77b5ace753d340e87df5b3c748176d2cceb8efde48ab1ad87a",
  "shared/agents/sovereignMaintenanceAdmissionV1.mjs": "e16f81e0bdd86a5878e380901f5302c65ac9c19028fd675cef2c6b1e506de228",
  "scripts/windows/SovereignFixedRuntimeHostV1.cs": "24f03a18fc7b81e807fc9c2ef0bfbafa205c2de871d55aad15c127b1b433812c"
};
  let scopeProven = true;
  for (const [file, pin] of Object.entries(applicabilityPins)) {
    if (!members.has(file) || !fs.existsSync(new URL(file, root))
      || digest(fs.readFileSync(new URL(file, root), 'utf8').replace(/\r\n/g, '\n')) !== pin) {
      scopeProven = false; missing.push({ file, fixedProfileApplicabilityUnproven: true });
    }
  }
  coverage.push({ file: 'scripts/sovereign-commander-http.mjs',
    target: 'scripts/sovereign-commander-stephanos-repair.mjs', role: 'conditional-exec',
    profile: 'production-windows-fixed-runtime',
    state: scopeProven ? 'EXCLUDED_BY_REVIEWED_PROFILE_GATES' : 'SCOPE_UNPROVEN',
    nonWindowsOrInjectedFallbackQualified: false, targetPackaged: members.has('scripts/sovereign-commander-stephanos-repair.mjs') });
}
const canonical = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()]
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
console.log(JSON.stringify({ memberCount: members.size, parsed: seen.size, parsedPaths: [...seen].sort(),
  profile: maintenance ? 'maintenance-v3' : 'fixed-runtime-v1',
  coverage, edges: canonical([...edges.values()]), missing: canonical(missing), bare: canonical(bare),
  repositoryModulesEvaluated: false }));
