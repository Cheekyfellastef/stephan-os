import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function pathIdentity(info) {
  return `${String(info.dev)}:${String(info.ino)}:${String(info.mode)}`;
}

function directoryChain(directory) {
  const chain = [];
  let cursor = path.resolve(directory);
  while (true) {
    chain.unshift(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return chain;
}

function sameCanonicalPath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function inspectDirectory(pathname, {
  lstatFn,
  realpathFn,
  linkedBlocker,
  missingBlocker,
} = {}) {
  let info;
  try {
    info = lstatFn(pathname);
  } catch (error) {
    if (error?.code === 'ENOENT') throw codedError(missingBlocker);
    throw codedError(linkedBlocker);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw codedError(linkedBlocker);
  let canonical;
  try {
    canonical = realpathFn(pathname);
  } catch {
    throw codedError(linkedBlocker);
  }
  if (!sameCanonicalPath(canonical, pathname)) throw codedError(linkedBlocker);
  return Object.freeze({ pathname, identity: pathIdentity(info) });
}

function inspectExistingDirectoryChain(directory, options) {
  const observations = [];
  for (const pathname of directoryChain(directory)) {
    try {
      observations.push(inspectDirectory(pathname, options));
    } catch (error) {
      if (error?.code === options.missingBlocker) continue;
      throw error;
    }
  }
  return observations;
}

export function ensureSafeReceiptDirectoryChainSync(directory, {
  create = false,
  lstatFn = lstatSync,
  mkdirFn = mkdirSync,
  realpathFn = realpathSync,
  linkedBlocker = 'RECEIPT_LINKED_ANCESTOR',
  changedBlocker = 'RECEIPT_ANCESTOR_IDENTITY_CHANGED',
  missingBlocker = 'RECEIPT_DIRECTORY_MISSING',
} = {}) {
  const resolved = path.resolve(String(directory || ''));
  if (!directory || resolved === path.parse(resolved).root) throw codedError(linkedBlocker);
  const options = { lstatFn, realpathFn, linkedBlocker, missingBlocker };
  const before = inspectExistingDirectoryChain(resolved, options);
  if (create) {
    try {
      mkdirFn(resolved, { recursive: true });
    } catch {
      throw codedError(linkedBlocker);
    }
  }
  const after = directoryChain(resolved).map((pathname) => inspectDirectory(pathname, options));
  const afterByPath = new Map(after.map((entry) => [entry.pathname, entry.identity]));
  for (const entry of before) {
    if (afterByPath.get(entry.pathname) !== entry.identity) throw codedError(changedBlocker);
  }
  const baseline = new Map(after.map((entry) => [entry.pathname, entry.identity]));
  const recheck = () => {
    for (const pathname of directoryChain(resolved)) {
      const current = inspectDirectory(pathname, options);
      if (baseline.get(pathname) !== current.identity) throw codedError(changedBlocker);
    }
    return true;
  };
  return Object.freeze({ directory: resolved, recheck });
}
