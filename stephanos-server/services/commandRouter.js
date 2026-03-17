const slashMap = {
  help: { route: 'system', action: 'help' },
  status: { route: 'system', tool: 'getSystemStatus' },
  tools: { route: 'system', tool: 'listAvailableTools' },
  subsystems: { route: 'system', tool: 'listSubsystems' },
  agents: { route: 'system', tool: 'listAvailableAgents' },
  clear: { route: 'system', action: 'clear' },
};

function parseFlagValue(tokens, ...flagNames) {
  const allFlags = flagNames.map((name) => `--${name}`);
  const index = tokens.findIndex((token) => allFlags.includes(token));
  if (index < 0) return null;
  const values = [];
  for (let i = index + 1; i < tokens.length; i += 1) {
    if (tokens[i].startsWith('--')) break;
    values.push(tokens[i]);
  }
  return values.join(' ').trim();
}

function parseSimInputFlags(rest = []) {
  const flagMap = { startValue: ['start', 'startValue'], monthlyContribution: ['monthly', 'monthlyContribution'], annualRate: ['rate', 'annualRate'], years: ['years'] };
  return Object.entries(flagMap).reduce((acc, [key, aliases]) => {
    const value = parseFlagValue(rest, ...aliases);
    if (value !== null && value !== '') acc[key] = value;
    return acc;
  }, {});
}

export function parseKgCommand(args = []) {
  const [subcommand = '', second = '', ...rest] = args;
  const normalizedSub = subcommand.toLowerCase();
  const normalizedSecond = second.toLowerCase();
  if (!subcommand || normalizedSub === 'help') return { action: 'kg_help' };
  if (normalizedSub === 'status') return { tool: 'kgGetStatus' };
  if (normalizedSub === 'stats') return { tool: 'kgGetStats' };
  if (normalizedSub === 'list' && normalizedSecond === 'nodes') return { tool: 'kgListNodes' };
  if (normalizedSub === 'list' && normalizedSecond === 'edges') return { tool: 'kgListEdges' };
  if (normalizedSub === 'add' && normalizedSecond === 'node') {
    const label = rest.filter((token) => !token.startsWith('--')).join(' ').trim();
    return { tool: 'kgCreateNode', args: { label, type: parseFlagValue(rest, 'type'), description: parseFlagValue(rest, 'description'), tags: parseFlagValue(rest, 'tags') } };
  }
  if (normalizedSub === 'update' && normalizedSecond === 'node') {
    const [nodeId = '', ...flags] = rest;
    return { tool: 'kgUpdateNode', args: { id: nodeId, label: parseFlagValue(flags, 'label'), type: parseFlagValue(flags, 'type'), description: parseFlagValue(flags, 'description'), tags: parseFlagValue(flags, 'tags') } };
  }
  if (normalizedSub === 'delete' && normalizedSecond === 'node') return { tool: 'kgDeleteNode', args: { id: rest[0] ?? '' } };
  if (normalizedSub === 'delete' && normalizedSecond === 'edge') return { tool: 'kgDeleteEdge', args: { id: rest[0] ?? '' } };
  if (normalizedSub === 'add' && normalizedSecond === 'edge') return { tool: 'kgCreateEdge', args: { from: rest[0] ?? '', to: rest[1] ?? '', type: parseFlagValue(rest, 'type'), label: parseFlagValue(rest, 'label') } };
  if (normalizedSub === 'search') return { tool: 'kgSearch', args: { query: [second, ...rest].join(' ').trim() } };
  if (normalizedSub === 'related') return { tool: 'kgFindRelated', args: { nodeId: second } };
  return { action: 'invalid_kg_subcommand' };
}

