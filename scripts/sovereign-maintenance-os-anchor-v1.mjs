import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export function createMaintenanceOsAnchorV1({ workspaceRoot, signingKey, spawnFn = spawnSync,
  platform = process.platform, nativeFixture = false } = {}) {
  if (platform !== 'win32' || typeof signingKey !== 'string' || signingKey.length < 32 || signingKey.length > 4096)
    throw new Error('MAINTENANCE_OS_ANCHOR_UNAVAILABLE');
  const fixtureRelative = relative(tmpdir(), resolve(workspaceRoot));
  if (nativeFixture && (signingKey !== 'fixture-os-anchor-key-'.repeat(3)
      || !fixtureRelative || fixtureRelative.startsWith('..') || isAbsolute(fixtureRelative)))
    throw new Error('MAINTENANCE_NATIVE_FIXTURE_SCOPE_INVALID');
  const journalId = nativeFixture ? 'retained-v2-fixture' : 'retained-v2-production';
  const scope = createHash('sha256').update(resolve(workspaceRoot).toLowerCase()).digest('hex');
  const decode = result => {
    if (result?.journalId !== journalId) throw new Error('MAINTENANCE_OS_JOURNAL_IDENTITY_INVALID');
    if (result?.found === false && Object.keys(result).sort().join(',') === 'found,journalId') return null;
    if (result?.found !== true || Object.keys(result).sort().join(',') !== 'envelopeBase64,eventRecordId,found,journalId'
        || typeof result.envelopeBase64 !== 'string' || result.envelopeBase64.length > 28000)
      throw new Error('MAINTENANCE_OS_ANCHOR_IDENTITY_INVALID');
    let row;
    try {
      const bytes = Buffer.from(result.envelopeBase64, 'base64');
      if (bytes.toString('base64') !== result.envelopeBase64) throw new Error();
      row = JSON.parse(bytes.toString('utf8'));
    } catch { throw new Error('MAINTENANCE_OS_ANCHOR_ENCODING_INVALID'); }
    if (!row || Object.keys(row).sort().join(',') !== 'journalId,mac,previousRecordId,recordId,scope,stateBase64,transitionId'
        || row.scope !== scope || row.journalId !== journalId || !Number.isSafeInteger(row.recordId) || row.recordId < 1
        || !(row.previousRecordId === null || (Number.isSafeInteger(row.previousRecordId)
          && row.previousRecordId > 0 && row.previousRecordId < row.recordId))
        || result.eventRecordId !== row.recordId || !/^[a-f0-9-]{36}$/.test(row.transitionId ?? '')
        || !/^[a-f0-9]{64}$/.test(row.mac ?? '') || typeof row.stateBase64 !== 'string'
        || row.stateBase64.length > 20000)
      throw new Error('MAINTENANCE_OS_ANCHOR_IDENTITY_INVALID');
    const expected = createHmac('sha256', signingKey).update('stephanos-maintenance-os-anchor-v3\0' + journalId + '\0'
      + scope + '\0' + row.recordId + '\0' + (row.previousRecordId ?? 'NONE')
      + '\0' + row.transitionId + '\0' + row.stateBase64).digest();
    if (!timingSafeEqual(expected, Buffer.from(row.mac, 'hex')))
      throw new Error('MAINTENANCE_OS_ANCHOR_AUTHENTICATION_FAILED');
    const bytes = Buffer.from(row.stateBase64, 'base64');
    if (bytes.toString('base64') !== row.stateBase64) throw new Error('MAINTENANCE_OS_ANCHOR_ENCODING_INVALID');
    return { bytes, eventRecordId: row.recordId, previousRecordId: row.previousRecordId };
  };
  const call = (mode, extra = {}) => {
    const result = spawnFn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        fileURLToPath(new URL('./windows/sovereign-maintenance-audit-anchor.ps1', import.meta.url)), '-Mode', mode,
        ...(nativeFixture ? ['-Fixture'] : [])],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 32 * 1024,
        env: createBattleBridgeMinimalChildEnvironment(process.env, { platform: 'win32' }),
        input: mode === 'Read' ? scope + '\n' : [scope, extra.stateBase64, extra.transitionId,
          extra.expectedRecordId ?? 'NONE', Buffer.from(signingKey, 'utf8').toString('base64')].join('\n') + '\n' });
    if (result.error || result.status !== 0) {
      const stages = [...String(result.stderr || '').matchAll(/^SOVEREIGN_ANCHOR_STAGE=(START|INPUT|CONFIG|ACL|QUERY_OPEN|QUERY|NEXT)\r?$/gm)];
      throw Object.assign(new Error('MAINTENANCE_OS_ANCHOR_UNPROVEN'), {
        stage: stages.at(-1)?.[1] || 'UNKNOWN',
        failureKind: result.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'FAILED',
      });
    }
    return decode(JSON.parse(result.stdout));
  };
  return Object.freeze({
    readLatest: () => call('Read'),
    append: (bytes, { expectedRecordId } = {}) => {
      if (!Buffer.isBuffer(bytes) || bytes.length > 15000) throw new Error('MAINTENANCE_OS_ANCHOR_UNBOUNDED');
      if (!(expectedRecordId === null || (Number.isSafeInteger(expectedRecordId) && expectedRecordId > 0)))
        throw new Error('MAINTENANCE_OS_ANCHOR_PREVIOUS_ID_REQUIRED');
      const result = call('Append', { stateBase64: bytes.toString('base64'), transitionId: randomUUID(), expectedRecordId });
      if (!result || result.previousRecordId !== expectedRecordId || !result.bytes.equals(bytes))
        throw new Error('MAINTENANCE_OS_ANCHOR_APPEND_UNPROVEN');
      return result;
    },
  });
}

