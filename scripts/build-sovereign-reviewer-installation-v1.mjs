#!/usr/bin/env node
// Produces reviewable immutable SOURCE, never installs, elevates, enrolls or
// claims operator consent. The whole emitted artifact hash needs approval at
// the existing attended installation boundary after protected main admission.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOVEREIGN_REVIEWER_PROFILE_FILES_V1, SOVEREIGN_REVIEWER_DATA_ROOT_V1 }
  from '../shared/agents/sovereignInstalledReviewerProfileV1.mjs';
import { resolveBattleBridgeGitExecution, validateBattleBridgeLocalGitConfiguration }
  from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
const hash=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
export function buildReviewerInstallationSourceV1({expectedMain, root=SOVEREIGN_REVIEWER_DATA_ROOT_V1,
  git=resolveBattleBridgeGitExecution(), run=spawnSync}={}) {
  if(!/^[a-f0-9]{40}$/.test(expectedMain??''))throw Error('REVIEWER_INSTALL_EXACT_MAIN_REQUIRED');
  const read=(args)=>{
    const r=run(git.executable,[...git.fixedConfigArgs,'-C',root,...args],
      {shell:false,windowsHide:true,timeout:12000,maxBuffer:2097152,env:git.environment});
    if(r.error||r.status!==0||!Buffer.isBuffer(r.stdout))throw Error('REVIEWER_INSTALL_GIT_READ_UNPROVEN');
    return r.stdout;
  };
  if(!validateBattleBridgeLocalGitConfiguration(read(['config','--local','--null','--list','--no-includes']).toString()).ok)
    throw Error('REVIEWER_INSTALL_GIT_CONFIGURATION_UNSAFE');
  if(read(['rev-parse','--verify','refs/remotes/origin/main']).toString().trim()!==expectedMain)
    throw Error('REVIEWER_INSTALL_CURRENT_MAIN_MISMATCH');
  const objects=new Map();
  const object=(type,sha)=>{
    const key=type+':'+sha;if(objects.has(key))return objects.get(key);
    if(!/^[a-f0-9]{40}$/.test(sha))throw Error('REVIEWER_INSTALL_OBJECT_ID_INVALID');
    const bytes=read(['cat-file',type,sha]);
    if(hash('sha1',Buffer.concat([Buffer.from(type+' '+bytes.length+'\0'),bytes]))!==sha)
      throw Error('REVIEWER_INSTALL_OBJECT_HASH_MISMATCH');
    objects.set(key,bytes);return bytes;
  };
  const commit=object('commit',expectedMain);
  const tree=/^tree ([a-f0-9]{40})\n/.exec(commit.toString('utf8'))?.[1];
  if(!tree)throw Error('REVIEWER_INSTALL_TREE_INVALID');
  const blob=(path)=>{
    let sha=tree;const parts=path.split('/');
    for(let depth=0;depth<parts.length;depth++) {
      const bytes=object('tree',sha);let found;const names=new Set();
      for(let i=0;i<bytes.length;) {
        const space=bytes.indexOf(32,i),nul=bytes.indexOf(0,space+1);
        if(space<i||nul<space||nul+21>bytes.length)throw Error('REVIEWER_INSTALL_TREE_INVALID');
        const mode=bytes.toString('ascii',i,space),raw=bytes.subarray(space+1,nul),name=raw.toString('utf8');
        if(!Buffer.from(name).equals(raw)||!name||/[\\/\0]/.test(name)||names.has(name))
          throw Error('REVIEWER_INSTALL_TREE_AMBIGUOUS');
        names.add(name);
        if(name===parts[depth])found={mode,sha:bytes.subarray(nul+1,nul+21).toString('hex')};
        i=nul+21;
      }
      if(!found||(depth===parts.length-1?!['100644','100755'].includes(found.mode):found.mode!=='40000'))
        throw Error('REVIEWER_INSTALL_SOURCE_MEMBER_UNPROVEN');
      sha=found.sha;
    }
    return{sha,bytes:object('blob',sha)};
  };
  let total=0;
  const records=SOVEREIGN_REVIEWER_PROFILE_FILES_V1.map(Path=>{
    const {sha,bytes}=blob(Path);total+=bytes.length;
    if(bytes.length>2097152||total>4194304)throw Error('REVIEWER_INSTALL_SOURCE_UNBOUNDED');
    return{Path,GitBlobSha1:sha,Sha256:hash('sha256',bytes),ContentBase64:bytes.toString('base64')};
  });
  const installer=records.find(r=>r.Path==='scripts/windows/install-sovereign-reviewer-profile-v1.ps1');
  const payload={SchemaVersion:'stephanos.reviewer-install-source.v1',SourceHead:expectedMain,
    SourceTree:tree,Records:records};
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64');
  const script="# REVIEWABLE SOURCE ONLY. Run only through the existing attended installation gate.\n"
    +"param([Parameter(Mandatory=$true)][string]$ReviewerSid,[string]$ExpectedInstalledHead='')\n"
    +"$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None'\n"
    +"Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop\n"
    +"$script:SovereignReviewerInstallerSourceV1=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+encoded+"'))|ConvertFrom-Json)\n"
    +"$body=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+installer.ContentBase64+"'))\n"
    +"& ([ScriptBlock]::Create($body)) -ExpectedMain '"+expectedMain+"' -ReviewerSid $ReviewerSid -ExpectedInstalledHead $ExpectedInstalledHead\n";
  return Object.freeze({sourceHead:expectedMain,sourceTree:tree,artifactSha256:hash('sha256',script),
    sourceFileCount:records.length,script,installationPerformed:false,qualified:false});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==4||process.argv[2]!=='--expected-main')throw Error('REVIEWER_INSTALL_FIXED_ARGUMENTS_REQUIRED');
  const result=buildReviewerInstallationSourceV1({expectedMain:process.argv[3]});
  const output=join(tmpdir(),'stephanos-reviewer-install-'+result.sourceHead+'.ps1');
  writeFileSync(output,result.script,{flag:'wx',mode:0o600});
  process.stdout.write(JSON.stringify({...result,script:undefined,output})+'\n');
}
