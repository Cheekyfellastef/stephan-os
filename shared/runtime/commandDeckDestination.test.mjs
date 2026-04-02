import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCommandDeckDestinationPath,
  withCommandDeckDestination,
} from './commandDeckDestination.mjs';

test('resolveCommandDeckDestinationPath honors launcher meta when present', () => {
  const mockWindow = {
    location: { href: 'http://127.0.0.1:5173/?surface=cockpit', pathname: '/' },
    document: {
      querySelector(selector) {
        if (selector === 'meta[name="stephanos-launcher-shell-url"]') {
          return {
            getAttribute() {
              return 'https://example.github.io/stephan-os/';
            },
          };
        }

        return null;
      },
    },
  };

  assert.equal(resolveCommandDeckDestinationPath(mockWindow), 'https://example.github.io/stephan-os/');
});

test('resolveCommandDeckDestinationPath falls back to launcher query contract for cross-origin runtimes', () => {
  const encodedLauncher = encodeURIComponent('https://example.github.io/stephan-os/');
  const mockWindow = {
    location: {
      href: `http://127.0.0.1:5173/?surface=cockpit&stephanosLauncherShellUrl=${encodedLauncher}`,
      pathname: '/',
    },
    document: { querySelector() { return null; } },
  };

  assert.equal(resolveCommandDeckDestinationPath(mockWindow), 'https://example.github.io/stephan-os/');
});

test('withCommandDeckDestination injects launcher-shell URL contract for top-level launches', () => {
  const mockWindow = {
    location: {
      href: 'https://example.github.io/stephan-os/',
      pathname: '/stephan-os/',
    },
    document: { querySelector() { return null; } },
  };

  const launched = withCommandDeckDestination('http://127.0.0.1:5173/?surface=cockpit', mockWindow);
  const parsed = new URL(launched);

  assert.equal(parsed.origin, 'http://127.0.0.1:5173');
  assert.equal(parsed.searchParams.get('surface'), 'cockpit');
  assert.equal(parsed.searchParams.get('stephanosLauncherShellUrl'), 'https://example.github.io/stephan-os/');
});


test('resolveCommandDeckDestinationPath keeps localhost launcher origin for dev runtimes', () => {
  const encodedLauncher = encodeURIComponent('http://127.0.0.1:4173/');
  const mockWindow = {
    location: {
      href: `http://127.0.0.1:5173/?surface=cockpit&stephanosLauncherShellUrl=${encodedLauncher}`,
      origin: 'http://127.0.0.1:5173',
      pathname: '/',
    },
    document: { querySelector() { return null; } },
  };

  assert.equal(resolveCommandDeckDestinationPath(mockWindow), 'http://127.0.0.1:4173/');
});
