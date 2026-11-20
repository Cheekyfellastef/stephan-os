import { createHash } from 'node:crypto';
import { createControlTowerBuildRequestV1 } from '../controlTowerBuildRequestV1.mjs';
import { CANONICAL_MAILBOX_ISSUE } from '../canonicalMailboxAuthorityV1.mjs';
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
    GITHUB_WORKFLOW_SHA: HEAD,
    GITHUB_ACTOR: 'Cheekyfellastef', GITHUB_ACTOR_ID: '267490109', GITHUB_TRIGGERING_ACTOR: 'Cheekyfellastef', GITHUB_SHA: HEAD,
    GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1' } };
}
export function ownerCommentInputs(operation = 'BUILD_NEXT_ELIGIBLE_GOAL', commentId = 700) {
  const { event, env } = inputs();
  delete event.ref; delete event.inputs;
  env.GITHUB_EVENT_NAME = 'issue_comment';
  const command = { schemaVersion: 'stephanos.control-tower-owner-command.v1', operation, expectedMain: HEAD };
  const body = '<!-- stephanos-control-tower-owner-command-v1 -->\n```json\n' + JSON.stringify(command, null, 2) + '\n```';
  const issue = { number: CANONICAL_MAILBOX_ISSUE, repository_url: API,
    url: API + '/issues/' + CANONICAL_MAILBOX_ISSUE, state: 'open', locked: false, comments: 10 };
  const comment = { id: commentId, issue_url: issue.url, body, user: { ...event.sender },
    created_at: '2026-10-28T11:59:59Z', updated_at: '2026-10-28T11:59:59Z' };
  event.action = 'created'; event.issue = { ...issue }; event.comment = structuredClone(comment);
  return { event, env, command, comment, issue,
    readback: { comment, issue, bodySha256: createHash('sha256').update(body).digest('hex') } };
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
export function fixture({ ownerComment = false, operation = 'BUILD_NEXT_ELIGIBLE_GOAL', runId = 100, commentId = 700 } = {}) {
  const { event, env, readback } = ownerComment ? ownerCommentInputs(operation, commentId) : inputs();
  env.GITHUB_RUN_ID = String(runId);
  if (!ownerComment) event.inputs.operation = operation;
  const request = createControlTowerBuildRequestV1(event, env, HEAD, '2026-10-28T12:00:05.000Z', readback).request;
  const artifactId = runId + 100;
  const run = { id: runId, workflow_id: 123, path: '.github/workflows/stephanos-control-tower-build.yml',
    head_sha: HEAD, head_branch: 'main', run_attempt: 1, event: env.GITHUB_EVENT_NAME, status: 'completed', conclusion: 'success',
    repository: event.repository, actor: event.sender, triggering_actor: event.sender,
    created_at: '2026-10-28T12:00:00Z', updated_at: '2026-10-28T12:00:15Z' };
  const data = { request, run, comment: readback?.comment, issue: readback?.issue, archive: zip(request), calls: [], redirect: SIGNED,
    definition: { id: 123, path: run.path, state: 'active' },
    list: { total_count: 1, workflow_runs: [{ ...run }] },
    main: { ref: 'refs/heads/main', object: { sha: HEAD } },
    jobs: { total_count: 2, jobs: [{ run_id: runId, name: 'request-build', status: 'completed', conclusion: 'success' },
      { run_id: runId, name: 'contract-test', status: 'completed', conclusion: 'skipped' }] },
  };
  data.repack = (value = data.request, filename) => {
    data.archive = zip(value, filename);
    data.artifacts = { total_count: 1, artifacts: [{ id: artifactId, name: 'stephanos-control-tower-build-' + runId, expired: false,
      size_in_bytes: data.archive.length, digest: 'sha256:' + createHash('sha256').update(data.archive).digest('hex'),
      workflow_run: { id: runId, repository_id: 1179385578, head_repository_id: 1179385578, head_sha: HEAD, head_branch: 'main' } }] };
  };
  data.repack();
  let mains = 0;
  data.fetchImpl = async (url, init) => {
    data.calls.push({ url, init });
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    const routes = { '/actions/workflows/stephanos-control-tower-build.yml': data.definition,
      ['/actions/workflows/stephanos-control-tower-build.yml/runs?status=success&per_page=10&head_sha=' + HEAD]: data.list,
      ['/actions/runs/' + runId]: data.run, ['/actions/runs/' + runId + '/jobs?per_page=100']: data.jobs,
      ['/actions/runs/' + runId + '/artifacts?per_page=100']: data.artifacts,
      ['/issues/comments/' + commentId]: data.comment, ['/issues/' + CANONICAL_MAILBOX_ISSUE]: data.issue };
    if (path === '/git/ref/heads/main') return Response.json(++mains > 1 && data.moved ? data.moved : data.main);
    if (Object.hasOwn(routes, path)) return Response.json(routes[path]);
    if (path === '/actions/artifacts/' + artifactId + '/zip') return new Response(null, { status: 302, headers: { location: data.redirect } });
    if (url === SIGNED) return new Response(data.archive);
    throw Error('Unregistered endpoint');
  };
  return data;
}
