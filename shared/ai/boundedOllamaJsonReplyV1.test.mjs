import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {requestBoundedOllamaJsonReplyV1 as request} from './boundedOllamaJsonReplyV1.mjs';

const endpoint = 'http://127.0.0.1:11434/api/chat';
const payload = {model:'qwen3-coder:30b',format:'json',messages:[{role:'user',content:'bounded test'}]};
const frame = (content, done = false) => JSON.stringify({message:{role:'assistant',content},done})+'\n';
const reply = bytes => new Response(bytes);

test('streamed UTF-8 fragments assemble only after an authentic terminal frame', async () => {
  const encoded = new TextEncoder().encode(frame('{"edits":')+frame('[],"summary":"café"}')+frame('',true).trimEnd());
  let cancelled = false;
  const result = await request(endpoint,payload,{fetchImpl:async (_url,options)=>{
    const sent=JSON.parse(options.body);
    assert.equal(sent.stream,true);
    assert.equal(sent.format,'json');
    assert.equal(options.method,'POST');
    assert.deepEqual(sent.messages,payload.messages);
    let offset=0;
    return new Response(new ReadableStream({pull(c){if(offset===encoded.length)c.close();else c.enqueue(encoded.slice(offset,++offset));},cancel(){cancelled=true;}}));
  }});
  assert.deepEqual(JSON.parse(result.message.content),{edits:[],summary:'café'});
  assert.equal(cancelled,false,'completed streams close normally');
});

test('truncation, malformed frames, extra output, tool calls and size excess refuse', async t => {
  for (const [name,body,options,reason] of [
    ['missing terminal',frame('{}'),{},'RESPONSE_INCOMPLETE'],
    ['truncated generation',JSON.stringify({done:true,done_reason:'length',message:{content:'{}'}}),{},'RESPONSE_INCOMPLETE'],
    ['invalid JSON','{invalid}\n',{},'STREAM_INVALID_JSON'],
    ['missing done',JSON.stringify({message:{content:'{}'}}),{},'STREAM_INVALID_FRAME'],
    ['after terminal',frame('{}',true)+frame('more'),{},'STREAM_AFTER_TERMINAL'],
    ['tool call',JSON.stringify({done:true,message:{content:'{}',tool_calls:[{}]}}),{},'STREAM_INVALID_MESSAGE'],
    ['wire limit',frame('{}',true),{wireBytes:2},'RESPONSE_TOO_LARGE'],
    ['content limit',frame('123',true),{contentBytes:2},'RESPONSE_TOO_LARGE'],
    ['invalid UTF8',new Uint8Array([255]),{},'TRANSPORT_FAILED:'],
  ]) await t.test(name,()=>assert.rejects(request(endpoint,payload,{...options,fetchImpl:async()=>reply(body)}),new RegExp(reason)));
});

test('HTTP failure and transport cause remain distinct bounded failures', async () => {
  await assert.rejects(request(endpoint,payload,{fetchImpl:async()=>new Response('',{status:503})}),/MODEL_HTTP_503/);
  await assert.rejects(request(endpoint,payload,{fetchImpl:async()=>{throw new TypeError('fetch failed',{cause:{code:'UND_ERR_HEADERS_TIMEOUT'}});}}),/TRANSPORT_FAILED:UND_ERR_HEADERS_TIMEOUT/);
  await assert.rejects(request(endpoint,payload,{fetchImpl:async()=>({ok:true})}),/STREAM_UNAVAILABLE/);
});

test('idle and overall deadlines cover headers and body and cancel the request', async t => {
  for(const mode of ['headers-idle','body-idle','overall']) await t.test(mode,async()=>{
    let signal,cancelled=false,interval;
    await assert.rejects(request(endpoint,payload,{
      deadlineMs:mode==='overall'?70:200,idleMs:mode==='overall'?100:30,
      fetchImpl:async(_url,options)=>{
        signal=options.signal;
        if(mode==='headers-idle') return new Promise(()=>{});
        return new Response(new ReadableStream({start(c){
          if(mode==='overall')interval=setInterval(()=>c.enqueue(new TextEncoder().encode(frame(''))),10);
        },cancel(){cancelled=true;clearInterval(interval);}}));
      },
    }),mode==='overall'?/REQUEST_DEADLINE_EXCEEDED/:/RESPONSE_STALLED/);
    assert.equal(signal.aborted,true);
    if(mode!=='headers-idle')assert.equal(cancelled,true);
  });
});

test('real HTTP streaming preserves incremental response and final JSON', async t => {
  const server=createServer((req,res)=>{
    let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
      assert.equal(JSON.parse(body).stream,true);
      res.writeHead(200,{'content-type':'application/x-ndjson'});
      res.write(frame('{"edits":'));
      setTimeout(()=>res.end(frame('[]}')+frame('',true)),30);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const result=await request(`http://127.0.0.1:${server.address().port}/api/chat`,payload,{deadlineMs:2000,idleMs:1000});
  assert.deepEqual(JSON.parse(result.message.content),{edits:[]});
});
