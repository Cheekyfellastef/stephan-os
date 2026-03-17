import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('simulation-presets');
const PRESET_DIR = path.resolve(process.cwd(), 'data', 'simulations');
const PRESET_FILE = path.join(PRESET_DIR, 'presets.json');

function ensurePresetStorage() {
  if (!fs.existsSync(PRESET_DIR)) {
    fs.mkdirSync(PRESET_DIR, { recursive: true });
  }

  if (!fs.existsSync(PRESET_FILE)) {
    fs.writeFileSync(PRESET_FILE, JSON.stringify({ presets: [] }, null, 2), 'utf8');
  }
}

function readPresetsFile() {
  ensurePresetStorage();
  const raw = fs.readFileSync(PRESET_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.presets) ? parsed.presets : [];
}

function writePresetsFile(presets = []) {
  ensurePresetStorage();
  fs.writeFileSync(PRESET_FILE, JSON.stringify({ presets }, null, 2), 'utf8');
}

export function listPresets() {
  return readPresetsFile();
}

export function savePreset(name, simulationId, input) {
  const presetName = String(name ?? '').trim();
  if (!presetName) {
    throw new Error('Preset name is required.');
  }

  const presets = readPresetsFile();
  const now = new Date().toISOString();
  const existingIndex = presets.findIndex((preset) => preset.name.toLowerCase() === presetName.toLowerCase());
  const entry = {
    name: presetName,
    simulationId,
    input,
    updated_at: now,
    created_at: existingIndex >= 0 ? presets[existingIndex].created_at : now,
  };

  if (existingIndex >= 0) {
    presets[existingIndex] = entry;
  } else {
    presets.push(entry);
  }

  writePresetsFile(presets);
  logger.info('Simulation preset saved', { name: presetName, simulationId });
  return entry;
}

export function loadPreset(name) {
  const presetName = String(name ?? '').trim().toLowerCase();
  if (!presetName) {
    throw new Error('Preset name is required.');
  }

  const preset = readPresetsFile().find((entry) => entry.name.toLowerCase() === presetName);
  if (!preset) {
    throw new Error(`Simulation preset '${name}' was not found.`);
  }

  return preset;
}

export function getPresetStatus() {
  const presets = readPresetsFile();
  return {
    storage: PRESET_FILE,
    preset_count: presets.length,
  };
}
