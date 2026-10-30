// Internal source-test setup, never a request-selected executable or OS install.
// Existing owner admission observes this descriptor; copied artifacts remain
// test-only and confer no review, principal-enrolment or execution authority.
import {createHash} from 'node:crypto';
import {lstat,mkdir,open,readFile,realpath} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
export const ISLAND_NATIVE_TEST_FILES=Object.freeze([
  'Stephanos.RescueIslandHost.exe','Stephanos.RescueIslandHost.dll',
  'Stephanos.RescueIslandHost.deps.json','Stephanos.RescueIslandHost.runtimeconfig.json',
  'Stephanos.RescueIslandCustody.dll',
]);
const hash=x=>createHash('sha256').update(x).digest('hex');
const folded=p=>process.platform==='win32'?p.toLowerCase():p;
function held(code){throw Object.assign(new Error(code),{code});}
async function physical(path,file=true){
 const st=await lstat(path);
 if(st.isSymbolicLink()||folded(await realpath(path))!==folded(resolve(path))
   ||(file?!st.isFile():!st.isDirectory()))held('ISLAND_HOST_NATIVE_TEST_ESTATE_REDIRECTED');
 return st;
}
export async function observeIslandNativeTestHostV1(executable){
 if(typeof executable!=='string'||!isAbsolute(executable)
   ||basename(executable)!==ISLAND_NATIVE_TEST_FILES[0])held('ISLAND_HOST_NATIVE_TEST_HOST_INVALID');
 const directory=dirname(executable);await physical(directory,false);
 const files={};
 for(const name of ISLAND_NATIVE_TEST_FILES){
  const path=join(directory,name),st=await physical(path);
  if(st.size<2||st.size>2*1024*1024)held('ISLAND_HOST_NATIVE_TEST_HOST_INVALID');
  files[name]=hash(await readFile(path));
 }
 return Object.freeze({schemaVersion:'stephanos.rescue-island-native-test-observation.v1',
  directory,files:Object.freeze(files),purpose:'OBSERVED_NATIVE_HOST_SMOKE_ONLY'});
}
export function inspectIslandNativeTestDescriptorV1(value){
 return Boolean(value&&value.schemaVersion==='stephanos.rescue-island-native-test-observation.v1'
  &&typeof value.directory==='string'&&isAbsolute(value.directory)
  &&value.purpose==='OBSERVED_NATIVE_HOST_SMOKE_ONLY'
  &&value.files&&Object.keys(value.files).sort().join(',')===[...ISLAND_NATIVE_TEST_FILES].sort().join(',')
  &&Object.values(value.files).every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)));
}
export async function provisionIslandNativeSourceTestsV1({descriptor,worktree,receiptRoot,taskId}){
 if(!inspectIslandNativeTestDescriptorV1(descriptor)||!/^[a-z0-9][a-z0-9-]{7,63}$/.test(taskId||''))
   held('ISLAND_HOST_NATIVE_TEST_DESCRIPTOR_INVALID');
 await physical(worktree,false);await physical(receiptRoot,false);
 const destination=join(worktree,'src','windows','Stephanos.RescueIslandHost','bin','Release','net8.0-windows');
 await mkdir(destination,{recursive:true});await physical(destination,false);
 for(const name of ISLAND_NATIVE_TEST_FILES){
  const source=join(descriptor.directory,name);await physical(source);
  const bytes=await readFile(source);
  if(hash(bytes)!==descriptor.files[name])held('ISLAND_HOST_NATIVE_TEST_HOST_CHANGED');
  const target=join(destination,name),file=await open(target,'wx');
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await physical(target);
  if(hash(await readFile(target))!==descriptor.files[name])held('ISLAND_HOST_NATIVE_TEST_COPY_CHANGED');
 }
 const output=join(receiptRoot,'test-output');await mkdir(output,{recursive:true});await physical(output,false);
 const receipt={schemaVersion:'stephanos.rescue-island-native-source-test-provision.v1',taskId,
  profile:'OBSERVED_NATIVE_HOST_SMOKE_V1',files:descriptor.files,fullWindowsQualification:false,
  operatingSystemChanged:false,principalEnrollment:false};
 const file=await open(join(output,taskId+'.native-observer.json'),'wx');
 try{await file.writeFile(JSON.stringify(receipt)+'\n');await file.sync();}finally{await file.close();}
 return Object.freeze(receipt);
}
