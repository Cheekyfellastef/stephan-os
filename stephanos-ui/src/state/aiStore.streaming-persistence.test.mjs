import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname);
const source = fs.readFileSync(path.join(THIS_DIR, 'aiStore.js'), 'utf8');

test('aiStore restores streaming mode from canonical and compatibility persistence fields', () => {
  assert.match(source, /persistedSettings\.streamingMode\s*\?\?/);
  assert.match(source, /persistedSettings\.streamingModePreference\s*\?\?/);
  assert.match(source, /persistedSettings\.streaming_mode_preference\s*\?\?/);
  assert.match(source, /streamingModePreferenceRehydrated/);
  assert.match(source, /streamingPersistenceSource/);
});

test('aiStore persists streaming mode and metadata to providerPreferences', () => {
  assert.match(source, /streamingModePreference:\s*streamingMode/);
  assert.match(source, /streaming_mode_preference:\s*streamingMode/);
  assert.match(source, /streaming_persistence_updated_at:\s*streamingPersistenceUpdatedAt/);
  assert.match(source, /ollamaLoadMode,\s*\n\s*ollama_load_mode:\s*ollamaLoadMode/);
});

test('aiStore restores and normalizes ollama load mode from providerPreferences', () => {
  assert.match(source, /persistedSettings\.ollamaLoadMode\s*\?\?/);
  assert.match(source, /persistedSettings\.ollama_load_mode\s*\?\?/);
  assert.match(source, /normalizeOllamaLoadMode/);
});

test('aiStore setStreamingMode marks saved\/operator persistence metadata', () => {
  assert.match(source, /setStreamingMode = useCallback\(\(nextStreamingMode\) => \{/);
  assert.match(source, /setStreamingModePreferenceRehydrated\(true\)/);
  assert.match(source, /setStreamingPersistenceSource\('saved\/operator'\)/);
  assert.match(source, /setStreamingPersistenceUpdatedAt\(new Date\(\)\.toISOString\(\)\)/);
});
