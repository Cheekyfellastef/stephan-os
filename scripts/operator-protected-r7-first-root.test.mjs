import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const workflow=readFileSync(new URL('../.github/workflows/operator-merge-approval-gate.yml',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const script=readFileSync(new URL('./operator-protected-r7-first-root.mjs',import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const entries=[...workflow.matchAll(/^  ([a-z0-9-]+):\n/gm)];
function job(name){const index=entries.findIndex(row=>row[1]===name);assert.ok(index>=0,name);
  return workflow.slice(entries[index].index,entries[index+1]?.index??workflow.length)
    .replace(/\n  # Proposed purpose-bound policy:[\s\S]*$/,'').trimEnd()+'\n';}

// Immutable 9bd source baselines, independently read from Git before this test
// was authored. Check actual legacy bodies after reversing only the scoped new
// mode exclusion, not expected values computed from the changed workflow.
test('preserves all five existing protected/merge jobs apart from excluding the exact new mode',()=>{
  const expected={
    'merge-group-evidence':'e58260276ae77abfe4d4e35e2e4745297502c3703ec356ebd657b0a74518da49',
    'operator-merge-queue-boundary':'3aa654f36698309f8987f47a4d5b77b650ec69df9a86bfd869ee0e2125c3a808',
    'personal-repository-evidence':'a6bdcec331dc5cc839192d20e209192755412de52e50f7381aa30c8d3c00ebbc',
    'operator-personal-repository-approval':'6cc58de3b935a3d86b3d3bd6b8def716177ea85c09baab0455673d5d9a70298a',
    'operator-personal-repository-squash-merge':'231f0d5eec3d7435506acbdd24c7752b586f2be2fded9cf7201e141d23df81ad',
  };
  for(const [name,digest] of Object.entries(expected))assert.equal(sha(job(name)
    .replace(" && inputs.mode != 'user-owned-r7-first-root-policy-intake'",'')),digest,name);
  assert.equal(entries.length,7);assert.match(workflow,/^permissions: \{\}$/m);
  assert.match(workflow,/^  cancel-in-progress: false$/m);
});

test('separates read-only pairing from the exact purpose protected producer without legacy permission changes',()=>{
  const preparation=job('r7-first-root-peer-evidence'),issuer=job('r7-first-root-owner-intake');
  assert.doesNotMatch(preparation,/^    environment:|id-token:|issue-owner-envelope/m);
  assert.match(preparation,/prepare-peer/);assert.match(preparation,/GITHUB_STEP_SUMMARY/);
  assert.match(issuer,/needs: \[r7-first-root-peer-evidence\]/);
  assert.match(issuer,/needs\.r7-first-root-peer-evidence\.result == 'success'/);
  assert.match(issuer,/^      name: operator-merge-approval$/m);
  assert.match(issuer,/^      id-token: write$/m);assert.match(issuer,/issue-owner-envelope/);
  assert.equal((workflow.match(/id-token: write/g)||[]).length,1);
  assert.equal((workflow.match(/r7_native_challenge_issued_at_utc:/g)||[]).length,1);
  assert.equal((workflow.match(/r7_native_challenge_expires_at_utc:/g)||[]).length,1);
  assert.doesNotMatch(preparation+issuer,/gh pr merge|gh api|curl |powershell|r7.*(?:release|renew).*\.mjs/);
  const pins=[...((preparation+issuer).matchAll(/uses: ([^\s]+)@([^\s]+)/g))];
  assert.equal(pins.length,6);for(const [,action,ref] of pins){assert.match(action,/^actions\//);assert.match(ref,/^[a-f0-9]{40}$/);}
  assert.equal((preparation+issuer).match(/node-version: '24\.21\.0'/g).length,2);
});

test('wrapper holds before reading events or making network requests outside its fixed hosted job',()=>{
  const path=new URL('./operator-protected-r7-first-root.mjs',import.meta.url);
  for(const mode of ['unknown','prepare-peer','issue-owner-envelope']){
    const child=spawnSync(process.execPath,[fileURLToPath(path),mode],
      {env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},encoding:'utf8',timeout:10000});
    assert.equal(child.status,1,child.stderr);const proof=JSON.parse(child.stdout);
    assert.equal(proof.classification,'R7_PROTECTED_OWNER_SOURCE_READBACK_HELD');
    assert.equal(proof.canonicalLeaseReleaseAuthorized,false);assert.equal(proof.tokenIssuanceAuthorized,false);
    assert.equal(Object.hasOwn(proof,'envelope'),false);
  }
});

test('CLI source maps public context separately, writes ciphertext create-new and never emits the credential',()=>{
  const publicFields=script.match(/const RUNTIME_FIELDS=Object\.freeze\(\[([\s\S]*?)\]\)/)[1];
  assert.doesNotMatch(publicFields,/ACTIONS_ID_TOKEN/);
  assert.match(script,/constants\.O_EXCL/);assert.match(script,/0o600/);
  assert.match(script,/await file\.sync\(\)/);assert.match(script,/R7_OWNER_OUTPUT_READBACK/);
  assert.match(script,/const \{envelope,\.\.\.publicResult\}=result/);
  assert.match(script,/runnerBrokerContext:\(\)=>/);
  assert.doesNotMatch(script,/setSecret|add-mask|console\.|process\.stdout\.write\(envelope/);
});
