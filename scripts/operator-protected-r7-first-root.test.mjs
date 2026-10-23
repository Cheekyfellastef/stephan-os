import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildR7NativeOwnerPeerPairing } from '../shared/agents/r7NativeOwnerPeerPairingV1.mjs';
import { R7_FIRST_ROOT_INTAKE_AUDIENCE, R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE,
  R7_INACTIVE_ROOT_PROVISIONING_PURPOSE } from '../shared/agents/r7FirstRootOwnerIntakeProposalV1.mjs';
const workflow=readFileSync(new URL('../docs/architecture/r7-protected-owner-workflow-proposal.yml.txt',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const activeWorkflow=readFileSync(new URL('../.github/workflows/operator-merge-approval-gate.yml',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const script=readFileSync(new URL('./operator-protected-r7-first-root.mjs',import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const entries=[...workflow.matchAll(/^  ([a-z0-9-]+):\n/gm)];
function job(name){const index=entries.findIndex(row=>row[1]===name);assert.ok(index>=0,name);
  return workflow.slice(entries[index].index,entries[index+1]?.index??workflow.length)
    .replace(/\n  # Proposed purpose-bound policy:[\s\S]*$/,'').trimEnd()+'\n';}

test('R7 issuer proposal stays inactive across the read-only merge-check prerequisite',()=>{
  assert.match(workflow,/^# INACTIVE SOURCE PROPOSAL:/);
  const readOnlyCheckStep=[
    '      - name: Check exact source readiness before requesting protected approval',
    "        if: ${{ inputs.mode == 'user-owned-protected-squash' }}",
    '        shell: bash',
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    '          STEPHANOS_AUTHORIZATION_COMMENT_ID: ${{ steps.authorization.outputs.authorization_comment_id }}',
    '          STEPHANOS_AUTHORIZATION_COMMENT_SHA256: ${{ steps.authorization.outputs.authorization_comment_sha256 }}',
    '        run: node scripts/operator-protected-personal-repository-merge.mjs preflight',
    '', '',
  ].join('\n');
  // Permit only this exact non-authority step; retain the prior byte identity
  // for every original job, credential, permission, operation and boundary.
  // A duplicate, relocated or modified step cannot satisfy the old digest.
  const stepAnchor='      - name: Collect exact personal-repository evidence after protected admission';
  const originalWorkflow=activeWorkflow.replace(readOnlyCheckStep+stepAnchor,stepAnchor);
  // Independently read from protected main a770bdff, not from this working tree.
  assert.equal(sha(originalWorkflow),'77e0efd38305fdeff4b403b2b537849d47e59225244481fae794ac5b615bc468');
  assert.deepEqual([...activeWorkflow.matchAll(/^  ([a-z0-9-]+):\n/gm)].map(row=>row[1]),
    ['merge-group-evidence','operator-merge-queue-boundary','personal-repository-evidence',
      'operator-personal-repository-approval','operator-personal-repository-squash-merge']);
  assert.doesNotMatch(activeWorkflow,/r7-first-root|r7_owner_permit_json|id-token:/);
});

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

test('the actual owner summary names the exact native operation and rejects aliased approval purposes',()=>{
  const source=job('r7-first-root-peer-evidence').match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/)[1]
    .split('\n').map(line=>line.replace(/^          /,'')).join('\n');
  const f=JSON.parse(readFileSync(new URL('../shared/agents/r7NativeOwnerPeerPairingV1.fixture.json',import.meta.url),'utf8'));
  const pairs=[buildR7NativeOwnerPeerPairing(f.challenge,f.context),
    buildR7NativeOwnerPeerPairing({...f.challenge,Audience:f.challenge.Audience.replace(R7_FIRST_ROOT_INTAKE_AUDIENCE,
      R7_INACTIVE_ROOT_PROVISIONING_AUDIENCE)},f.context)];
  const dir=mkdtempSync(join(tmpdir(),'r7-owner-summary-'));
  try {
    const output=join(dir,'summary.md');
    for(const p of pairs){
      const valid={classification:'R7_OWNER_PEER_PREPARED_EXPLICIT_ENROLLMENT_REQUIRED',
        nativeOperationPurpose:p.values.purpose,peerBindingFingerprint:p.fingerprint,
        peerApprovalComment:p.approvalComment,nativeChallengeExpiresAtUtc:p.values.nativeExpiresAtUtc};
      for(const [changes,accepted] of [[{},true],[{nativeOperationPurpose:'PROVISION_ALL_ROOTS'},false],
        [{peerApprovalComment:'approved'},false],[{peerApprovalComment:p.approvalComment+' '},false],
        [{nativeOperationPurpose:pairs.find(other=>other!==p).values.purpose},false]]){
        rmSync(output,{force:true});
        writeFileSync(join(dir,'r7-first-root-peer-evidence.json'),JSON.stringify({...valid,...changes}));
        const child=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:10000,
          env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,RUNNER_TEMP:dir,GITHUB_STEP_SUMMARY:output}});
        if(!accepted){assert.notEqual(child.status,0);assert.equal(existsSync(output),false);continue;}
        assert.equal(child.status,0,child.stderr);
        const summary=readFileSync(output,'utf8');
        assert.ok(summary.includes('Exact purpose: `'+p.values.purpose+'`'));
        assert.ok(summary.includes('Required approval comment: `'+p.approvalComment+'`'));
        assert.match(summary,/cannot activate signing services, prove custody, or release r7/);
        if(p.values.purpose===R7_INACTIVE_ROOT_PROVISIONING_PURPOSE)
          assert.match(summary,/two fixed inactive R7 signing roots\. This candidate creates no keys; actual native creation custody remains required/);
        else assert.match(summary,/one ephemeral endpoint for owner-policy authentication only/);
      }
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
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
