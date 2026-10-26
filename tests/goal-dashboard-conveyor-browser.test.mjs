import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '../node_modules/playwright/index.mjs';
import { projectGoalBuildConveyorOverviewV1 as overview } from '../shared/agents/goalBuildConveyorOverviewV1.mjs';

const html = await readFile(new URL('../apps/goal-dashboard/index.html', import.meta.url), 'utf8');
test('served conveyor is truthful, responsive, touch accessible, and ages without a successful refresh', async () => {
  const now = Date.now(), at = new Date(now).toISOString();
  const projection = {
    goals: [], goalEstate: { schemaVersion: 'stephanos.goal-dashboard-estate-summary.v1', totalOpenGoals: 7,
      stateCounts: { eligible: 3, active: 1, parked: 1, waitingDependency: 1, operatorReady: 1 }, goals: [] },
    stephanosBuildTruth: { schemaVersion: 'stephanos.sovereign-build-truth.v1', truth: 'CURRENT', state: 'BUILDING',
      observedAtUtc: at, lastMaterialProgressAtUtc: at, activeMaterialLaneCount: 1, targetMaterialLaneCount: 15,
      goals: [{ issue: '#1385', title: 'Goal: Live Goal Dashboard Index and Merge Update Awareness', state: 'BUILDING',
        builder: '<worker-one>', lastMaterialProgressAtUtc: at, proofRefs: ['proof/fixture-material'] }] },
    goalBuildGateObservatory: { schemaVersion: 'stephanos.goal-build-gate-observatory.v1', diagnosticOnly: true,
      approvalAuthority: false, mergeAuthority: false, sourceHead: 'a'.repeat(40), observedAtUtc: at,
      observationStatus: 'EVIDENCE_AVAILABLE', gates: [4, 5, 6, 7, 18, 19, 20, 21, 22].map(id => ({
        id, status: 'PASS', observedAtUtc: at, proofRef: 'workspace:proof/fixture-'+id })) },
  };
  projection.goalBuildConveyorOverview = overview(projection, { nowMs: now });
  let available = true;
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store');
    if (req.url.includes('/api/')) {
      if (available && req.url.includes('dashboard-feed')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ schemaVersion: 'stephanos.shared-workspace-dashboard-feed.v1', state: 'ready', projection }));
      } else { res.statusCode=503;res.end('{}'); }
    } else { res.setHeader('content-type', 'text/html');res.end(html); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    const page = await browser.newPage();
    const errors=[];page.on('pageerror', error=>errors.push(String(error)));
    await page.clock.install({ time: now });
    await page.goto('http://127.0.0.1:'+server.address().port+'/apps/goal-dashboard/index.html');
    const card=page.getByTestId('goal-build-conveyor-overview');
    await page.waitForFunction(()=>document.querySelector('#cv-status').textContent.includes('Material building observed'));
    assert.ok((await card.boundingBox()).y<140,'The live conveyor must be visible before the decorative overview hero');
    assert.equal(await card.locator('.cv-stage').count(),9);
    assert.match(await card.locator('#cv-workers').textContent(),/1 workers · 1 goals building/);
    assert.match(await card.locator('#cv-worker-detail').textContent(),/<worker-one>/);
    assert.equal(await card.locator('worker-one').count(),0);
    assert.equal(await card.locator('[data-cv-stage="commit"]').getAttribute('data-cv-light'),'GREY');
    for (const viewport of [{width:1440,height:1100},{width:820,height:1180},{width:1180,height:820},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      assert.equal(await card.isVisible(),true);
      const box=await card.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=viewport.width+1);
      assert.equal(await card.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
      assert.equal(await page.locator('#cv-flow').count(),1);
      const summaries=card.locator('.cv-stage summary');
      assert.ok((await summaries.first().boundingBox()).height>=32);
      await summaries.nth(3).click();assert.equal(await summaries.nth(3).evaluate(node=>node.parentElement.open),true);
      await summaries.nth(3).click();
      if(process.env.STEPHANOS_CONVEYOR_PROOF_DIR){
        await mkdir(process.env.STEPHANOS_CONVEYOR_PROOF_DIR,{recursive:true});
        await card.screenshot({path:join(process.env.STEPHANOS_CONVEYOR_PROOF_DIR,'fixture-'+viewport.width+'.png')});
      }
    }
    // Regression for the real empty-gates failure: the canonical system cycle
    // has no mission or source head, while runtime health is independently live.
    delete projection.goalBuildGateObservatory;
    projection.stephanosBuildTruth.state='STALE';
    const statusRecords=[{statusId:'autonomy-build-track-current',timestampUtc:at,autonomyTrack:{
      schemaVersion:'stephanos.autonomy-build-track.v1',timestampUtc:at,sourceHead:'',missionId:'',issueNumber:null,
      currentGate:'ELIGIBLE_GOAL',currentState:'WAITING',materialActionsSucceeded:0,
      cycleDecision:{safeEligibleWorkRemaining:0},gates:[
        {id:'ELIGIBLE_GOAL',state:'WAITING',reason:'NO_ELIGIBLE_GOAL_OBSERVED'},
        {id:'SELECT',state:'NOT_REACHED',reason:'SCHEDULER_SELECTION_NOT_OBSERVED'},
        {id:'WORKER',state:'NOT_REACHED',reason:'WORKER_PICKUP_NOT_OBSERVED'}]}},
      {statusId:'stephanos-core-daemon-current',sourceHead:'a'.repeat(40),timestampUtc:at,
        daemonHealthy:true,missionWorkerHealthy:false,backendHealthy:true}];
    projection.goalBuildConveyorOverview=overview(projection,{nowMs:now,statusRecords});
    await page.evaluate(()=>refresh());
    assert.equal(await card.locator('#cv-headline').textContent(),'Waiting at admission');
    assert.match(await card.locator('#cv-summary').textContent(),/3 goal records are labelled eligible/);
    assert.match(await card.locator('#cv-cycle').textContent(),/no goal selected/);
    assert.match(await card.locator('[data-cv-stage="admission"]').textContent(),/Waiting here/);
    assert.match(await card.locator('[data-cv-stage="select"]').textContent(),/Not reached/);
    assert.equal(await card.locator('#cv-workers').textContent(),'No pickup reported');
    assert.match(await card.locator('#cv-health').textContent(),/Mission worker · unhealthy/);
    assert.equal(await card.locator('[data-cv-stage="pickup"]').getAttribute('data-cv-light'),'GREY');
    // Expire the observation while all requests hang. Its own display timer
    // must remove green without waiting for a new response or a network error.
    await page.route('**/api/**', route=>new Promise(resolve=>setTimeout(()=>route.abort().then(resolve).catch(resolve),1500)));
    await page.clock.fastForward(601000);
    assert.equal(await card.locator('#cv-status').getAttribute('data-cv-light'),'AMBER');
    assert.equal(await card.locator('[data-cv-stage="pickup"]').getAttribute('data-cv-light'),'AMBER');
    assert.equal(await card.locator('#cv-workers').textContent(),'Active workers unknown');
    assert.match(await card.locator('[data-cv-stage="pickup"]').textContent(),/Last: not reached/);
    assert.equal(await card.locator('[data-cv-light="GREEN"]').count(),0);
    await page.unrouteAll({behavior:'wait'});
    available=false;await page.evaluate(()=>refresh());
    assert.equal(await card.locator('#cv-status').textContent(),'Evidence unavailable');
    assert.match(await card.locator('#cv-metrics').textContent(),/—/);
    assert.equal(await card.locator('[data-cv-light="GREEN"]').count(),0);
    assert.deepEqual(errors,[]);
  } finally { await browser?.close();await new Promise(resolve=>server.close(resolve)); }
});
