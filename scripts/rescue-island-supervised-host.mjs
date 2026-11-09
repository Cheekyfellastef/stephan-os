// Fixed local stdin ingress. No caller-selected path, executable or authority flags.
import { createRescueIslandSupervisedHostV1 } from '../shared/agents/rescueIslandSupervisedHostV1.mjs';
let size=0;const chunks=[];
try {
  if(process.argv.length!==2)throw Error('ISLAND_HOST_ARGUMENTS_FORBIDDEN');
  for await(const chunk of process.stdin) {
    size+=chunk.length;if(size>16384)throw Error('ISLAND_HOST_REQUEST_OVERSIZE');chunks.push(chunk);
  }
  const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const result=await createRescueIslandSupervisedHostV1().run(request);
  process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){
  const blocker=/^(?:ISLAND_HOST_|RESCUE_ISLAND_)[A-Z0-9_:,.-]+$/.test(error?.code||error?.message||'')
    ? (error.code||error.message):'ISLAND_HOST_EXECUTION_HELD';
  process.stdout.write(JSON.stringify({ok:false,blocker,assuranceProfile:'SUPERVISED_COOPERATIVE_V1',
    hostileWriterContainmentProven:false,executionAllowed:false})+'\n');process.exitCode=3;
}
