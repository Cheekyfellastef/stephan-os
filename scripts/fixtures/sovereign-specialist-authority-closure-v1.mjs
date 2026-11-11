// Parse-only proof of the source authority estate. Follows the existing fixed
// runtime closure fixture pattern; never links or evaluates reviewed modules.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isBuiltin } from 'node:module';
import { fileURLToPath } from 'node:url';

const DECLARATION = 'shared/agents/sovereignSpecialistAuthorityClosureV1.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = value => typeof value === 'string' && !/[\\:%?#]/.test(value) && !value.startsWith('/')
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const list = values => Array.isArray(values) && values.every(safe) && values.length <= 256
  && new Set(values).size === values.length && JSON.stringify(values) === JSON.stringify([...values].sort());

export function inspectSovereignSpecialistAuthorityClosureV1(root) {
  const source = file => fs.readFileSync(path.join(root, file), 'utf8');
  const manifest = JSON.parse(source(DECLARATION));
  if (manifest.schemaVersion !== 'stephanos.sovereign-specialist-authority-closure.v1'
    || Object.keys(manifest).sort().join(',') !== 'fixedDependencies,modules,protectedFiles,roots,schemaVersion'
    || !list(manifest.roots) || !list(manifest.modules) || !list(manifest.protectedFiles)
    || !manifest.protectedFiles.includes(DECLARATION) || !Array.isArray(manifest.fixedDependencies))
    throw Error('SOVEREIGN_SPECIALIST_AUTHORITY_CLOSURE_DECLARATION_INVALID');
  const members = new Set(manifest.modules), protectedFiles = new Set([...members, ...manifest.protectedFiles]);
  const models = new Map();
  for (const model of manifest.fixedDependencies) {
    if (!model || Object.keys(model).sort().join(',') !== 'kind,path,sourceSha256,targets'
      || !members.has(model.path) || models.has(model.path) || !/^[a-f0-9]{64}$/.test(model.sourceSha256)
      || !['fixed-script-handoff', 'pinned-local-switchboard', 'inert-source-examples'].includes(model.kind)
      || !list(model.targets) || (model.kind !== 'inert-source-examples' && model.targets.length === 0))
      throw Error('SOVEREIGN_SPECIALIST_AUTHORITY_FIXED_EDGE_INVALID');
    models.set(model.path, model);
  }
  const errors = [], edges = [], seen = new Set(), queue = [...manifest.roots];
  for (const file of protectedFiles) if (!fs.existsSync(path.join(root, file))) errors.push('FILE_MISSING:' + file);
  if (new Set([...protectedFiles].map(file => file.toLowerCase())).size !== protectedFiles.size)
    errors.push('WINDOWS_PATH_ALIAS_COLLISION');
  function edge(file, spec, role) {
    if (isBuiltin(spec)) return;
    const target = role === 'fixed' ? spec : path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    if ((role !== 'fixed' && !spec.startsWith('.')) || !safe(target)
      || /[\\%?#:]/.test(spec) || !members.has(target)) { errors.push('DEPENDENCY_NOT_CLOSED:' + file + ':' + spec); return; }
    edges.push({ file, target, role }); queue.push(target);
  }
  while (queue.length) {
    const file = queue.shift(); if (seen.has(file)) continue; seen.add(file);
    if (!members.has(file) || !fs.existsSync(path.join(root, file))) { errors.push('MODULE_MISSING:' + file); continue; }
    if (file === DECLARATION) continue;
    if (!/\.(mjs|js)$/.test(file)) { errors.push('MODULE_TYPE_UNSUPPORTED:' + file); continue; }
    const content = source(file), module = new vm.SourceTextModule(content);
    for (const spec of module.dependencySpecifiers) edge(file, spec, 'static');
    const model = models.get(file);
    if (model) {
      // The bounded interpretation applies ONLY to the exact existing source,
      // whose fixed launcher/pinned switchboard was independently inspected.
      // Changed or newly computed dependencies never inherit an old exception.
      if (hash(content) !== model.sourceSha256) errors.push('FIXED_EDGE_SOURCE_CHANGED:' + file);
      for (const target of model.targets) edge(file, target, 'fixed');
    } else {
      // Conservative scan includes examples/comments; unsupported expressions
      // fail closed. Known inert examples are covered by exact source pins.
      const calls = /\b(?:import|require)(?:(?:\s+)|(?:\/\*[\s\S]*?\*\/)|(?:\/\/[^\r\n]*[\r\n]))*\(/g;
      for (const match of content.matchAll(calls)) {
        const literal = content.slice(match.index + match[0].length).match(/^\s*(['"])([^'"\\\r\n]+)\1\s*\)/);
        if (!literal) errors.push('DYNAMIC_DEPENDENCY_UNRESOLVED:' + file);
        else edge(file, literal[2], 'dynamic-literal');
      }
    }
  }
  for (const file of members) if (!seen.has(file)) errors.push('UNREACHABLE_DECLARED_MODULE:' + file);
  const workflow = source('.github/workflows/independent-merge-security-review.yml');
  for (const match of workflow.matchAll(/\bnode\s+(scripts\/[a-zA-Z0-9._/-]+\.mjs)\b/g))
    if (!manifest.roots.includes(match[1])) errors.push('WORKFLOW_ROOT_MISSING:' + match[1]);
  return { valid: errors.length === 0, errors, modules: [...seen].sort(), protectedPaths: [...protectedFiles].sort(),
    edges, repositoryModulesEvaluated: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || fileURLToPath(new URL('../../', import.meta.url));
  const result = inspectSovereignSpecialistAuthorityClosureV1(root);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.valid) process.exitCode = 1;
}
