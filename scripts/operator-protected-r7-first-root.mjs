import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildR7OwnerSourceReadbackInput, createR7ProtectedOwnerSourceReadback,
  heldR7OwnerSourceReadback, R7_OWNER_SOURCE_JOB, R7_OWNER_PEER_PREPARE_JOB } from '../shared/agents/r7ProtectedOwnerSourceReadbackV1.mjs';
import { createR7ProtectedOwnerEnvelopeIssuer } from '../shared/agents/r7ProtectedOwnerEnvelopeIssuerV1.mjs';

// Proposed fixed hosted-runner adapter. Source preparation does not deploy this
// workflow or adopt its peer-enrollment policy. No Windows/SCM/root/lease operation
// exists here. Native signature/OS verification is independent of this producer.
const EVENT_MAX_BYTES=262144;
const RUNTIME_FIELDS=Object.freeze(['GITHUB_ACTIONS','RUNNER_ENVIRONMENT','RUNNER_OS','RUNNER_ARCH','GITHUB_JOB',
  'GITHUB_EVENT_NAME','GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_REPOSITORY_OWNER_ID',
  'GITHUB_ACTOR','GITHUB_ACTOR_ID','GITHUB_TRIGGERING_ACTOR','GITHUB_REF','GITHUB_REF_TYPE',
  'GITHUB_WORKFLOW_REF','GITHUB_WORKFLOW_SHA','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT',
  'GITHUB_SERVER_URL','GITHUB_API_URL']);
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const same=(before,after)=>before.isFile()&&after.isFile()&&before.dev===after.dev&&before.ino===after.ino
  &&before.nlink===1&&after.nlink===1&&before.size===after.size
  &&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs;

async function readProviderEvent() {
  const file=process.env.GITHUB_EVENT_PATH;
  if(typeof file!=='string'||!isAbsolute(file))fail('R7_OWNER_EVENT_FILE_UNSAFE');
  const named=await lstat(file);
  if(!named.isFile()||named.isSymbolicLink()||named.nlink!==1||named.size<2||named.size>EVENT_MAX_BYTES)
    fail('R7_OWNER_EVENT_FILE_UNSAFE');
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const initial=await handle.stat();
    if(!same(named,initial))fail('R7_OWNER_EVENT_FILE_CHANGED');
    const buffer=Buffer.alloc(initial.size+1);
    let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);
      if(bytesRead===0)break;length+=bytesRead;}
    if(length!==initial.size||length>EVENT_MAX_BYTES)fail('R7_OWNER_EVENT_FILE_BOUND');
    const final=await handle.stat(),renamed=await lstat(file);
    if(!same(initial,final)||!same(final,renamed)||renamed.isSymbolicLink())fail('R7_OWNER_EVENT_FILE_CHANGED');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length)));
  } finally { await handle.close(); }
}

async function persistEncryptedEnvelope(envelope,expectedDigest) {
  const directory=process.env.RUNNER_TEMP;
  if(typeof directory!=='string'||!isAbsolute(directory)||await realpath(directory)!==directory)
    fail('R7_OWNER_OUTPUT_DIRECTORY');
  const before=await lstat(directory);
  if(!before.isDirectory()||before.isSymbolicLink())fail('R7_OWNER_OUTPUT_DIRECTORY');
  const path=join(directory,'r7-first-root-owner-envelope.jwe');
  const file=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  try {
    const bytes=Buffer.from(envelope,'ascii');
    await file.writeFile(bytes);await file.sync();
    const actual=await file.stat(),named=await lstat(path),parent=await lstat(directory);
    if(!same(actual,named)||actual.size!==bytes.length||(actual.mode&0o777)!==0o600
      ||before.dev!==parent.dev||before.ino!==parent.ino)fail('R7_OWNER_OUTPUT_IDENTITY');
    const read=Buffer.alloc(bytes.length+1);let count=0;
    while(count<read.length){const part=await file.read(read,count,read.length-count,count);if(!part.bytesRead)break;count+=part.bytesRead;}
    if(count!==bytes.length||createHash('sha256').update(read.subarray(0,count)).digest('hex')!==expectedDigest
      ||!same(actual,await file.stat())||!same(actual,await lstat(path)))fail('R7_OWNER_OUTPUT_READBACK');
  } finally {await file.close();}
}

export async function runR7OwnerSourceReadbackCli() {
  try {
    const operation=process.argv[2],preparing=operation==='prepare-peer';
    if(process.argv.length!==3||!['prepare-peer','issue-owner-envelope'].includes(operation))fail('R7_OWNER_SCRIPT_OPERATION');
    if(process.platform!=='linux'||process.arch!=='x64'
      ||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'
      ||process.env.RUNNER_OS!=='Linux'||process.env.RUNNER_ARCH!=='X64'
      ||process.env.GITHUB_JOB!==(preparing?R7_OWNER_PEER_PREPARE_JOB:R7_OWNER_SOURCE_JOB))fail('R7_OWNER_SCRIPT_RUNNER_CONTEXT');
    const runtime=Object.fromEntries(RUNTIME_FIELDS.filter(key=>Object.hasOwn(process.env,key))
      .map(key=>[key,process.env[key]]));
    // Read-only preparation must never have provider-producing permission.
    if(preparing&&(Object.hasOwn(process.env,'ACTIONS_ID_TOKEN_REQUEST_TOKEN')
      ||Object.hasOwn(process.env,'ACTIONS_ID_TOKEN_REQUEST_URL')))
      fail('R7_SOURCE_ONLY_JOB_OIDC_PERMISSION_FORBIDDEN');
    const event=await readProviderEvent();
    const wire=buildR7OwnerSourceReadbackInput(event,runtime);
    const nativeWindowWire=JSON.stringify({IssuedAtUtc:event.inputs.r7_native_challenge_issued_at_utc,
      ExpiresAtUtc:event.inputs.r7_native_challenge_expires_at_utc});
    if(preparing)return await createR7ProtectedOwnerSourceReadback({githubReadToken:process.env.GH_TOKEN})
      .preparePeer(wire,nativeWindowWire);
    const result=await createR7ProtectedOwnerEnvelopeIssuer({githubReadToken:process.env.GH_TOKEN,
      runnerBrokerContext:()=>({requestUrl:process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
        requestToken:process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN})}).issue(wire,nativeWindowWire);
    const {envelope,...publicResult}=result;
    if(result.classification!=='R7_OWNER_ENCRYPTED_ENVELOPE_PREPARED_NATIVE_VERIFICATION_REQUIRED')return publicResult;
    await persistEncryptedEnvelope(envelope,result.envelopeSha256);
    return {...publicResult,encryptedEnvelopePersisted:true};
  } catch(error) {
    return heldR7OwnerSourceReadback(error instanceof Error && Object.hasOwn(error,'code')
      ? error.code : 'R7_OWNER_SOURCE_CLI_FAILED');
  }
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const output=await runR7OwnerSourceReadbackCli();
  process.stdout.write(JSON.stringify(output)+'\n');
  if(!['R7_OWNER_PEER_PREPARED_EXPLICIT_ENROLLMENT_REQUIRED',
    'R7_OWNER_ENCRYPTED_ENVELOPE_PREPARED_NATIVE_VERIFICATION_REQUIRED'].includes(output.classification))process.exitCode=1;
}
