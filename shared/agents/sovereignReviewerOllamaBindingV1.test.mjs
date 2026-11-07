import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitSovereignLocalOllamaBindingV1 as admit,
  matchesSovereignLocalOllamaCompletionV1 as matches,
  sovereignLocalOllamaFailureReasonV1 as failureReason,
} from './sovereignReviewerOllamaBindingV1.mjs';

const digest = 'a'.repeat(64);
const reply = version => new Response(JSON.stringify({ version }));

test('reviewed stable protocol binds the full root manifest to explicit local source', async () => {
  for (const version of ['0.40.0', '0.40.15']) {
    const calls = [];
    const binding = await admit(digest, { fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return reply(version);
    } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:11434/api/version');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.body, undefined, 'compatibility probe contains no prompt');
    assert.ok(calls[0].options.signal instanceof AbortSignal);
    assert.deepEqual(binding, {
      model: 'sha256:' + digest + ':local',
      manifestDigestSha256: digest, protocolVersion: version,
    });
    assert.equal(Object.isFrozen(binding), true);
  }
});

test('unsupported, prerelease and malformed versions do not admit digest semantics', async () => {
  for (const version of [
    '0.35.1', '0.39.99', '0.41.0', '1.40.0', '0.40.0-rc.1', '0.40.15+local',
    'v0.40.15', '0.40.015', ' 0.40.15', '0.40.15\n', '', null, 40, ['0.40.15'],
  ]) {
    await assert.rejects(admit(digest, { fetchImpl: async () => reply(version) }),
      /LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED/);
  }
});

test('bad manifest identity is rejected before the compatibility request', async () => {
  for (const value of ['', 'a'.repeat(63), 'A'.repeat(64), 'sha256:' + digest, {}, null]) {
    let contacted = false;
    await assert.rejects(admit(value, { fetchImpl: async () => { contacted = true; } }),
      /LOCAL_OLLAMA_MANIFEST_DIGEST_INVALID/);
    assert.equal(contacted, false);
  }
});

test('HTTP, redirect, missing body and malformed payload fail closed', async () => {
  for (const fetchImpl of [
    async () => new Response('{}', { status: 503 }),
    async () => ({ ok: true, redirected: true, body: reply('0.40.15').body }),
    async () => { throw new Error('redirect to untrusted host'); },
    async () => ({ ok: true, text: async () => '{"version":"0.40.15"}' }),
    async () => new Response('not JSON'),
    async () => new Response(Uint8Array.of(0xff, 0xff)),
  ]) {
    await assert.rejects(admit(digest, { fetchImpl }),
      /LOCAL_OLLAMA_DIGEST_PROTOCOL_UNPROVEN/);
  }
});

test('oversized version body is cancelled while streaming rather than accumulated', async () => {
  let pulled = 0, cancelled = false;
  const body = new ReadableStream({
    pull(controller) { pulled++; controller.enqueue(new Uint8Array(1024).fill(32)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(admit(digest, { fetchImpl: async () => new Response(body) }),
    /LOCAL_OLLAMA_DIGEST_PROTOCOL_UNPROVEN/);
  assert.equal(cancelled, true);
  assert.ok(pulled <= 6, 'at most the limit, rejecting chunk and stream prefetch are read');
});

test('caller cancellation holds before a request and interrupts a stalled body', async () => {
  const already = new AbortController(); already.abort();
  let contacted = false;
  await assert.rejects(admit(digest, {
    signal: already.signal, fetchImpl: async () => { contacted = true; },
  }), /LOCAL_OLLAMA_DIGEST_PROTOCOL_UNPROVEN/);
  assert.equal(contacted, false);
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const attempt = admit(digest, {
    signal: controller.signal,
    fetchImpl: async () => new Response(body),
  });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(attempt, /LOCAL_OLLAMA_DIGEST_PROTOCOL_UNPROVEN/);
  assert.equal(cancelled, true);
});

test('completion checks protocol consistency and denies mutable, remote or mismatched selectors', async () => {
  const binding = await admit(digest, { fetchImpl: async () => reply('0.40.15') });
  assert.equal(matches({ model: binding.model }, binding), true);
  for (const response of [
    { model: 'qwen:14b' },
    { model: 'sha256:' + digest },
    { model: 'sha256-' + digest + ':local' },
    { model: 'sha256:' + 'b'.repeat(64) + ':local' },
    { model: binding.model.toUpperCase() },
    { model: binding.model, remote_host: '' },
    { model: binding.model, remote_model: '' },
    { model: binding.model, remote_host: 'https://remote.invalid' },
    { model: binding.model, remote_model: 'remote-model' },
    null,
  ]) assert.equal(matches(response, binding), false);
  assert.equal(matches({ model: 'qwen:14b' }, { model: 'qwen:14b' }), false);
});


test('public protocol diagnostic projection admits only fixed codes and reads an error once', () => {
  for(const code of ['LOCAL_OLLAMA_MANIFEST_DIGEST_INVALID',
    'LOCAL_OLLAMA_DIGEST_PROTOCOL_UNPROVEN','LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED']) {
    assert.equal(failureReason(new Error(code)),code);
  }
  for(const error of [new Error('private provider details'),null,'LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED',
    {get message(){throw new Error('private getter error')}}]) assert.equal(failureReason(error),'');
  let reads=0;
  assert.equal(failureReason({get message(){return ++reads===1
    ? 'LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED' : 'private provider details';}}),
  'LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED');
  assert.equal(reads,1);
});
