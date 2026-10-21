// Installed-parent code, serialized into argv: never import this helper from the
// candidate checkout at launch. The OS/Node/Git and installed parent are the
// trust root; the checkout, index, refs and object store are untrusted inputs.
export function sovereignExactCommitLoaderV1({ root, head, files, git }) {
  if (!/^[a-f0-9]{40}$/.test(head) || !Array.isArray(files) || !files.length
    || files.length > 32 || new Set(files).size !== files.length
    || files.some(p => !/^(scripts|shared\/agents)\/[a-zA-Z0-9-]+\.mjs$/.test(p))) {
    throw Error('EXACT_COMMIT_LOADER_IDENTITY_INVALID');
  }
  const config = JSON.stringify({ root, head, files, git });
  const source = `
const { spawnSync } = await import('node:child_process');
const { createHash } = await import('node:crypto');
const { resolve: resolvePath } = await import('node:path');
const { pathToFileURL } = await import('node:url');
const { isBuiltin } = await import('node:module');
const cfg = ${config};
const objects = new Map();
function object(type, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('EXACT_COMMIT_OBJECT_ID_INVALID');
  const key = type + ':' + sha;
  if (objects.has(key)) return objects.get(key);
  const r = spawnSync(cfg.git.executable, [...cfg.git.fixedConfigArgs,
    '-C', cfg.root, 'cat-file', type, sha], {
    shell: false, windowsHide: true, timeout: 12000, maxBuffer: 2097152,
    env: cfg.git.environment,
  });
  if (r.error || r.status !== 0 || !Buffer.isBuffer(r.stdout))
    throw Error('EXACT_COMMIT_OBJECT_UNAVAILABLE');
  const bytes = r.stdout;
  const actual = createHash('sha1').update(type + ' ' + bytes.length + '\\0')
    .update(bytes).digest('hex');
  if (actual !== sha) throw Error('EXACT_COMMIT_OBJECT_HASH_MISMATCH');
  objects.set(key, bytes);
  return bytes;
}
const commit = object('commit', cfg.head).toString('utf8');
const tree = /^tree ([a-f0-9]{40})\\n/.exec(commit)?.[1];
if (!tree) throw Error('EXACT_COMMIT_TREE_INVALID');
function blob(file) {
  let sha = tree;
  const parts = file.split('/');
  for (let depth = 0; depth < parts.length; depth++) {
    const bytes = object('tree', sha);
    let found = null;
    for (let i = 0; i < bytes.length;) {
      const space = bytes.indexOf(32, i), nul = bytes.indexOf(0, space + 1);
      if (space < i || nul < space || nul + 21 > bytes.length)
        throw Error('EXACT_COMMIT_TREE_INVALID');
      const mode = bytes.toString('ascii', i, space);
      const name = bytes.toString('utf8', space + 1, nul);
      if (name === parts[depth]) {
        if (found) throw Error('EXACT_COMMIT_TREE_AMBIGUOUS');
        found = { mode, sha: bytes.subarray(nul + 1, nul + 21).toString('hex') };
      }
      i = nul + 21;
    }
    const last = depth === parts.length - 1;
    if (!found || !(last ? ['100644', '100755'].includes(found.mode) : found.mode === '40000'))
      throw Error('EXACT_COMMIT_MODULE_UNAVAILABLE');
    sha = found.sha;
  }
  return object('blob', sha).toString('utf8');
}
// Authenticate the ENTIRE closed graph before any candidate module evaluates.
// Sources live only in loader memory; no temporary executable files or mutable
// worktree reads, even if refs/index/objects change and are restored mid-load.
const modules = new Map(cfg.files.map(file => [
  pathToFileURL(resolvePath(cfg.root, file)).href, blob(file),
]));
export function resolve(specifier, context) {
  if (isBuiltin(specifier)) return { url: specifier.startsWith('node:') ? specifier : 'node:' + specifier, shortCircuit: true };
  let url;
  try {
    url = specifier.startsWith('file:') ? new URL(specifier).href
      : specifier.startsWith('.') ? new URL(specifier, context.parentURL).href
      : pathToFileURL(resolvePath(specifier)).href;
  } catch { throw Error('EXACT_COMMIT_IMPORT_DENIED'); }
  if (!modules.has(url)) throw Error('EXACT_COMMIT_IMPORT_DENIED');
  return { url, shortCircuit: true };
}
export function load(url, context, nextLoad) {
  if (url.startsWith('node:')) return nextLoad(url, context);
  if (!modules.has(url)) throw Error('EXACT_COMMIT_IMPORT_DENIED');
  return { format: 'module', source: modules.get(url), shortCircuit: true };
}
`;
  return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
