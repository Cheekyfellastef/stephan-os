import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { authenticateLegacyOrphanQuarantine } from '../../../stephanos-server/services/legacyOriginalSourceOrphanQuarantineV1.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.argv[2] === 'canonical') {
  const wire = process.argv[3];
  if (typeof wire !== 'string' || Buffer.byteLength(wire) > 16384) throw new Error('TEST_WIRE_BOUND');
  process.stdout.write(JSON.stringify({ canonical: JSON.stringify(JSON.parse(wire)) }));
} else if (process.argv[2] === 'path') {
  process.stdout.write(JSON.stringify({ canonicalWorktree: fs.realpathSync(process.argv[3]) }));
} else if (process.argv[2] === 'verify') {
  const f = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const env = {
    STEPHANOS_LEGACY_ORPHAN_EVIDENCE_PATH: f.recordPath,
    STEPHANOS_LEGACY_ORPHAN_OS_WITNESS_PUBLIC_KEY_PATH: f.witnessPublicPath,
    STEPHANOS_LEGACY_ORPHAN_OPERATOR_PUBLIC_KEY_PATH: f.operatorPublicPath,
    STEPHANOS_LEGACY_ORPHAN_OS_WITNESS_PUBLIC_KEY_SHA256: sha(fs.readFileSync(f.witnessPublicPath)),
    STEPHANOS_LEGACY_ORPHAN_OPERATOR_PUBLIC_KEY_SHA256: sha(fs.readFileSync(f.operatorPublicPath)),
  };
  const scoped = await authenticateLegacyOrphanQuarantine(f.expected, {
    env, now: () => Date.parse(f.clockUtc),
  });
  const noProductionPins = await authenticateLegacyOrphanQuarantine(f.expected, {
    env: {}, now: () => Date.parse(f.clockUtc),
  });
  const record = JSON.parse(fs.readFileSync(f.recordPath, 'utf8'));
  const interpretedWitness = JSON.stringify(record.osWitness);
  const canonicalSource = fs.readFileSync(fileURLToPath(new URL(
    '../../../stephanos-server/services/legacyOriginalSourceOrphanQuarantineV1.js', import.meta.url)));
  process.stdout.write(JSON.stringify({
    testOnlyTrust: true, scoped,
    noProductionPins, interpretedWitnessDigest: sha(Buffer.from(interpretedWitness)),
    actualVerifierSourceSha256: sha(canonicalSource),
    base64RoundTripHasPlusSlashEquals: ['+', '/', '='].every(c => record.osWitness.signatureBase64.includes(c)),
    interpretedWitness
  }));
} else {
  throw new Error('FIXED_TEST_OPERATION_REQUIRED');
}
