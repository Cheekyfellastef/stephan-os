import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { inspectStructuredNewFileContractV1 } from './providerNeutralSourceBuilderService.js';
import { KNOWN_MALFORMED_PATCH_REPAIR_V1 as C, isKnownMalformedPatchRetryV1,
  knownMalformedPatchEvidenceMatchesV1, knownMalformedPatchDigestV1 } from '../../shared/agents/knownMalformedPatchRetryV1.mjs';

const SOURCE_PATHS = Object.freeze([
  'stephanos-server/services/providerNeutralSourceBuilderService.js',
  'shared/ai/localBuilderModelRequestV1.mjs',
  'shared/agents/knownMalformedPatchRetryV1.mjs',
]);
const OBSERVATIONS = Object.freeze(['acceptsEmptySnapshotNewFile', 'rejectsInventedOldContents',
  'rejectsEmptyOldForExistingFile', 'rejectsOutOfScope', 'rejectsTraversal', 'rejectsEmptyNewFile',
  'modelRequestAcceptsStructuredEditsWithoutSnapshots']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceText = bytes => Buffer.from(bytes).toString('utf8').replaceAll('\r\n', '\n');
const runGitDefault = (repoRoot, args) => spawnSync('git', ['-C', repoRoot, ...args],
  { shell: false, windowsHide: true, timeout: 5000, maxBuffer: 2 * 1024 * 1024 });

// Trusted in-process service dependencies support isolated tests. No request or
// mission JSON can supply a verdict, arbitrary command, file list, or probe.
export async function collectKnownMalformedPatchRetryEvidenceV1({
  mission, sourceHead, ownershipRelease, repoRoot,
  runGit = runGitDefault, readSource = readFile, inspect = inspectStructuredNewFileContractV1,
} = {}) {
  const hold = reason => ({ ok: false, reason, proof: null });
  if (!isKnownMalformedPatchRetryV1(mission) || !/^[a-f0-9]{40}$/.test(sourceHead)
      || ownershipRelease?.ok !== true || ownershipRelease.missionId !== C.missionId
      || ownershipRelease.actionId !== C.actionId || ownershipRelease.adapter !== C.adapter) return hold('KNOWN_PATCH_IDENTITY_OR_CUSTODY_UNPROVEN');
  const git = args => {
    const result = runGit(repoRoot, args);
    if (result?.error || result?.status !== 0) throw Error('SOURCE_GIT_READ_FAILED');
    return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
  };
  try {
    const current = () => git(['rev-parse', 'HEAD']).toString().trim() === sourceHead
      && git(['rev-parse', 'refs/remotes/origin/main']).toString().trim() === sourceHead;
    if (!current()) return hold('KNOWN_PATCH_CURRENT_MAIN_MOVED');
    git(['merge-base', '--is-ancestor', C.repairCommit, sourceHead]);
    const inspection = inspect();
    if (inspection?.schemaVersion !== 'stephanos.structured-new-file-contract.v1'
        || Object.keys(inspection.observations || {}).length !== OBSERVATIONS.length
        || !OBSERVATIONS.every(key => inspection.observations[key] === true)) return hold('KNOWN_PATCH_MECHANISM_UNAVAILABLE');
    const sourceBlobs = [];
    for (const relative of SOURCE_PATHS) {
      const exact = git(['show', `${sourceHead}:${relative}`]);
      const disk = await readSource(path.join(repoRoot, relative));
      if (sourceText(disk) !== sourceText(exact)) return hold('KNOWN_PATCH_SOURCE_BYTES_CHANGED');
      sourceBlobs.push({ path: relative, sha256: digest(exact), diskSha256: digest(disk) });
    }
    if (inspection.loadedSourceSha256 !== sourceBlobs[0].diskSha256) return hold('KNOWN_PATCH_LOADED_BUILDER_STALE');
    // File/head changes during awaited reads never produce a reusable permit.
    for (const blob of sourceBlobs) if (digest(await readSource(path.join(repoRoot, blob.path))) !== blob.diskSha256) return hold('KNOWN_PATCH_SOURCE_BYTES_CHANGED');
    if (!current()) return hold('KNOWN_PATCH_CURRENT_MAIN_MOVED');
    const proof = { schemaVersion: 'stephanos.known-malformed-patch-retry.v1', missionId: C.missionId,
      missionRevision: mission.revision, sourceHead, repairCommit: C.repairCommit,
      terminal: ownershipRelease.knownMalformedPatchTerminal,
      mechanismSha256: knownMalformedPatchDigestV1(inspection), sourceBlobSetSha256: knownMalformedPatchDigestV1(sourceBlobs) };
    if (!knownMalformedPatchEvidenceMatchesV1(proof, mission, sourceHead)) return hold('KNOWN_PATCH_ORIGINAL_TERMINAL_UNPROVEN');
    return { ok: true, proof };
  } catch {
    return hold('KNOWN_PATCH_SOURCE_QUALIFICATION_FAILED');
  }
}
