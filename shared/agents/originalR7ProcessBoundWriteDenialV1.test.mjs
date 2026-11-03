import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../src/windows/', import.meta.url);
const source = await readFile(new URL('Stephanos.OriginalR7DaclReadback/R7ProcessBoundWriteDenial.cs', root), 'utf8');
const host = await readFile(new URL('Stephanos.OriginalR7CustodyWitness/Program.cs', root), 'utf8');
const tests = await readFile(new URL('Stephanos.OriginalR7DaclReadback.Tests/Program.cs', root), 'utf8');

test('process-bound adapter retains process object and rechecks primary token before returning access facts', () => {
  assert.match(source, /using SafeProcessHandle process = OpenProcess/);
  assert.match(source, /created == expected/);
  assert.match(source, /WaitForSingleObject\(process, 0\) == WaitTimeout/);
  assert.match(source, /identity\.User\.Equals\(expected\)/);
  assert.match(source, /R7EffectiveWriteDenial\.Observe\(/);
  assert.match(source, /before != ReadStamp\(token\) \|\| before != ReadStamp\(current\)/);
  assert.match(source, /R7_PROCESS_EXITED_OR_CHANGED_DURING_PROBE/);
  assert.match(source, /ulong ModifiedId, uint GroupCount, uint PrivilegeCount, string PrivilegeDigest/);
  assert.match(source, /SHA256\.HashData\(privileges\)/);
  assert.match(source, /size != 4 \+ count \* 12/);
  assert.match(source, /QueryAndDuplicateToken = 0x000a/);
  assert.doesNotMatch(source, /0x000e/);
  assert.match(tests, /ProcessBoundWriteDenialTests\.Run\(\)/);
});

test('native adapter grants no shell, process mutation, token editing, signer or lease authority', () => {
  for (const flag of ['OriginalPrincipalProvenanceAuthenticated', 'AuthenticatedOsWitness',
    'ContainmentRemainsEnforced', 'LeaseReleaseAuthorized', 'SourceMutationAuthorized',
    'HistoricalReceiptReconstructed']) assert.match(source, new RegExp(`${flag} => false`));
  assert.doesNotMatch(source, /\b(?:Process\.Start|CreateProcess|TerminateProcess|AdjustTokenPrivileges|CreateRestrictedToken|SetTokenInformation|SetAccessControl|WriteAllText|SignData|SignHash|HttpListener|NamedPipeServerStream)\b/);
  assert.match(host, /throw new InvalidOperationException\("WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED"\)/);
});
