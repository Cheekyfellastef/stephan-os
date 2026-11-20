import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readNativeBrowserObservation, observeSovereignBrowser } from '../scripts/sovereign-commander-browser-observe.mjs';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const time = new Date('2026-10-18T19:30:00.000Z');
async function fixture(root, { stale=false, alteredImage=false, scanOnly=false, validScan=false, changeReceipt, at=time }={}) {
  const stamp=at.toISOString().replace(/[-:.Z]/g,'');
  const img=Buffer.from([0xff,0xd8,0xff,0xd9]);
  const hash=sha(img);
  const imageName=stamp+'-'+hash.slice(0,16)+'.jpg';
  await mkdir(root,{recursive:true});
  await writeFile(join(root,imageName),alteredImage?Buffer.from('tampered'):img);
  const sample={
    schemaVersion:'stephanos.sovereign-browser-observation.v1',
    observedAtUtc:stale?'2026-10-18T18:00:00.000Z':at.toISOString(),
    mechanism:'operator-permissioned-chromium-native-messaging',
    readOnly:true,observationOnly:true,servedHeadVerified:false,functionalAcceptanceVerified:false,
    connectedTabCount:1,admittedTabCount:1,observedTabCount:validScan?0:1,diagnosticTabCount:1,screenshotCount:validScan?0:1,
    scanOnly:validScan||scanOnly,observations:[{originHash:sha('http://localhost:4173').slice(0,16),metrics:{},screenshotSha256:validScan?'':hash}],
    screenshots:validScan?[]:[{ imageName,sha256:hash }]
  };
  const evidenceHash=sha(JSON.stringify(sample));
  const receiptName=stamp+'-'+evidenceHash.slice(0,16)+'.json';
  const receipt={...sample,evidenceHash};
  if(changeReceipt) changeReceipt(receipt);
  await writeFile(join(root,receiptName),JSON.stringify(receipt));
}
for (const [name, changeReceipt] of [
  ['tab counts', receipt => { receipt.diagnosticTabCount=8; }],
  ['observations', receipt => { receipt.observations[0].metrics={brokenImages:42}; }],
  ['timestamp', receipt => { receipt.observedAtUtc='2026-10-18T19:29:00.000Z'; }],
  ['claimed hash', receipt => { receipt.evidenceHash='a'.repeat(64); }],
]) {
  test(`bridge refuses altered ${name} even when image bytes still match`, async()=>{
    const root=await mkdtemp(join(tmpdir(),'stephanos-witness-tamper-'));
    try {
      await fixture(root,{changeReceipt});
      assert.equal(await readNativeBrowserObservation({nativeReceiptRoot:root,now:()=>time}),null);
    } finally {await rm(root,{recursive:true,force:true});}
  });
}
test('bridge accepts only fresh hashed local native screenshot receipts', async () => {
  const root=await mkdtemp(join(tmpdir(),'stephanos-witness-'));
  try {
    await fixture(root);
    const result=await readNativeBrowserObservation({nativeReceiptRoot:root,now:()=>time});
    assert.equal(result.ok,true);
    assert.equal(result.mechanism,'operator-permissioned-chromium-native-messaging');
    const taken=await observeSovereignBrowser({
      nativeReceiptRoot:root,now:()=>time,
      connect:async()=>{throw Error('Should not need debug port if native bridge is ready');}
    });
    assert.equal(taken.finalVerdict,'BROWSER_OBSERVATION_CAPTURED');
    assert.equal(taken.servedHeadVerified,false);
    assert.equal(taken.functionalAcceptanceVerified,false);
  } finally { await rm(root,{recursive:true,force:true}); }
});
test('a valid hashed diagnostic receipt remains distinct from screenshot evidence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'stephanos-witness-scan-'));
  try {
    await fixture(root,{validScan:true});
    const result=await readNativeBrowserObservation({nativeReceiptRoot:root,now:()=>time});
    assert.equal(result.ok,true);
    assert.equal(result.finalVerdict,'BROWSER_OBSERVATION_DIAGNOSTIC');
    assert.equal(result.observedTabCount,0);
    assert.equal(result.screenshotCount,0);
    assert.equal(result.functionalAcceptanceVerified,false);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('default reader discovers isolated browser installs and preserves legacy receipt discovery',async()=>{
  const repo=await mkdtemp(join(tmpdir(),'stephanos-browser-discovery-'));
  try {
    await mkdir(join(repo,'scripts'));
    const script=join(repo,'scripts','sovereign-commander-browser-observe.mjs');
    await copyFile(new URL('../scripts/sovereign-commander-browser-observe.mjs',import.meta.url),script);
    const observer=await import(pathToFileURL(script).href);
    const host=join(repo,'.stephanos','local-state-checkpoints','sovereign-browser-native-host');
    for(const browser of ['chrome','edge','brave','']) {
      const receipts=join(host,browser,'receipts');
      await fixture(receipts);
      assert.equal((await observer.readNativeBrowserObservation({now:()=>time}))?.ok,true,browser||'legacy');
      await rm(receipts,{recursive:true,force:true});
    }
    await fixture(join(host,'edge','receipts'),{at:new Date(time.getTime()-60_000)});
    await fixture(join(host,'brave','receipts'),{validScan:true});
    const latest=await observer.readNativeBrowserObservation({now:()=>time});
    assert.equal(latest?.finalVerdict,'BROWSER_OBSERVATION_DIAGNOSTIC');
    assert.equal(latest?.observedAtUtc,time.toISOString());
  } finally {await rm(repo,{recursive:true,force:true});}
});
for (const option of [{stale:true},{alteredImage:true},{scanOnly:true}]) {
  test('bridge rejects stale, altered or scan-only receipts',async()=>{
    const root=await mkdtemp(join(tmpdir(),'stephanos-witness-negative-'));
    try {await fixture(root,option);
      assert.equal(await readNativeBrowserObservation({nativeReceiptRoot:root,now:()=>time}),null);
    } finally {await rm(root,{recursive:true,force:true});}
  });
}
test('extension has no debugger or permanent all-sites access by default',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../apps/sovereign-browser-bridge/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.manifest_version,3);
  assert.ok(manifest.permissions.includes('nativeMessaging'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(!manifest.permissions.includes('debugger'));
  assert.ok(!manifest.host_permissions);
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  const worker=await readFile(new URL('../apps/sovereign-browser-bridge/service-worker.js',import.meta.url),'utf8');
  assert.match(worker,/permissions\.contains/);
  assert.doesNotMatch(worker,/chrome\.debugger\.|chrome\.cookies\.|chrome\.tabs\.update/);
});
