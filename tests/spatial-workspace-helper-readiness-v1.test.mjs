import test from 'node:test';
import assert from 'node:assert/strict';
import { createHolodeckWindowClient } from '../apps/spatial-bridge/holodeck-window-client-v1.mjs';

function helper(data,{port='4173',ok=true,fail=false}={}){
  const requests=[];
  const client=createHolodeckWindowClient({
    locationRef:{hostname:'127.0.0.1',port},sessionStore:null,documentRef:null,
    fetchRef:async(url,options)=>{
      requests.push({url,...options});
      if(fail)throw new Error('unavailable');
      return {ok,json:async()=>data};
    },
  });
  return {client,requests};
}
const valid={schema:'stephanos.spatial-window-health.v1',buildId:'a'.repeat(64),readinessOnly:false};

test('an operational helper is a selection prerequisite, never an input grant',async()=>{
  const {client,requests}=helper(valid);
  const result=await client.probeHelper();
  assert.equal(result.ok,true);assert.equal(result.reason,'Local Spatial helper responds.');
  assert.equal(client.getState().status,'idle');assert.equal(client.getFrame(),null);
  assert.equal(client.input({kind:'text',text:'not granted'}),false);
  assert.deepEqual(requests.map(({url,method,cache})=>({url,method,cache})),[
    {url:'http://127.0.0.1:4180/health',method:'GET',cache:'no-store'},
  ]);
});

test('a temporary readiness listener cannot be described as ready for interaction',async()=>{
  for(const port of ['4173','4174']){
    const {client,requests}=helper({...valid,readinessOnly:true},{port});
    const result=await client.probeHelper();
    assert.equal(result.ok,false);assert.match(result.reason,/installation check only/);
    assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');
  }
});

test('production health rejects missing, malformed and non-string build identities',async()=>{
  for(const buildId of [null,undefined,'','invalid','a'.repeat(63),['a'.repeat(64)]]){
    const {client}=helper({...valid,buildId});
    const result=await client.probeHelper();
    assert.equal(result.ok,false);assert.match(result.reason,/build identity/);
  }
});

test('explicit preview health keeps its native-free development contract',async()=>{
  const {client,requests}=helper({...valid,buildId:null},{port:'4174'});
  assert.equal((await client.probeHelper()).ok,true);
  assert.equal(requests[0].url,'http://127.0.0.1:4184/health');
});

test('unexpected, refused and unavailable listeners remain distinct observations',async()=>{
  for(const [data,options,reason] of [
    [{schema:'other'}, {}, /Unexpected/],
    [valid,{ok:false},/refused/],
    [valid,{fail:true},/unavailable on port 4180/],
  ]){
    const {client}=helper(data,options),result=await client.probeHelper();
    assert.equal(result.ok,false);assert.match(result.reason,reason);
    assert.equal(client.getState().status,'idle');
  }
});