export function parseSimulateCommand(args = []) {
  const [subcommand = '', second = '', ...rest] = args;
  const normalizedSub = subcommand.toLowerCase();
  const normalizedSecond = second.toLowerCase();
  if (!subcommand || normalizedSub === 'help') return { action: 'simulate_help' };
  if (normalizedSub === 'list') return { tool: 'simList' };
  if (normalizedSub === 'status') return { tool: 'simGetStatus' };
  if (normalizedSub === 'compare') return { tool: 'simCompareRuns', args: { runIdA: second, runIdB: rest[0] ?? '' } };
  if (normalizedSub === 'history') {
    if (!second || normalizedSecond === 'list') return { tool: 'simHistoryList' };
    if (normalizedSecond === 'show') return { tool: 'simHistoryShow', args: { runId: rest[0] ?? '' } };
    if (normalizedSecond === 'clear') return { tool: 'simHistoryClear' };
    return { action: 'invalid_simulate_subcommand' };
  }
  if (normalizedSub === 'preset') {
    if (!second || normalizedSecond === 'help') return { action: 'simulate_preset_help' };
    if (normalizedSecond === 'list') return { tool: 'simPresetList' };
    if (normalizedSecond === 'load') return { tool: 'simPresetLoad', args: { name: rest[0] ?? '' } };
    if (normalizedSecond === 'delete') return { tool: 'simPresetDelete', args: { name: rest[0] ?? '' } };
    if (normalizedSecond === 'save') return { tool: 'simPresetSave', args: { name: rest[0] ?? '', simulationId: parseFlagValue(rest.slice(1), 'simulation'), input: parseSimInputFlags(rest.slice(1)) } };
    return { action: 'invalid_simulate_subcommand' };
  }
  if (normalizedSub === 'run') return second ? { tool: 'simRun', args: { simulationId: normalizedSecond, input: parseSimInputFlags(rest), presetName: parseFlagValue(rest, 'preset') } } : { action: 'invalid_simulate_subcommand' };
  return { action: 'invalid_simulate_subcommand' };
}

export function parseSystemCommand(command, args = []) { if (!slashMap[command]) return null; return { ...slashMap[command], args }; }

export function parseCommand(input = '') {
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'empty', isSlash: false, command: null, args: [], raw: input };
  if (!trimmed.startsWith('/')) return { kind: 'natural', isSlash: false, command: null, args: [], raw: input };
  const [command = '', ...args] = trimmed.slice(1).split(' ');
  const lowerCommand = command.toLowerCase();
  const parsed = { kind: 'slash', isSlash: true, command: lowerCommand, args, raw: input };
  if (lowerCommand === 'memory' || lowerCommand === 'proposals' || lowerCommand === 'activity' || lowerCommand === 'roadmap') {
    const [subcommand = '', ...rest] = args;
    return { ...parsed, family: lowerCommand, subcommand: subcommand.toLowerCase(), args: rest };
  }
  if (lowerCommand === 'kg') return { ...parsed, family: 'kg', kg: parseKgCommand(args) };
  if (lowerCommand === 'simulate') return { ...parsed, family: 'simulation', simulate: parseSimulateCommand(args) };
  return { ...parsed, family: 'system', system: parseSystemCommand(lowerCommand, args) };
}

function inferFromNaturalInput(input = '') {
  return input.toLowerCase().includes('system status') ? { route: 'system', tool: 'getSystemStatus', reason: 'Natural language status inference' } : { route: 'assistant', needsAI: true, reason: 'Natural language assistant request' };
}

