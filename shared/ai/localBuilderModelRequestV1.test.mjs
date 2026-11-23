import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalBuilderModelRequestV1 as create} from './localBuilderModelRequestV1.mjs';
import {requestBoundedOllamaJsonReplyV1 as request} from './boundedOllamaJsonReplyV1.mjs';

test('existing-file request constrains edits and generation without granting path authority', async () => {
  const body = create({model:'qwen3-coder:30b',prompt:'Small unique-anchor edit'});
  assert.equal(body.options.num_predict,8192);
  assert.equal(body.options.temperature,0);
  assert.equal(body.format.additionalProperties,false);
  assert.deepEqual(body.format.required,['edits','summary']);
  assert.equal(body.format.properties.edits.maxItems,64);
  assert.equal(body.format.properties.edits.items.additionalProperties,false);
  assert.equal(body.format.properties.patch,undefined);
  await assert.rejects(request('http://example.invalid',body,{fetchImpl:async(_url, options)=>{
    const sent=JSON.parse(options.body);
    assert.deepEqual(sent.format,body.format);
    assert.equal(sent.options.num_predict,8192);
    // Even valid JSON cut off at the provider token limit is not an edit.
    return new Response(JSON.stringify({done:true,done_reason:'length',message:{content:'{"edits":[],"summary":"truncated"}'}})+'\n');
  }}),/MODEL_RESPONSE_INCOMPLETE/);
});

test('empty-source request retains the existing legacy patch option and isolated schema objects',()=>{
  const first=create({model:'test',prompt:'test',patchFallbackAllowed:true});
  assert.deepEqual(first.format.anyOf.map(x=>x.required),[['edits','summary'],['patch','summary']]);
  first.format.anyOf[0].properties.edits.maxItems=999;
  assert.equal(create({model:'test',prompt:'test'}).format.properties.edits.maxItems,64);
});
