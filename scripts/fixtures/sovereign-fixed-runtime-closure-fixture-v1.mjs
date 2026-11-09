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
  'scripts/sovereign-controller-lane-status.mjs', 'scripts/battle-bridge-goal-discovery-heartbeat.mjs'];
const requiredRoots = maintenance ? ['scripts/sovereign-maintenance-custody-store-v1.mjs',
  'scripts/sovereign-maintenance-journal-source-proof-v2.mjs'] : fixedRoots;
const capturedReadAdapters = {
  'shared/agents/sovereignDirectoryCreateV1.mjs': 'b3a9f5f60d7d0990b31fa9f491c349832f9fad2cba802484e2b1c2c67106e43a',
  'shared/agents/sovereignSearchSessionsV1.mjs': '3c96169032127a0b7bee86a949422efc1030a12474d2845a2e97a6236b822a47',
  'shared/agents/sovereignFileCopyV1.mjs': 'f0903634deda4888e65b5a806f53292578c42930481ec77f0e3ebf34685619ff',
  'shared/agents/sovereignFileMoveV1.mjs': '79ea603d77c6aa0d53366a966aef849ecc20e80019f2162e28886b6a28747190',
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
}
// Existing custody inputs are retained. They do not grant additional filesystem
// discovery or make this guard an installation/activation authority.
for (const target of maintenance ? [] : ['scripts/windows/read-sovereign-maintenance-boot-witness.ps1',
  'scripts/windows/read-sovereign-maintenance-owner-v2.ps1', 'scripts/windows/sovereign-maintenance-audit-anchor.ps1',
  'scripts/windows/sovereign-maintenance-journal-policy-v2.ps1', 'scripts/windows/install-sovereign-fixed-runtime-v1.ps1'])
  if (!members.has(target) || !fs.existsSync(new URL(target, root))) missing.push({ runtimeRead: target });
const coverage = [];
if (!maintenance) {
  // Exact reviewed applicability evidence for the legacy HTTP exec edge. This
  // exception is limited to the production Windows fixed profile. Changed gates
  // must be reassessed; an optional-looking pathname is never a generic bypass.
  const applicabilityPins = {
  "scripts/sovereign-commander-http.mjs": "962b48eebd6dcc54e6117329acfbc5a4820bb7091c1f97493fd864cf984962c5",
  "scripts/sovereign-fixed-runtime-parent-v1.mjs": "436a9e9d23d85f942d6264ffe15ff4aea4f8724cacdf094ce127fc561e785dab",
  "shared/agents/sovereignMaintenanceAdmissionV1.mjs": "d468e7bf73355e5daa6899d19ffe8e7b034af914837b5e66523d43ade79a8703",
  "scripts/windows/SovereignFixedRuntimeHostV1.cs": "d13700a76f873e38fdac7ba25661df873f7b4c2c70bfc705f73b9887ab40a04f"
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
