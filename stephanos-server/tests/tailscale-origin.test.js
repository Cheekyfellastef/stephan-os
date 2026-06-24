import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedTailscaleFrontendOrigin,
  isTailscaleDnsHost,
  isTailscaleIpv4Host,
} from '../config/tailscaleOrigin.js';

test('recognizes the Tailscale IPv4 CGNAT range only', () => {
  assert.equal(isTailscaleIpv4Host('100.64.0.1'), true);
  assert.equal(isTailscaleIpv4Host('100.127.255.254'), true);
  assert.equal(isTailscaleIpv4Host('100.63.255.255'), false);
  assert.equal(isTailscaleIpv4Host('100.128.0.1'), false);
  assert.equal(isTailscaleIpv4Host('192.168.0.10'), false);
});

test('recognizes bounded Tailscale MagicDNS names', () => {
  assert.equal(isTailscaleDnsHost('desktop.example-tailnet.ts.net'), true);
  assert.equal(isTailscaleDnsHost('DESKTOP.EXAMPLE-TAILNET.TS.NET'), true);
  assert.equal(isTailscaleDnsHost('example.com'), false);
  assert.equal(isTailscaleDnsHost('.ts.net'), false);
});

test('allows Tailscale UI origins on Stephanos ports and Tailscale Serve HTTPS', () => {
  for (const origin of [
    'http://100.88.0.2:4173',
    'http://100.88.0.2:5173',
    'http://desktop.example-tailnet.ts.net:4173',
    'https://desktop.example-tailnet.ts.net',
  ]) {
    assert.equal(isAllowedTailscaleFrontendOrigin(origin), true, origin);
  }
});

test('rejects non-Tailscale hosts, unexpected ports, credentials, and unsafe schemes', () => {
  for (const origin of [
    'http://192.168.0.10:4173',
    'http://100.88.0.2:8787',
    'http://user:password@100.88.0.2:4173',
    'file://100.88.0.2:4173',
    'https://example.com',
  ]) {
    assert.equal(isAllowedTailscaleFrontendOrigin(origin), false, origin);
  }
});
