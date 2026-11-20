import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from '../node_modules/playwright/index.mjs';

const html = await readFile(new URL('../apps/goal-dashboard/index.html', import.meta.url),'utf8');

test('canonical feed polls update all conveyor counts, retain bound journeys, and render genuine zero', {timeout:60000}, async () => {
  let goals=Array.from({length:84},(_,i)=>({issue:'#'+(1500+i),title:'Fixture goal '+i,
    state:'READY',statusTruth:'CURRENT',proofTruth:'UNKNOWN'}));
  goals[0].buildJourney={schemaVersion:'stephanos.goal-build-conveyor.v1',goal:'#1500',
    builder:'fixture-worker',currentStage:'PICKED_UP',currentStageLabel:'Picked up',
    currentTrafficLight:'AMBER',provenStageCount:5,totalStageCount:10,
    stages:[{id:'PICKED_UP',label:'Picked up',trafficLight:'AMBER',proven:false,reason:'Fixture pickup remains pending'}]};
  goals[1].buildState='STALE';goals[1].buildEvidenceDiagnostic='Build activity evidence is stale <fixture>.';goals[1].exactNextAction='Preserve the actual next action.';
  let counts={provenToBuilderCount:3,buildingCount:2,completedCount:1,blockedCount:4};
  let reads=0;
  const server=createServer((req,res)=>{
    if(req.url.startsWith('/api/shared-workspace/dashboard-feed')){
      reads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({
        schemaVersion:'stephanos.shared-workspace-dashboard-feed.v1',
        state:'ready',reason:'FIXTURE_CURRENT_FEED',records:{},projection:{goals,goalBuildConveyor:counts}
      }));
    }else if(req.url==='/api/health'){
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));
    }else if(req.url==='/'||req.url.startsWith('/?')){
      res.setHeader('Content-Type','text/html');res.end(html);
    }else{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port+'/#goals');
    await page.waitForFunction(()=>document.querySelectorAll('.goal-card').length===84,null,{timeout:10000});
    assert.equal(await page.locator('.goal-card').count(),84,JSON.stringify({reads,errors}));
    const values=()=>page.locator('.goal-conveyor-summary strong').allTextContents();
    assert.deepEqual(await values(),['84','3','2','1','4']);
    assert.equal(await page.locator('[data-goal-build-conveyor-row]').count(),30);
    const bound=page.locator('[data-goal-build-conveyor-row="#1500"]');
    assert.match(await bound.textContent(),/fixture-worker/);
    assert.equal(await bound.getAttribute('data-current-stage'),'PICKED_UP');
    assert.equal(await page.locator('[data-testid="goal-build-conveyor"]').isVisible(),true);
    const stale=page.locator('[data-goal-build-conveyor-row="#1501"]');
    assert.match(await stale.textContent(),/evidence is stale <fixture>/);
    assert.match(await stale.textContent(),/Preserve the actual next action/);
    assert.equal(await stale.locator('fixture').count(),0);
    assert.equal(await stale.locator('[data-stage="PICKED_UP"][data-light="GREEN"]').count(),0);
    const before=reads;
    goals=[];counts={provenToBuilderCount:0,buildingCount:0,completedCount:0,blockedCount:0};
    await page.waitForFunction(()=>document.querySelectorAll('.goal-card').length===0,null,{polling:100,timeout:25000});
    assert.equal(await page.locator('.goal-card').count(),0,JSON.stringify({reads,errors}));
    assert.ok(reads>before,'existing scheduled poll must consume the replacement feed');
    assert.deepEqual(await values(),['0','0','0','0','0']);
    assert.match(await page.locator('#goal-conveyor-board').textContent(),/No goal build journeys/);
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
