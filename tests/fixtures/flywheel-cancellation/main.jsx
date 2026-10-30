import React from 'react';
import { createRoot } from 'react-dom/client';
import FlywheelPanel from '../../../stephanos-ui/src/components/FlywheelPanel.jsx';
import { updateBridge } from './store.jsx';

const proof = document.querySelector('#proof');
const host = document.querySelector('#panel');
const calls = [];
const checks = [];
const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function check(name, condition) {
  checks.push({ name, passed: Boolean(condition) });
  proof.textContent = JSON.stringify({ checks, calls: calls.length, aborted: calls.filter((call) => call.signal.aborted).length }, null, 2);
  if (!condition) throw new Error(name);
}
// Hold transport completion independently from abort to exercise a late old promise.
window.fetch = (url, { signal }) => new Promise((resolve) => {
  const call = { url, signal, complete(reason) {
    resolve(new Response(JSON.stringify({ datasets: { dashboard: { reason } } }), { status: 200 }));
  } };
  calls.push(call);
});

document.querySelector('#run').addEventListener('click', async (event) => {
  event.target.disabled = true;
  let root = createRoot(host);
  try {
    root.render(<FlywheelPanel />);
    await frame();
    check('Initial mount starts one request', calls.length === 1);
    for (let index = 0; index < 20; index += 1) { updateBridge(); await frame(); }
    check('Twenty equivalent bridge objects do not restart the poll', calls.length === 1 && !calls[0].signal.aborted);
    updateBridge({ backendUrl: 'http://127.0.0.1:8788' });
    await frame();
    check('Changed route context aborts old transport and starts one replacement', calls.length === 2 && calls[0].signal.aborted && !calls[1].signal.aborted);
    calls[1].complete('CURRENT_FIXTURE_REPLY');
    await frame();
    check('Current reply is rendered', host.textContent.includes('CURRENT_FIXTURE_REPLY'));
    calls[0].complete('OLD_FIXTURE_REPLY');
    await frame();
    check('Late old reply cannot overwrite current reply', host.textContent.includes('CURRENT_FIXTURE_REPLY') && !host.textContent.includes('OLD_FIXTURE_REPLY'));
    root.unmount();
    root = createRoot(host);
    root.render(<FlywheelPanel />);
    await frame();
    check('Remount starts exactly one new request', calls.length === 3);
    root.unmount();
    check('Unmount aborts in-flight transport', calls[2].signal.aborted);
    calls[2].complete('UNMOUNTED_FIXTURE_REPLY');
    await new Promise((resolve) => setTimeout(resolve, 15500));
    check('Late completion and old timers cannot restart an unmounted poll', calls.length === 3 && host.textContent === '');
    proof.dataset.result = 'passed';
    proof.textContent = 'PASS\n' + proof.textContent;
  } catch (error) {
    root.unmount();
    proof.dataset.result = 'failed';
    proof.textContent += '\nFAIL: ' + error.message;
  }
});
