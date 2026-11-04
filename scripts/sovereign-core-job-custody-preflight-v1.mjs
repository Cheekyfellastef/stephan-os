// Fixed read-only native custody preflight for the existing Commander. No MCP
// action is enrolled until independent installation and Windows admission.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createBattleBridgeMinimalChildEnvironment } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SOURCE = new URL('./windows/SovereignCoreJobCustodyV1.cs', import.meta.url);
const noAuthority = Object.freeze({ sourceMutationAllowed: false, originalR7Authority: false,
  specialistQualified: false, repairExecuted: false, dispatchAllowed: false });
const held = reason => Object.freeze({ ok: false, reason, ...noAuthority });
const heldBeforeLaunch = reason => Object.freeze({ ...held(reason), executionCustodyReleased: true });

export function projectCoreJobCustodyCandidateV1(raw, { requestId, sourceHead, nativeSourceSha256 }) {
  if (!/^[a-z0-9-]{8,80}$/.test(requestId ?? '') || !/^[a-f0-9]{40}$/.test(sourceHead ?? '')
    || !/^[a-f0-9]{64}$/.test(nativeSourceSha256 ?? '')) return held('CORE_JOB_EXACT_REQUEST_REQUIRED');
  if (raw?.SchemaVersion === 'stephanos.core-job-custody-candidate.v1'
    && raw.RequestId === requestId && raw.SourceHead === sourceHead
    && ['SourceMutationAllowed','OriginalR7Authority','SpecialistQualified','RepairExecuted'].every(k => raw[k] === false)
    && raw.ChildPid === 0 && raw.AssignedBeforeExecution === false
    && ['GAMING_GUARD_BLOCKED','CANCELLED_BEFORE_LAUNCH'].includes(raw.Reason)) {
    return Object.freeze({ ...held('CORE_JOB_' + raw.Reason), childLaunched: false, requestId, sourceHead });
  }
  if (!raw || raw.SchemaVersion !== 'stephanos.core-job-custody-candidate.v1'
    || raw.RequestId !== requestId || raw.SourceHead !== sourceHead
    || ['SourceMutationAllowed','OriginalR7Authority','SpecialistQualified','RepairExecuted'].some(k => raw[k] !== false)
    || raw.AssignedBeforeExecution !== true
    || raw.ZeroActiveProcessesObserved !== true || raw.CustodyReleased !== true
    || raw.ActiveProcesses !== 0 || !Number.isSafeInteger(raw.ChildPid) || raw.ChildPid <= 0
    || raw.CancellationRequested !== true || raw.CancellationAcknowledged !== true
    || raw.Reason !== 'DEADLINE_CANCELLED' || raw.Verdict !== 'HELD'
    || !Number.isSafeInteger(raw.ExitCode) || raw.ExitCode < 0) {
    return held('NATIVE_CUSTODY_CANDIDATE_UNBOUND_OR_INCOMPLETE');
  }
  return Object.freeze({ ok: true, status: 'CORE_JOB_CUSTODY_CANDIDATE_UNQUALIFIED',
    requestId, sourceHead, nativeSourceSha256, assignedBeforeExecution: true,
    cancellationAcknowledged: true, zeroActiveProcessesObserved: true,
    custodyReleased: true, ...noAuthority });
}

