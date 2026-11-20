// Installed Commander parent code. Review/installation, OS binaries and transport
// authentication are trust roots; payload flags and checkout content are not.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { runCorePublicationDirectoryRepairCandidateV1 } from './sovereign-core-job-custody-preflight-v1.mjs';

const NATIVE_PATH = 'scripts/windows/SovereignCoreJobCustodyV1.cs';
const hold = reason => Object.freeze({ ok: false, reason, repairExecuted: false,
  dispatchAllowed: false, sourceMutationAllowed: false, originalR7Authority: false,
  specialistQualified: false, executionCustodyReleased: true }); // before native launch only

export async function executeCorePublicationDirectoryActionV1(command, options = {}) {
  const route = options.routeProof;
  if (route?.commandPathProven !== true || route.authenticatedMcp !== true || route.mcpSessionReady !== true)
    return hold('CORE_DIRECTORY_AUTHENTICATED_PRIVATE_MCP_REQUIRED');
  const head = command.plan?.expectedMain;
  if (!/^[a-f0-9]{40}$/.test(head ?? '') || !options.repoRoot
    || !command.commandId || !command.missionId) return hold('CORE_DIRECTORY_EXACT_IDENTITY_REQUIRED');
  if ((options.platform ?? process.platform) !== 'win32') return hold('CORE_JOB_NATIVE_WINDOWS_REQUIRED');
  const requestId = 'core-dir-' + createHash('sha256')
    .update(JSON.stringify([command.commandId, command.missionId])).digest('hex');
  let nativeAttempted = false;
  try {
    const git = resolveBattleBridgeGitExecution({ platform: options.platform ?? process.platform });
    const run = options.spawnSyncFn ?? spawnSync;
    const gitRead = args => {
      const result = run(git.executable, [...git.fixedConfigArgs, '-C', options.repoRoot, ...args], {
        shell: false, windowsHide: true, timeout: 12000, maxBuffer: 2097152, env: git.environment,
      });
      if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout))
        throw Error('CORE_DIRECTORY_GIT_EVIDENCE_UNAVAILABLE');
      return result.stdout;
    };
    const current = () => {
      if (gitRead(['symbolic-ref', '--quiet', '--short', 'HEAD']).toString().trim() !== 'main'
        || gitRead(['rev-parse', '--verify', 'HEAD']).toString().trim() !== head)
        throw Error('CORE_DIRECTORY_CURRENT_MAIN_REQUIRED');
      if (gitRead(['status', '--porcelain=v1', '--untracked-files=normal', '--ignore-submodules=none']).length)
        throw Error('CORE_DIRECTORY_DIRTY_CHECKOUT_PRESERVED');
    };
    current();
    const object = (type, sha) => {
      if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('CORE_DIRECTORY_OBJECT_ID_INVALID');
      const bytes = gitRead(['cat-file', type, sha]);
      if (createHash('sha1').update(type + ' ' + bytes.length + '\0').update(bytes).digest('hex') !== sha)
        throw Error('CORE_DIRECTORY_OBJECT_HASH_MISMATCH');
      return bytes;
    };
    let sha = /^tree ([a-f0-9]{40})\n/.exec(object('commit', head).toString())?.[1];
    const parts = NATIVE_PATH.split('/');
    for (let depth = 0; depth < parts.length; depth++) {
      const bytes = object('tree', sha);
      let entry;
      for (let i = 0; i < bytes.length;) {
        const space = bytes.indexOf(32, i), nul = bytes.indexOf(0, space + 1);
        if (space < i || nul < space || nul + 21 > bytes.length) throw Error('CORE_DIRECTORY_TREE_INVALID');
        if (bytes.toString('utf8', space + 1, nul) === parts[depth]) {
          if (entry) throw Error('CORE_DIRECTORY_TREE_AMBIGUOUS');
          entry = { mode: bytes.toString('ascii', i, space), sha: bytes.subarray(nul + 1, nul + 21).toString('hex') };
        }
        i = nul + 21;
      }
      if (!entry || entry.mode !== (depth === parts.length - 1 ? '100644' : '40000'))
        throw Error('CORE_DIRECTORY_FIXED_NATIVE_BLOB_REQUIRED');
      sha = entry.sha;
    }
    const bytes = object('blob', sha);
    if (bytes.length > 32768) throw Error('CORE_DIRECTORY_NATIVE_SOURCE_UNBOUNDED');
    const expectedNativeSourceSha256 = createHash('sha256').update(bytes).digest('hex');
    current();
    // The wrapper compares this authenticated digest with its single captured
    // installed C# buffer BEFORE compilation; no mutable checkout bytes execute.
    nativeAttempted = true;
    const result = await (options.runCoreDirectoryRepairFn ?? runCorePublicationDirectoryRepairCandidateV1)({
      requestId, sourceHead: head, expectedNativeSourceSha256, signal: options.signal,
    });
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || !Object.hasOwn(result, 'executionCustodyReleased') || result.executionCustodyReleased !== true) return Object.freeze({
      ...hold('CORE_DIRECTORY_TERMINAL_CUSTODY_UNPROVEN'), executionCustodyReleased: false,
      requestId, sourceHead: head, workspaceMutationState: 'UNPROVEN_RETAIN_ORIGINAL_REQUEST',
    });
    // Keep the narrow postcondition and original request visible. This action
    // never authorises R7, generic repairs, qualification or an automatic retry.
    return Object.freeze({ ...result, requestId, sourceHead: head,
      dispatchAllowed: false, sourceMutationAllowed: false, originalR7Authority: false,
      specialistQualified: false, coreHealthProven: false, originalBuilderRecovered: false });
  } catch (error) {
    return Object.freeze({ ...hold(String(error.message).startsWith('CORE_DIRECTORY_')
      ? error.message : 'CORE_DIRECTORY_ADMISSION_FAILED'), requestId, sourceHead: head,
      executionCustodyReleased: !nativeAttempted,
      workspaceMutationState: 'UNPROVEN_RETAIN_ORIGINAL_REQUEST' });
  }
}
