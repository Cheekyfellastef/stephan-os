// Test-only HTTP host. No production listener, service installation or authority.
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBattleBridgePublisherLoop } from '../battleBridgePublisherLoop.mjs';

const root = await mkdtemp(join(tmpdir(), 'stephanos-publisher-host-'));
const server = createServer((_req, res) => res.end('CHAT_ALIVE'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let intervalFn;
const loop = startBattleBridgePublisherLoop({ root, repoRoot: process.cwd(),
  options: { atomicRenameRetryDelaysMs: [], renameFn: async () => {
    throw Object.assign(new Error('PRIVATE_IO_FAILURE'), { code: 'EPERM' });
  } }, setIntervalFn(fn) { intervalFn = fn; return 1; }, clearIntervalFn() {} });
const wait = async () => { while (loop.getStatus().inFlight) await new Promise(resolve => setTimeout(resolve, 5)); };
await wait(); intervalFn(); await wait();
if (loop.getStatus().lastResult.ok !== false) throw Error('FALSE_SUCCESS');
const reply = await fetch('http://127.0.0.1:' + server.address().port);
if (await reply.text() !== 'CHAT_ALIVE') throw Error('CHAT_FAILED');
loop.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
console.log('HOST_SURVIVED');