export function resolveRoute(parsed, input) {
  if (parsed.kind === 'empty') return { route: 'assistant', needsAI: false, action: 'empty', reason: 'Empty input' };
  if (parsed.kind === 'natural') return inferFromNaturalInput(input);

  if (parsed.command === 'memory') {
    if (!parsed.subcommand) return { route: 'memory', action: 'memory_help', reason: 'Memory command root' };
    if (parsed.subcommand === 'list') return { route: 'memory', tool: 'listMemory', reason: 'Memory list command' };
    if (parsed.subcommand === 'save') return { route: 'memory', tool: 'saveMemory', args: { text: parsed.args.join(' ') }, reason: 'Memory save command' };
    if (parsed.subcommand === 'find') return { route: 'memory', tool: 'findMemory', args: { query: parsed.args.join(' ') }, reason: 'Memory find command' };
    if (parsed.subcommand === 'propose') return { route: 'memory', tool: parsed.args[0] === 'recent' ? 'memoryProposeRecent' : 'memoryProposeById', args: parsed.args[0] === 'recent' ? {} : { id: parsed.args[0] }, reason: 'Memory proposal command' };
    return { route: 'memory', action: 'invalid_memory_subcommand', reason: 'Unknown memory subcommand' };
  }

  if (parsed.command === 'proposals') {
    if (!parsed.subcommand || parsed.subcommand === 'list') return { route: 'proposals', tool: 'proposalList', reason: 'Proposal list command' };
    if (parsed.subcommand === 'stats') return { route: 'proposals', tool: 'proposalStats', reason: 'Proposal stats command' };
    if (parsed.subcommand === 'show') return { route: 'proposals', tool: 'proposalShow', args: { id: parsed.args[0] }, reason: 'Proposal show command' };
    if (parsed.subcommand === 'accept') return { route: 'proposals', tool: 'proposalAccept', args: { id: parsed.args[0] }, reason: 'Proposal accept command' };
    if (parsed.subcommand === 'reject') return { route: 'proposals', tool: 'proposalReject', args: { id: parsed.args[0], reason: parsed.args.slice(1).join(' ') }, reason: 'Proposal reject command' };
    return { route: 'proposals', action: 'invalid_proposals_subcommand', reason: 'Unknown proposals subcommand' };
  }

  if (parsed.command === 'activity') {
    if (!parsed.subcommand || parsed.subcommand === 'list') return { route: 'activity', tool: 'activityList', reason: 'Activity list command' };
    if (parsed.subcommand === 'recent') return { route: 'activity', tool: 'activityRecent', reason: 'Activity recent command' };
    if (parsed.subcommand === 'show') return { route: 'activity', tool: 'activityShow', args: { id: parsed.args[0] }, reason: 'Activity show command' };
    return { route: 'activity', action: 'invalid_activity_subcommand', reason: 'Unknown activity subcommand' };
  }

  if (parsed.command === 'roadmap') {
    if (!parsed.subcommand || parsed.subcommand === 'list') return { route: 'roadmap', tool: 'roadmapList', reason: 'Roadmap list command' };
    if (parsed.subcommand === 'add') return { route: 'roadmap', tool: 'roadmapAdd', args: { text: parsed.args.join(' ') }, reason: 'Roadmap add command' };
    if (parsed.subcommand === 'done') return { route: 'roadmap', tool: 'roadmapDone', args: { id: parsed.args[0] }, reason: 'Roadmap done command' };
    if (parsed.subcommand === 'show') return { route: 'roadmap', tool: 'roadmapShow', args: { id: parsed.args[0] }, reason: 'Roadmap show command' };
    return { route: 'roadmap', action: 'invalid_roadmap_subcommand', reason: 'Unknown roadmap subcommand' };
  }

  const familyResult = parsed.kg ?? parsed.simulate ?? parsed.system;
  if (parsed.command === 'kg' || parsed.command === 'simulate') {
    if (familyResult?.action) return { route: parsed.command === 'kg' ? 'kg' : 'simulation', action: familyResult.action, reason: 'Family action routing' };
    if (familyResult?.tool) return { route: parsed.command === 'kg' ? 'kg' : 'simulation', tool: familyResult.tool, args: familyResult.args, reason: `Family command mapped to ${familyResult.tool}` };
  }
  if (slashMap[parsed.command]) return { ...slashMap[parsed.command], needsAI: false, reason: `Slash command /${parsed.command}` };
  return { route: 'assistant', needsAI: false, action: 'invalid_command', reason: `Unknown slash command /${parsed.command}` };
}
