import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export function createMaintenanceOsAnchorV1({ workspaceRoot, signingKey, spawnFn = spawnSync,
  platform = process.platform } = {}) {
  if (platform !== 'win32' || typeof signingKey !== 'string' || signingKey.length < 32 || signingKey.length > 4096)
    throw new Error('MAINTENANCE_OS_ANCHOR_UNAVAILABLE');
  const scope = createHash('sha256').update(resolve(workspaceRoot).toLowerCase()).digest('hex');
  const decode = result => {
    if (result?.found === false && Object.keys(result).join(',') === 'found') return null;
    if (result?.found !== true || Object.keys(result).sort().join(',') !== 'envelopeBase64,eventRecordId,found'
        || typeof result.envelopeBase64 !== 'string' || result.envelopeBase64.length > 28000)
      throw new Error('MAINTENANCE_OS_ANCHOR_IDENTITY_INVALID');
    let row;
    try {
      const bytes = Buffer.from(result.envelopeBase64, 'base64');
      if (bytes.toString('base64') !== result.envelopeBase64) throw new Error();
      row = JSON.parse(bytes.toString('utf8'));
    } catch { throw new Error('MAINTENANCE_OS_ANCHOR_ENCODING_INVALID'); }
    if (!row || Object.keys(row).sort().join(',') !== 'mac,recordId,scope,stateBase64,transitionId'
        || row.scope !== scope || !Number.isSafeInteger(row.recordId) || row.recordId < 1
        || result.eventRecordId !== row.recordId || !/^[a-f0-9-]{36}$/.test(row.transitionId ?? '')
        || !/^[a-f0-9]{64}$/.test(row.mac ?? '') || typeof row.stateBase64 !== 'string'
        || row.stateBase64.length > 20000)
      throw new Error('MAINTENANCE_OS_ANCHOR_IDENTITY_INVALID');
    const expected = createHmac('sha256', signingKey).update('stephanos-maintenance-os-anchor-v1\0'
      + scope + '\0' + row.recordId + '\0' + row.transitionId + '\0' + row.stateBase64).digest();
    if (!timingSafeEqual(expected, Buffer.from(row.mac, 'hex')))
      throw new Error('MAINTENANCE_OS_ANCHOR_AUTHENTICATION_FAILED');
    const bytes = Buffer.from(row.stateBase64, 'base64');
    if (bytes.toString('base64') !== row.stateBase64) throw new Error('MAINTENANCE_OS_ANCHOR_ENCODING_INVALID');
    return { bytes, eventRecordId: row.recordId };
  };
  const call = (mode, extra = {}) => {
    const result = spawnFn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        fileURLToPath(new URL('./windows/sovereign-maintenance-audit-anchor.ps1', import.meta.url)), '-Mode', mode],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10_000, maxBuffer: 32 * 1024,
        env: createBattleBridgeMinimalChildEnvironment(process.env, { platform: 'win32' }),
        input: mode === 'Read' ? scope + '\n' : [scope, extra.stateBase64, extra.transitionId,
          Buffer.from(signingKey, 'utf8').toString('base64')].join('\n') + '\n' });
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
    append: bytes => {
      if (!Buffer.isBuffer(bytes) || bytes.length > 15000) throw new Error('MAINTENANCE_OS_ANCHOR_UNBOUNDED');
      const result = call('Append', { stateBase64: bytes.toString('base64'), transitionId: randomUUID() });
      if (!result || !result.bytes.equals(bytes)) throw new Error('MAINTENANCE_OS_ANCHOR_APPEND_UNPROVEN');
      return result;
    },
  });
}
