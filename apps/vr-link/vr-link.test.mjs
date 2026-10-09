import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
test('VR Link has standalone fallback, accessible controls and canonical navigation', async () => {
 const html=await readFile(resolve(root,'index.html'),'utf8');
 for(const term of ['Enter Holodeck Baseline','Ping Stephanos','Open VR Research Lab','Return to Command Deck','role="status"','id="session"','id="xr"','id="backend"','id="device"'])assert.ok(html.includes(term),term);
 assert.match(html,/\.\.\/vr-research-lab\/index\.html/);
 assert.match(html,/\.\.\/cockpit\/index\.html/);
 await access(resolve(root,'../vr-research-lab/index.html'));
 await access(resolve(root,'../cockpit/index.html'));
});
test('WebXR failures fall back visibly; local service check is bounded', async () => {
 const code=await readFile(resolve(root,'vr-link.js'),'utf8');
 for(const term of ['isSessionSupported','requestSession','addEventListener(\'end\'','catch(e)','AbortController','3000','/api/health']) assert.ok(code.includes(term),term);
 assert.ok(!code.includes('eval(')); assert.ok(!code.includes('innerHTML'));
});
test('shortcut only permits canonical loopback route', async()=>{
 const ps=await readFile(resolve(root,'../../scripts/windows/Create-Stephanos-VR-Link-Shortcut.ps1'),'utf8');
 assert.match(ps,/127\\.0\\.0\\.1/);
 assert.match(ps,/CreateShortcut/);
 assert.match(ps,/throw 'Only the bounded loopback VR Link route is permitted.'/);
});
