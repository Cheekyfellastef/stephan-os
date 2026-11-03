import { createHash } from 'node:crypto';
import { createControlTowerBuildRequestV1 } from '../controlTowerBuildRequestV1.mjs';
export const HEAD = 'a'.repeat(40);
export const NOW = '2026-10-28T12:00:20.000Z';
export const API = 'https://api.github.com/repos/Cheekyfellastef/stephan-os';
export const SIGNED = 'https://fixture.actions.githubusercontent.com/proof';
export function inputs() {
  return { event: { ref: 'main', inputs: {},
    repository: { full_name: 'Cheekyfellastef/stephan-os', id: 1179385578, owner: { login: 'Cheekyfellastef' } },
    sender: { login: 'Cheekyfellastef', id: 267490109, type: 'User' } },
  env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: 'request-build',
    GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'Cheekyfellastef/stephan-os',
    GITHUB_WORKFLOW_REF: 'Cheekyfellastef/stephan-os/.github/workflows/stephanos-control-tower-build.yml@refs/heads/main',
    GITHUB_ACTOR: 'Cheekyfellastef', GITHUB_ACTOR_ID: '267490109', GITHUB_SHA: HEAD,
    GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1' } };
}
export function zip(value, filename = 'control-tower-build-request.json') {
  const body = Buffer.from(JSON.stringify(value)), name = Buffer.from(filename);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + body.length, 16);
  return Buffer.concat([local, name, body, central, name, end]);
}
export function fixture() {
  const { event, env } = inputs();
  const request = createControlTowerBuildRequestV1(event, env, HEAD, '2026-10-28T12:00:05.000Z').request;
  const run = { id: 100, workflow_id: 123, path: '.github/workflows/stephanos-control-tower-build.yml',
    head_sha: HEAD, head_branch: 'main', run_attempt: 1, event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
    repository: event.repository, actor: event.sender, triggering_actor: event.sender,
    created_at: '2026-10-28T12:00:00Z', updated_at: '2026-10-28T12:00:15Z' };
  const data = { request, run, archive: zip(request), calls: [], redirect: SIGNED,
    definition: { id: 123, path: run.path, state: 'active' },
    list: { total_count: 1, workflow_runs: [{ ...run }] },
    main: { ref: 'refs/heads/main', object: { sha: HEAD } },
    jobs: { total_count: 2, jobs: [{ run_id: 100, name: 'request-build', status: 'completed', conclusion: 'success' },
      { run_id: 100, name: 'contract-test', status: 'completed', conclusion: 'skipped' }] },
  };
  data.repack = (value = data.request, filename) => {
    data.archive = zip(value, filename);
    data.artifacts = { total_count: 1, artifacts: [{ id: 200, name: 'stephanos-control-tower-build-100', expired: false,
      size_in_bytes: data.archive.length, digest: 'sha256:' + createHash('sha256').update(data.archive).digest('hex'),
      workflow_run: { id: 100, repository_id: 1179385578, head_repository_id: 1179385578, head_sha: HEAD, head_branch: 'main' } }] };
  };
  data.repack();
  let mains = 0;
  data.fetchImpl = async (url, init) => {
    data.calls.push({ url, init });
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    const routes = { '/actions/workflows/stephanos-control-tower-build.yml': data.definition,
      ['/actions/workflows/stephanos-control-tower-build.yml/runs?per_page=10&head_sha=' + HEAD]: data.list,
      '/actions/runs/100': data.run, '/actions/runs/100/jobs?per_page=100': data.jobs,
      '/actions/runs/100/artifacts?per_page=100': data.artifacts };
    if (path === '/git/ref/heads/main') return Response.json(++mains > 1 && data.moved ? data.moved : data.main);
    if (Object.hasOwn(routes, path)) return Response.json(routes[path]);
    if (path === '/actions/artifacts/200/zip') return new Response(null, { status: 302, headers: { location: data.redirect } });
    if (url === SIGNED) return new Response(data.archive);
    throw Error('Unregistered endpoint');
  };
  return data;
}
