import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const STEPHANOS_NATIVE_VERIFY_COMMAND = 'npm run stephanos:verify';
export const STEPHANOS_NATIVE_VERIFY_SCRIPT = 'scripts/verify-stephanos-dist.mjs';
const SOURCE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;
const FORBIDDEN = /(^|\/)(?:\.git|node_modules|runtime|runtime-data|stephanos-server\/data)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i;
const NODE_TEST = /^node --test ([A-Za-z0-9._/@+-]+(?: [A-Za-z0-9._/@+-]+)*)$/;
const text = value => typeof value === 'string' ? value.trim() : '';

export function nativeFocusedSourcePath(value) {
  const path = text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
  return SOURCE_PATH.test(path) && !FORBIDDEN.test(path) && !/[*?\[\]]/.test(path) ? path : '';
}

// Admission's literal + literal/** expansion is one resource representation.
// Require the explicit literal and narrow native execution to that one file;
// a glob alone, a directory grant or a second literal never supplies it.
export function resolveStephanosNativeFocusedSourceFile(allowedFiles) {
  if (!Array.isArray(allowedFiles) || types.isProxy(allowedFiles)
      || Object.getPrototypeOf(allowedFiles) !== Array.prototype
      || allowedFiles.length < 1 || allowedFiles.length > 2
      || Reflect.ownKeys(allowedFiles).length !== allowedFiles.length + 1) return '';
  for (let i = 0; i < allowedFiles.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(allowedFiles, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') return '';
  }
  const literal = allowedFiles.filter(path => typeof path === 'string' && !path.endsWith('/**'));
  if (literal.length !== 1) return '';
  const file = nativeFocusedSourcePath(literal[0]);
  if (!file || file !== literal[0]) return '';
  return allowedFiles.every(path => path === file || path === `${file}/**`) ? file : '';
}

export function parseStephanosNativeFocusedTestCommand(command) {
  const normalized = text(command);
  let args;
  if (normalized === STEPHANOS_NATIVE_VERIFY_COMMAND) {
    args = [STEPHANOS_NATIVE_VERIFY_SCRIPT];
  } else {
    const match = NODE_TEST.exec(normalized);
    if (!match) return Object.freeze({ ok: false, reason: 'STEPHANOS_NATIVE_TEST_COMMAND_NOT_ALLOWLISTED', command: normalized, args: Object.freeze([]), testId: '' });
    const paths = match[1].split(' ').map(nativeFocusedSourcePath).filter(Boolean);
    if (!paths.length || paths.length !== match[1].split(' ').length) return Object.freeze({ ok: false, reason: 'STEPHANOS_NATIVE_TEST_PATH_INVALID', command: normalized, args: Object.freeze([]), testId: '' });
    args = ['--test', ...paths];
  }
  return Object.freeze({
    ok: true, reason: 'STEPHANOS_NATIVE_TEST_COMMAND_ALLOWED', command: normalized,
    args: Object.freeze(args),
    testId: `test-${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`,
  });
}

export function nativeVerifyPackageContractMatches(packageJson, sourceFile) {
  const scripts = packageJson?.scripts;
  const source = text(sourceFile).toLowerCase();
  return source !== 'package.json' && source !== STEPHANOS_NATIVE_VERIFY_SCRIPT
    && scripts?.['stephanos:verify'] === `node ${STEPHANOS_NATIVE_VERIFY_SCRIPT}`
    && !Object.hasOwn(scripts, 'prestephanos:verify')
    && !Object.hasOwn(scripts, 'poststephanos:verify');
}