/** Fixed read-only contradiction check; never an authority fallback or writer. */
export function readMaintenanceLegacyAuditObservationV1({ workspaceRoot, signingKey, spawnFn = spawnSync } = {}) {
  if (process.platform !== 'win32' || typeof signingKey !== 'string' || signingKey.length < 32)
    throw new Error('MAINTENANCE_LEGACY_AUDIT_UNPROVEN');
  const scope = createHash('sha256').update(resolve(workspaceRoot).toLowerCase()).digest('hex');
  const result = spawnFn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
      fileURLToPath(new URL('./windows/sovereign-maintenance-audit-anchor.ps1', import.meta.url)),
      '-Mode', 'ObserveLegacy'],
    { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 32 * 1024,
      env: createBattleBridgeMinimalChildEnvironment(process.env, { platform: 'win32' }), input: scope + '\n' });
  if (result.error || result.status !== 0) throw new Error('MAINTENANCE_LEGACY_AUDIT_UNPROVEN');
  let envelope;
  try { envelope = JSON.parse(result.stdout); } catch { throw new Error('MAINTENANCE_LEGACY_AUDIT_UNPROVEN'); }
  if (envelope?.journalId !== 'legacy-v1-observation') throw new Error('MAINTENANCE_LEGACY_AUDIT_UNPROVEN');
  if (envelope.found === false && Object.keys(envelope).sort().join(',') === 'found,journalId')
    return Object.freeze({ present: false });
  try {
    if (envelope.found !== true || Object.keys(envelope).sort().join(',') !== 'envelopeBase64,eventRecordId,found,journalId'
        || typeof envelope.envelopeBase64 !== 'string' || envelope.envelopeBase64.length > 28000) throw new Error();
    const bytes = Buffer.from(envelope.envelopeBase64, 'base64');
    if (bytes.toString('base64') !== envelope.envelopeBase64) throw new Error();
    const row = JSON.parse(bytes);
    if (Object.keys(row).sort().join(',') !== 'mac,previousRecordId,recordId,scope,stateBase64,transitionId'
        || row.scope !== scope || !Number.isSafeInteger(row.recordId) || row.recordId < 1
        || row.recordId !== envelope.eventRecordId
        || !(row.previousRecordId === null || (Number.isSafeInteger(row.previousRecordId)
          && row.previousRecordId > 0 && row.previousRecordId < row.recordId))
        || !/^[a-f0-9-]{36}$/.test(row.transitionId ?? '') || !/^[a-f0-9]{64}$/.test(row.mac ?? '')
        || typeof row.stateBase64 !== 'string' || row.stateBase64.length > 20000) throw new Error();
    const expected = createHmac('sha256', signingKey).update('stephanos-maintenance-os-anchor-v2\0'
      + scope + '\0' + row.recordId + '\0' + (row.previousRecordId ?? 'NONE') + '\0'
      + row.transitionId + '\0' + row.stateBase64).digest();
    if (!timingSafeEqual(expected, Buffer.from(row.mac, 'hex'))) throw new Error();
    return Object.freeze({ present: true, eventRecordId: row.recordId });
  } catch { throw new Error('MAINTENANCE_LEGACY_AUDIT_UNPROVEN'); }
}
