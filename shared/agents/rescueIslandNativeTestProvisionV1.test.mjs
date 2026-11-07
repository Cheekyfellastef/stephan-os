import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeIslandNativeTestHostV1 as observe,provisionIslandNativeSourceTestsV1 as provision,
  inspectIslandNativeTestDescriptorV1 as inspect,ISLAND_NATIVE_TEST_FILES as names} from './rescueIslandNativeTestProvisionV1.mjs';
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'island-native-test-provision-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'),worktree=join(root,'worktree'),receiptRoot=join(root,'receipts');
 for(const p of [source,worktree,receiptRoot])await mkdir(p);
 for(const name of names)await writeFile(join(source,name),'Explicit non-executable file-copy fixture: '+name+'\n');
 const descriptor=await observe(join(source,names[0]));
 return {source,worktree,receiptRoot,descriptor,taskId:'native-copy-fixture'};
}
test('bounded native test copy binds every observed byte and is explicitly not full qualification',async t=>{
 const f=await fixture(t),result=await provision(f);
 assert.equal(result.fullWindowsQualification,false);assert.equal(result.principalEnrollment,false);
 for(const name of names)assert.deepEqual(
  await readFile(join(f.worktree,'src/windows/Stephanos.RescueIslandHost/bin/Release/net8.0-windows',name)),
  await readFile(join(f.source,name)));
 await assert.rejects(provision(f),/EEXIST/);
});
test('changed observer bytes stop provisioning without replacing an existing file',async t=>{
 const f=await fixture(t);await writeFile(join(f.source,names[0]),'unexplained changed observer\n');
 await assert.rejects(provision(f),/HOST_CHANGED/);
});
test('native test descriptors reject arbitrary executable names and widened artifact lists',async t=>{
 const f=await fixture(t);
 assert.equal(inspect({...f.descriptor,files:{...f.descriptor.files,'arbitrary.exe':'0'.repeat(64)}}),false);
 await assert.rejects(observe(join(f.source,'arbitrary.exe')),/HOST_INVALID/);
 await assert.rejects(provision({...f,taskId:'../escape'}),/DESCRIPTOR_INVALID/);
});
