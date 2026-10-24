import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readNativeBrowserObservation, observeSovereignBrowser } from '../scripts/sovereign-commander-browser-observe.mjs';

const sha = (v) => createHash('sha256').update(v).digest('hex');
const time = new Date('2026-10-18T19:30:00.000Z');
async function fixture(root, { stale=false, alteredImage=false, scanOnly=false }={}) {
  const stamp='20261018T193000000';
  const img=Buffer.from([0xff,0xd8,0xff,0xd9]);
  const hash=sha(img);
  const imageName=stamp+'-'+hash.slice(0,16)+'.jpg';
  const receiptName=stamp+'-'+sha('receipt').slice(0,16)+'.json';
  await mkdir(root,{recursive:true});
  await writeFile(join(root,imageName),alteredImage?Buffer.from('tampered'):img);
  await writeFile(join(root,receiptName),JSON.stringify({
    schemaVersion:'stephanos.sovereign-browser-observation.v1',
    observedAtUtc:stale?'2026-10-18T18:00:00.000Z':time.toISOString(),
    mechanism:'operator-permissioned-chromium-native-messaging',
    readOnly:true,observationOnly:true,servedHeadVerified:false,functionalAcceptanceVerified:false,
    scanOnly,connectedTabCount:2,admittedTabCount:2,observedTabCount:1,diagnosticTabCount:1,screenshotCount:1,
    evidenceHash:sha('receipt'),screenshots:[{ imageName,sha256:hash }]
  }));
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
