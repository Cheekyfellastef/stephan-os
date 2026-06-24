import { createHash, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function finish(payload, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(exitCode);
}

const privateKeyPath = process.argv[2] ? resolve(process.argv[2]) : '';
const publicKeyPath = process.argv[3] ? resolve(process.argv[3]) : '';

if (!privateKeyPath || !publicKeyPath) {
  finish({
    finalVerdict: 'BLOCKED',
    message: 'Usage: node scripts/stephanos-bootstrap-openclaw-github-keys.mjs <private-key.pem> <public-key.pem>',
  }, 1);
}

const privateExists = existsSync(privateKeyPath);
const publicExists = existsSync(publicKeyPath);
if (privateExists !== publicExists) {
  finish({
    finalVerdict: 'BLOCKED',
    message: 'OpenClaw GitHub signing key pair is incomplete. Refusing to overwrite either key.',
    privateKeyPresent: privateExists,
    publicKeyPresent: publicExists,
  }, 1);
}

if (privateExists && publicExists) {
  finish({
    finalVerdict: 'STEPHANOS_GITHUB_SIGNING_KEYS_PRESENT',
    privateKeyPath,
    publicKeyPath,
    keysCreated: false,
  });
}

mkdirSync(dirname(privateKeyPath), { recursive: true });
mkdirSync(dirname(publicKeyPath), { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

try {
  writeFileSync(privateKeyPath, privateKeyPem, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  writeFileSync(publicKeyPath, publicKeyPem, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
  try {
    chmodSync(privateKeyPath, 0o600);
  } catch {
    // Windows ACLs are applied by the acceptance runner.
  }
} catch (error) {
  if (!publicExists) rmSync(publicKeyPath, { force: true });
  if (!privateExists) rmSync(privateKeyPath, { force: true });
  finish({
    finalVerdict: 'BLOCKED',
    message: `OpenClaw GitHub signing keys could not be created: ${error?.message || 'unknown error'}`,
  }, 1);
}

finish({
  finalVerdict: 'STEPHANOS_GITHUB_SIGNING_KEYS_CREATED',
  privateKeyPath,
  publicKeyPath,
  publicKeySha256: createHash('sha256').update(publicKeyPem, 'utf8').digest('hex'),
  keysCreated: true,
});
