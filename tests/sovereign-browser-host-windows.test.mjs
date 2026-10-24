import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readNativeBrowserObservation } from '../scripts/sovereign-commander-browser-observe.mjs';

const exe = process.env.STEPHANOS_BROWSER_WITNESS_HOST_EXE;
const schema='stephanos.browser-native-message.v1';
async function exchange(messages) {
  const child=spawn(exe,[],{stdio:['pipe','pipe','pipe']});
  let data=Buffer.alloc(0), errors='';
  child.stdout.on('data',chunk=>{data=Buffer.concat([data,chunk]);});
  child.stderr.on('data',chunk=>{errors+=chunk.toString();});
  for(const message of messages) {
    const bytes=Buffer.from(JSON.stringify(message),'utf8');
    const prefix=Buffer.alloc(4);prefix.writeUInt32LE(bytes.length,0);
    child.stdin.write(Buffer.concat([prefix,bytes]));
  }
  child.stdin.end();
  const exit=await new Promise((resolve,reject)=>{
    child.on('error',reject);child.on('close',resolve);
  });
  assert.equal(exit,0,errors.slice(0,500));
  const replies=[];let off=0;
  while(off+4<=data.length) {
    const len=data.readUInt32LE(off);off+=4;
    assert.ok(len>0 && len<1000000);
    assert.ok(off+len<=data.length);
    replies.push(JSON.parse(data.subarray(off,off+len).toString('utf8'))); off+=len;
  }
  assert.equal(off,data.length);
  return replies;
}
test('Windows native host binary framed config and receipt', { skip:!exe }, async()=>{
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]);
  const metrics={readyState:'complete',imageCount:3,brokenImages:1,unloadedImages:0,linkCount:5,emptyLinks:0,genericSpotifyLinks:1,buttonCount:1,disabledButtonCount:0,headingCount:1};
  const requests=[
    {schemaVersion:schema,action:'config'},
    {schemaVersion:schema,action:'record',mode:'capture',snapshots:[{origin:'https://unauthorised.example',active:true,metrics,screenshot:'data:image/jpeg;base64,'+jpeg.toString('base64')}]},
    {schemaVersion:schema,action:'record',mode:'capture',snapshots:[{origin:'http://localhost:4173',active:true,metrics,screenshot:'data:image/jpeg;base64,'+jpeg.toString('base64')}]}
  ];
  const replies=await exchange(requests);
  assert.equal(replies.length,3);
  assert.equal(replies[0].ok,true);
  assert.deepEqual(replies[0].allowedOrigins,['http://localhost:4173']);
  assert.equal(replies[1].ok,false);
  assert.equal(replies[1].blocker,'NATIVE_ORIGIN_NOT_ALLOWED');
  assert.equal(replies[2].ok,true);
  const receiptRoot=join(dirname(exe),'receipts');
  const found=await readdir(receiptRoot);
  assert.equal(found.filter(f=>f.endsWith('.jpg')).length,1);
  const receipt=JSON.parse(await readFile(join(receiptRoot,found.find(f=>f.endsWith('.json'))),'utf8'));
  assert.equal(receipt.observations[0].metrics.brokenImages,1);
  assert.equal(receipt.observations[0].metrics.genericSpotifyLinks,1);
  assert.equal(receipt.observedTabCount,1);
  const truth=await readNativeBrowserObservation({nativeReceiptRoot:receiptRoot});
  assert.equal(truth.ok,true);
  assert.equal(truth.finalVerdict,'BROWSER_OBSERVATION_CAPTURED');
  assert.equal(truth.functionalAcceptanceVerified,false);
});
