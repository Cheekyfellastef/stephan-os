// #3109: physical source-scope observation for the Island-owned verifier.
// Read-only. A path readback is not an authenticated owner/claim inventory,
// an OS custody lease, a stable write handle, or production admission.
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const RESCUE_ISLAND_PHYSICAL_SCOPE_SCHEMA =
  'stephanos.rescue-island-physical-scope-observation.v1';
export const RESCUE_ISLAND_PHYSICAL_SCOPE_MAX_PATHS = 64;
const PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,219}$/;
const fold = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const own = (value) => typeof value === 'string' && PATH.test(value)
  && !value.includes('//') && !value.endsWith('/')
  && !value.split('/').some((segment) => segment === '.' || segment === '..'
    || segment.toLowerCase() === '.git' || segment.toLowerCase() === 'node_modules');

function failed(blocker) {
  return Object.freeze({
    schemaVersion: RESCUE_ISLAND_PHYSICAL_SCOPE_SCHEMA,
    ok: false, blocker, scopeResolutionScan: 'HELD',
    scopeResolutions: Object.freeze([]),
    observedPathCount: 0,
    observationIsAuthoritative: false,
    ownershipAuthenticated: false,
    gamingBudgetAuthenticated: false,
    sourceMutationAllowed: false,
    workerStartAllowed: false,
    mergeAllowed: false,
    leaseReleaseAllowed: false,
  });
}

function inside(root, physical) {
  const rel = relative(root, physical);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep)
    && !isAbsolute(rel);
}

/**
 * Physical readback of an allowlisted set of candidate/claim path spellings.
 * Every existing ancestor is checked for redirects. Missing descendants have
 * only an observed existing ancestor and MUST be checked again at write time.
 * A trusted Windows host still needs independent claim/gaming observation and
 * secure, no-follow write-handle binding before it can authorise the builder.
 */
export async function observeRescueIslandPhysicalScopesV1({
  repositoryRoot, paths, io = { lstat, realpath },
} = {}) {
  if (typeof repositoryRoot !== 'string' || !isAbsolute(repositoryRoot)
      || !Array.isArray(paths) || paths.length < 1
      || paths.length > RESCUE_ISLAND_PHYSICAL_SCOPE_MAX_PATHS
      || paths.some((p) => !own(p))
      || new Set(paths.map((p) => p.toLowerCase())).size !== paths.length)
    return failed('RESCUE_ISLAND_SCOPE_INPUT_INVALID');
  const root = resolve(repositoryRoot);
  try {
    const rootInfo = await io.lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      return failed('RESCUE_ISLAND_REPOSITORY_ROOT_UNTRUSTED');
    const rootReal = await io.realpath(root);
    if (fold(resolve(rootReal)) !== fold(root))
      return failed('RESCUE_ISLAND_REPOSITORY_ROOT_REDIRECTED');
    const gitInfo = await io.lstat(join(root, '.git'));
    if (!gitInfo.isDirectory() || gitInfo.isSymbolicLink()
        || fold(resolve(await io.realpath(join(root, '.git')))) !== fold(join(root, '.git')))
      return failed('RESCUE_ISLAND_CANONICAL_GIT_ROOT_UNTRUSTED');

    const results = [];
    for (const path of paths) {
      let current = root;
      let missing = false;
      const parts = path.split('/');
      for (let i = 0; i < parts.length; i += 1) {
        const next = join(current, parts[i]);
        if (!inside(root, next))
          return failed('RESCUE_ISLAND_SCOPE_ESCAPE');
        if (!missing) {
          let info;
          try {
            info = await io.lstat(next);
          } catch (error) {
            if (error?.code !== 'ENOENT')
              return failed('RESCUE_ISLAND_SCOPE_STAT_UNAVAILABLE');
            missing = true;
          }
          if (info) {
            if (info.isSymbolicLink())
              return failed('RESCUE_ISLAND_SCOPE_REDIRECTED');
            if (i !== parts.length - 1 && !info.isDirectory())
              return failed('RESCUE_ISLAND_SCOPE_PARENT_NOT_DIRECTORY');
            if (i === parts.length - 1 && !info.isDirectory() && !info.isFile())
              return failed('RESCUE_ISLAND_SCOPE_LEAF_UNTRUSTED');
            const canonical = await io.realpath(next);
            // A junction/alias may not expose isSymbolicLink in every host.
            if (fold(resolve(canonical)) !== fold(next)
                || !inside(root, canonical))
              return failed('RESCUE_ISLAND_SCOPE_REDIRECTED');
          }
        }
        current = next;
      }
      // This output is observation data, not an authority assertion.
      results.push(Object.freeze({
        path, canonicalPath: path, repositoryContained: true,
        missingLeafOrAncestor: missing,
      }));
    }
    return Object.freeze({
      schemaVersion: RESCUE_ISLAND_PHYSICAL_SCOPE_SCHEMA,
      ok: true, blocker: '',
      scopeResolutionScan: 'LOCAL_READ_ONLY_UNAUTHENTICATED',
      scopeResolutions: Object.freeze(results),
      observedPathCount: results.length,
      // No claim about the original r7 worker or the three owner inventories.
      observationIsAuthoritative: false,
      ownershipAuthenticated: false,
      gamingBudgetAuthenticated: false,
      sourceMutationAllowed: false,
      workerStartAllowed: false,
      mergeAllowed: false,
      leaseReleaseAllowed: false,
    });
  } catch {
    // Never spill arbitrary native filenames, permissions or OS errors.
    return failed('RESCUE_ISLAND_SCOPE_OS_OBSERVATION_FAILED');
  }
}
