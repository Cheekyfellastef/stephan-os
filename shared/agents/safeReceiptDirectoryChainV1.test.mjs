import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureSafeReceiptDirectoryChainSync } from './safeReceiptDirectoryChainV1.mjs';

test('safe receipt directory chain creates and rechecks ordinary directories', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'safe-receipt-chain-'));
  const target = path.join(root, 'workspace', 'receipts', 'route');
  const proof = ensureSafeReceiptDirectoryChainSync(target, { create: true });
  assert.equal(proof.directory, path.resolve(target));
  assert.equal(proof.recheck(), true);
});

test('safe receipt directory chain rejects a linked ancestor', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'unsafe-receipt-chain-'));
  const victim = path.join(root, 'victim');
  mkdirSync(victim);
  mkdirSync(path.join(root, 'workspace'));
  symlinkSync(victim, path.join(root, 'workspace', 'receipts'), 'dir');
  assert.throws(
    () => ensureSafeReceiptDirectoryChainSync(path.join(root, 'workspace', 'receipts', 'route'), { create: true }),
    /RECEIPT_LINKED_ANCESTOR/,
  );
});

test('safe receipt directory chain detects an ancestor identity swap on recheck', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'changed-receipt-chain-'));
  const target = path.join(root, 'workspace', 'receipts');
  let changed = false;
  const proof = ensureSafeReceiptDirectoryChainSync(target, {
    create: true,
    lstatFn(pathname) {
      const info = lstatSync(pathname);
      if (!changed || pathname !== path.resolve(root, 'workspace')) return info;
      return new Proxy(info, {
        get(targetInfo, property) {
          if (property === 'ino') return Number(targetInfo.ino) + 1;
          const value = Reflect.get(targetInfo, property);
          return typeof value === 'function' ? value.bind(targetInfo) : value;
        },
      });
    },
  });
  changed = true;
  assert.throws(() => proof.recheck(), /RECEIPT_ANCESTOR_IDENTITY_CHANGED/);
});
