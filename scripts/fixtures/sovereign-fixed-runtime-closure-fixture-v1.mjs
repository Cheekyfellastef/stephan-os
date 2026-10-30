// Parse-only source closure proof: no repository module is linked/evaluated.
import vm from 'node:vm';import fs from 'node:fs';import path from 'node:path';
const closure=JSON.parse(fs.readFileSync(new URL('../../shared/agents/sovereignFixedRuntimeSourceClosureV1.json',import.meta.url)));
const root=new URL('../../',import.meta.url),members=new Set(closure.paths),seen=new Set();
const queue=['scripts/sovereign-commander-http.mjs','scripts/sovereign-fixed-runtime-source-task-v1.mjs','scripts/mission-orchestrator-worker-supervised.mjs','scripts/sovereign-commander-goal-builder-repair.mjs','scripts/sovereign-commander-fleet-goal-supervisor.mjs','scripts/sovereign-controller-lane-status.mjs','scripts/battle-bridge-goal-discovery-heartbeat.mjs'];
const missing=[],bare=[];
while(queue.length){const file=queue.shift();if(seen.has(file))continue;seen.add(file);
 const source=fs.readFileSync(new URL(file,root),'utf8');const module=new vm.SourceTextModule(source);
 const specs=new Set([...module.dependencySpecifiers,...[...source.matchAll(/\bimport\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g)].map(m=>m[2])]);
 for(const spec of specs){if(spec.startsWith('node:'))continue;if(!spec.startsWith('.')){bare.push({file,spec});continue;}
  const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
  if(!members.has(target))missing.push({file,spec,target});
  if(/\.(mjs|js)$/.test(target))queue.push(target);
 }
}
for(const input of ['scripts/windows/read-sovereign-maintenance-boot-witness.ps1','scripts/windows/read-sovereign-maintenance-owner-v2.ps1','scripts/windows/sovereign-maintenance-audit-anchor.ps1','scripts/windows/sovereign-maintenance-journal-policy-v2.ps1','scripts/windows/install-sovereign-fixed-runtime-v1.ps1'])if(!members.has(input))missing.push({runtimeRead:input});
console.log(JSON.stringify({memberCount:members.size,parsed:seen.size,missing,bare,repositoryModulesEvaluated:false}));