export function projectCoreDirectoryRepairCandidateV1(raw, binding) {
  const valid = /^[a-z0-9-]{8,80}$/.test(binding.requestId ?? '')
    && /^[a-f0-9]{40}$/.test(binding.sourceHead ?? '')
    && /^[a-f0-9]{64}$/.test(binding.nativeSourceSha256 ?? '')
    && raw?.SchemaVersion === 'stephanos.core-job-custody-candidate.v1'
    && raw.RequestId === binding.requestId && raw.SourceHead === binding.sourceHead
    && raw.RepairScope === 'CORE_PUBLICATION_DIRECTORIES_ONLY'
    && raw.WorkspaceMutationAttempted === true && raw.RepairExecuted === true
    && raw.CorePublicationDirectoriesReady === true && raw.CancellationRequested === false
    && raw.AssignedBeforeExecution === true && raw.ZeroActiveProcessesObserved === true
    && raw.CustodyReleased === true && raw.ActiveProcesses === 0 && raw.ExitCode === 0
    && Number.isSafeInteger(raw.ChildPid) && raw.ChildPid > 0
    && ['SourceMutationAllowed','OriginalR7Authority','SpecialistQualified'].every(k => raw[k] === false)
    && raw.Verdict === 'CORE_DIRECTORY_REPAIR_SATISFIED_UNQUALIFIED' && raw.Reason === '';
  if (!valid) return Object.freeze({ ...held('CORE_DIRECTORY_REPAIR_UNBOUND_OR_INCOMPLETE'),
    // A cancelled/missing receipt never licenses retry or a no-change claim.
    workspaceMutationState: 'UNPROVEN_RETAIN_ORIGINAL_REQUEST' });
  return Object.freeze({ ...noAuthority, ok: true, status: 'CORE_DIRECTORY_REPAIR_SATISFIED_UNQUALIFIED',
    requestId: binding.requestId, sourceHead: binding.sourceHead, nativeSourceSha256: binding.nativeSourceSha256,
    repairExecuted: true, workspaceMutationAttempted: true, corePublicationDirectoriesReady: true,
    zeroActiveProcessesObserved: true, custodyReleased: true,
    coreHealthProven: false, originalBuilderRecovered: false });
}

