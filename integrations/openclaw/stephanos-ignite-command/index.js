import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { registerStephanosIgniteCommand } from './lib/recovery-update.mjs';

export default definePluginEntry({
  id: 'stephanos-ignite-command',
  name: 'Stephanos Ignite Command',
  description: 'Stephanos/OpenClaw ignition status plus authenticated fixed Battle Bridge recovery routes.',
  register(api) {
    registerStephanosIgniteCommand(api);
  },
});
