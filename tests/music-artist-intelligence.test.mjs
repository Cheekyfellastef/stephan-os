import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveArtistIntelligence } from '../apps/music-tile/engine/musicArtistIntelligence.js';

test('Y do I resolves as known artist', () => { const r = resolveArtistIntelligence('Y do I'); assert.equal(r.status, 'resolved'); assert.equal(r.artist.canonicalName, 'Y do I'); });
test('Anyma includes Afterlife lane', () => { const r = resolveArtistIntelligence('Anyma'); assert.ok(r.artist.lanes.includes('Afterlife')); });
test('Sevdaliza includes ghost vocal lane', () => { const r = resolveArtistIntelligence('Sevdaliza'); assert.ok(r.artist.lanes.includes('ghost vocal')); });
test('Unknown artist unresolved', () => { const r = resolveArtistIntelligence('zzzz nobody'); assert.equal(r.status, 'unresolved'); });
