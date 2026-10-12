import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CORE_LOCK_SCHEMA, exactCoreLockOwnerV1 as owns } from './stephanosCoreLockOwnerV1.mjs';

const HEAD='a'.repeat(40), OTHER='b'.repeat(40);
const owned=Object.freeze({
  schemaVersion:CORE_LOCK_SCHEMA,pid:4102,sourceHead:HEAD,
  startedAtUtc:'2026-10-12T20:12:34.123Z',
});
const expected=Object.freeze({
  pid:owned.pid,sourceHead:owned.sourceHead,startedAtUtc:owned.startedAtUtc,
});
test('only exact PID, source and startup instant prove Core lock custody',()=>{
  assert.equal(owns(owned,expected),true);
  for(const corrupted of [
    null,{},[],{...owned,schemaVersion:'forged'},
    {...owned,pid:4103},{...owned,pid:0},{...owned,pid:-1},
    {...owned,sourceHead:OTHER},{...owned,sourceHead:'not-a-sha'},
    {...owned,startedAtUtc:'2026-10-12T20:12:35.123Z'},
    {...owned,startedAtUtc:'garbled'},{...owned,startedAtUtc:'2026-10-12T20:12:34.123+00:00'},
  ]) assert.equal(owns(corrupted,expected),false,JSON.stringify(corrupted));
});
test('PID reuse and source rollovers cannot steal original Core lock',()=>{
  assert.equal(owns(owned,{...expected,pid:4103}),false);
  assert.equal(owns(owned,{...expected,sourceHead:OTHER}),false);
  assert.equal(owns(owned,{...expected,startedAtUtc:'2026-10-12T21:12:34.123Z'}),false);
});
test('Core acquisition and release stay fail-closed when lock owner changed',async()=>{
  const code=await readFile(new URL('../../scripts/stephanos-core-daemon.mjs',import.meta.url),'utf8');
  assert.match(code,/import \{ CORE_LOCK_SCHEMA, exactCoreLockOwnerV1 \}/);
  assert.match(code,/if \(!\(await readExactCurrentLock\(identity\)\)\)/);
  assert.match(code,/if \(!\(await readExactCurrentLock\(ownedLock\.identity\)\)\)/);
  assert.match(code,/STEPHANOS_CORE_OWNER_LOCK_CHANGED_HELD/);
  assert.match(code,/if \(await readExactCurrentLock\(ownedLock\.identity\)\) \{/);
  assert.doesNotMatch(code,/if \(Number\(current\?\.pid\) === process\.pid\) await unlink\(lockPath\)/);
  assert.doesNotMatch(code,/let stale = true/);
  const acquire = code.slice(code.indexOf('async function acquireSingleInstance'),code.indexOf('async function probe'));
  assert.match(acquire,/if \(error\?\.code === 'EEXIST'\) return null/);
  assert.doesNotMatch(acquire,/unlink\(lockPath\)|rename\(lockPath/);
  assert.doesNotMatch(acquire,/processAlive|dead-owner|stale.*unlink/i);
  assert.match(code,/return Object\.freeze\(\{ handle, identity \}\)/);
});