export function runCoreJobCustodyPreflightV1(options = {}) {
  return runCoreJobCandidate(options, false);
}
export function runCorePublicationDirectoryRepairCandidateV1(options = {}) {
  return runCoreJobCandidate(options, true);
}
async function runCoreJobCandidate({ requestId, sourceHead, signal, expectedNativeSourceSha256,
  platform = process.platform, spawnFn = spawn, environment = process.env,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}, repairDirectories) {
  if (!/^[a-z0-9-]{8,80}$/.test(requestId ?? '') || !/^[a-f0-9]{40}$/.test(sourceHead ?? ''))
    return heldBeforeLaunch('CORE_JOB_EXACT_REQUEST_REQUIRED');
  if (platform !== 'win32') return heldBeforeLaunch('CORE_JOB_NATIVE_WINDOWS_REQUIRED');
  if (signal?.aborted) return heldBeforeLaunch('CORE_JOB_CANCELLED_BEFORE_LAUNCH');
  if (repairDirectories && !/^[a-f0-9]{64}$/.test(expectedNativeSourceSha256 ?? ''))
    return heldBeforeLaunch('CORE_JOB_AUTHENTICATED_NATIVE_DIGEST_REQUIRED');
  // Capture installed-parent native dependency once, then compile THAT memory
  // over stdin. A between-read-and-Add-Type path swap cannot substitute bytes.
  // Protection/versioning of this installed parent closure is a separate gate.
  let bytes;
  try { bytes = readFileSync(SOURCE); } catch { return heldBeforeLaunch('CORE_JOB_INSTALLED_SOURCE_UNAVAILABLE'); }
  if (bytes.length > 32768) return heldBeforeLaunch('CORE_JOB_INSTALLED_SOURCE_UNBOUNDED');
  const nativeSourceSha256 = createHash('sha256').update(bytes).digest('hex');
  if (repairDirectories && nativeSourceSha256 !== expectedNativeSourceSha256)
    return heldBeforeLaunch('CORE_JOB_INSTALLED_NATIVE_SOURCE_DRIFT');
  const script = `$ErrorActionPreference='Stop';
    $source=[Console]::ReadLine(); if($source.Length -gt 65536){exit 76};
    Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($source)));
    function GamingSafe {
      try {
        $p=Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) 'Documents/Stephanos-openclaw-workspace/vr/vr-resource-governor-current.json';
        $raw=[Stephanos.Sovereign.CoreJobCustodyV1]::ReadGovernorLocked($p);
        if($null -eq $raw){return $false}; $g=$raw | ConvertFrom-Json;
        $age=([DateTimeOffset]::UtcNow-[DateTimeOffset]::Parse($g.updatedAtUtc)).TotalMilliseconds;
        if($g.schemaVersion -cne 'stephanos.vr-resource-governor.v1' -or $g.governorVersion -ne 3
          -or $g.phase -cne 'NORMAL' -or $age -lt 0 -or $age -gt 15000){return $false};
        foreach($key in @('active','flatGameActive','airLinkActive','realAirLinkActive','virtualAirLinkTestActive','prepareLeaseActive')){
          if($g.$key -isnot [bool] -or $g.$key -ne $false){return $false}
        }; return $true
      }catch{return $false}
    };
    $r=[Stephanos.Sovereign.CoreJobCustodyV1]::${repairDirectories ? 'RepairCorePublicationDirectories' : 'ProbeWithParentInput'}('${requestId}','${sourceHead}',[Func[bool]]{GamingSafe});
    [Console]::WriteLine('CORE_JOB_RESULT='+($r|ConvertTo-Json -Compress));`;
  return new Promise(resolve => {
    let child;
    try {
      child = spawnFn(POWERSHELL, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')], { shell: false, windowsHide: true,
        stdio: ['pipe','pipe','pipe'], env: createBattleBridgeMinimalChildEnvironment(environment, { platform: 'win32' }) });
    } catch { resolve(held('CORE_JOB_PARENT_LAUNCH_FAILED')); return; }
    let stdout = '', overflow = false, settled = false, cancelled = false, timedOut = false;
    const finish = value => {
      if (settled) return;
      settled = true; clearTimeoutFn(timer); signal?.removeEventListener('abort', cancel);
      resolve(repairDirectories && value.ok !== true ? Object.freeze({ ...value,
        requestId, sourceHead, workspaceMutationState: 'UNPROVEN_RETAIN_ORIGINAL_REQUEST' }) : value);
    };
    // Deadline includes compilation, worker budget, cooperative stop and OS
    // drain. Forced parent death kills its non-inherited Job, but without its
    // terminal zero-active receipt this request remains HELD, never retried.
    const timer = setTimeoutFn(() => {
      timedOut = true;
      // kill() is only a request. Keep the original promise/admission pending
      // until close, even when kill returns false, throws or closes synchronously.
      try { child.kill(); } catch {}
    }, 12000);
    const cancel = () => { cancelled = true; try { child.stdin.write('CANCEL\n'); } catch {} };
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => {
      if (stdout.length + chunk.length > 16384) { overflow = true; cancel(); }
      else stdout += chunk;
    });
    child.stderr.on('data', () => {}); // Drain; never publish raw stderr/source.
    // An execution error after spawn may precede close. Neither is a new lane.
    child.on('error', () => { cancelled = true; });
    child.on('close', code => {
      const lines = stdout.split(/\r?\n/).filter(l => l.startsWith('CORE_JOB_RESULT='));
      let raw;
      try { if (lines.length === 1 && !overflow) raw = JSON.parse(lines[0].slice(16)); } catch {}
      const bound = raw?.SchemaVersion === 'stephanos.core-job-custody-candidate.v1'
        && raw.RequestId === requestId && raw.SourceHead === sourceHead
        && ['SourceMutationAllowed','OriginalR7Authority','SpecialistQualified'].every(k => raw[k] === false);
      const custodyReleased = bound && ((raw.AssignedBeforeExecution === true && raw.ZeroActiveProcessesObserved === true
        && raw.CustodyReleased === true && raw.ActiveProcesses === 0
        && Number.isSafeInteger(raw.ChildPid) && raw.ChildPid > 0)
        || (raw.ChildPid === 0 && raw.AssignedBeforeExecution === false && raw.RepairExecuted === false
          && raw.WorkspaceMutationAttempted === false && raw.Verdict === 'HELD'
          && ['GAMING_GUARD_BLOCKED','CANCELLED_BEFORE_LAUNCH'].includes(raw.Reason)));
      const complete = value => finish(Object.freeze({ ...value, executionCustodyReleased: custodyReleased }));
      if (timedOut) { complete(held('CORE_JOB_TERMINAL_CUSTODY_UNPROVEN')); return; }
      if (code !== 0 || overflow || cancelled) { complete(held('CORE_JOB_EXECUTION_OR_CANCEL_HELD')); return; }
      if (lines.length !== 1) { complete(held('CORE_JOB_TERMINAL_RECEIPT_MISSING')); return; }
      if (!raw) { complete(held('CORE_JOB_TERMINAL_RECEIPT_INVALID')); return; }
      complete((repairDirectories ? projectCoreDirectoryRepairCandidateV1 : projectCoreJobCustodyCandidateV1)(raw,
        { requestId, sourceHead, nativeSourceSha256 }));
    });
    // Do not end stdin: EOF is a custody cancellation signal, including when
    // this Commander parent dies. No candidate script is read from disk.
    child.stdin.write(bytes.toString('base64') + '\n');
    if (signal?.aborted) cancel();
  });
}
