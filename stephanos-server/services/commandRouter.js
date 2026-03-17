const slashMap = {
  help: { route: 'system', action: 'help' },
  status: { route: 'system', tool: 'getSystemStatus' },
  tools: { route: 'system', tool: 'listAvailableTools' },
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

function parseKgArgs(args = []) {
  const [subcommand = '', second = '', ...rest] = args;
  const normalizedSub = subcommand.toLowerCase();
  const normalizedSecond = second.toLowerCase();

  if (!subcommand || subcommand === 'help') {
    return { action: 'kg_help' };
  }

  if (normalizedSub === 'status') {
    return { tool: 'kgGetStatus' };
  }

  if (normalizedSub === 'stats') {
    return { tool: 'kgGetStats' };
  }

  if (normalizedSub === 'list' && normalizedSecond === 'nodes') {
    return { tool: 'kgListNodes' };
  }

  if (normalizedSub === 'list' && normalizedSecond === 'edges') {
    return { tool: 'kgListEdges' };
  }

  if (normalizedSub === 'add' && normalizedSecond === 'node') {
    const label = rest.filter((token) => !token.startsWith('--')).join(' ').trim();
    return {
      tool: 'kgCreateNode',
      args: {
        label,
        type: parseFlagValue(rest, 'type'),
        description: parseFlagValue(rest, 'description'),
        tags: parseFlagValue(rest, 'tags'),
      },
    };
  }

  if (normalizedSub === 'add' && normalizedSecond === 'edge') {
    const from = rest[0] ?? '';
    const to = rest[1] ?? '';
    return {
      tool: 'kgCreateEdge',
      args: {
        from,
        to,
        type: parseFlagValue(rest, 'type'),
        label: parseFlagValue(rest, 'label'),
      },
    };
  }

  if (normalizedSub === 'search') {
    return { tool: 'kgSearch', args: { query: [second, ...rest].join(' ').trim() } };
  }

  if (normalizedSub === 'related') {
    return { tool: 'kgFindRelated', args: { nodeId: second } };
  }

  return { action: 'invalid_kg_subcommand' };
}

function parseSimulateArgs(args = []) {
  const [subcommand = '', simulationId = '', ...rest] = args;
  const normalizedSub = subcommand.toLowerCase();

  if (!subcommand || normalizedSub === 'help') {
    return { action: 'simulate_help' };
  }

  if (normalizedSub === 'list') {
    return { tool: 'simList' };
  }

  if (normalizedSub === 'status') {
    return { tool: 'simGetStatus' };
  }

  if (normalizedSub === 'run') {
    const normalizedId = simulationId.toLowerCase();
    if (!normalizedId) {
      return { action: 'invalid_simulate_subcommand' };
    }

    if (normalizedId === 'trajectory-demo') {
      return {
        tool: 'simRun',
        args: {
          simulationId: normalizedId,
          input: {
            startValue: parseFlagValue(rest, 'start', 'startValue'),
            monthlyContribution: parseFlagValue(rest, 'monthly', 'monthlyContribution'),
            annualRate: parseFlagValue(rest, 'rate', 'annualRate'),
            years: parseFlagValue(rest, 'years'),
          },
        },
      };
    }

    return {
      tool: 'simRun',
      args: { simulationId: normalizedId, input: {} },
    };
  }

  return { action: 'invalid_simulate_subcommand' };
}

export function parseCommand(input = '') {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: 'empty', isSlash: false, command: null, args: [], raw: input };
  }

  if (trimmed.startsWith('/')) {
    const [command = '', ...args] = trimmed.slice(1).split(' ');
    const lowerCommand = command.toLowerCase();

    if (lowerCommand === 'memory') {
      const [subcommand = '', ...rest] = args;
      return {
        kind: 'slash',
        isSlash: true,
        command: 'memory',
        subcommand: subcommand.toLowerCase(),
        args: rest,
        raw: input,
      };
    }

    if (lowerCommand === 'kg') {
      return {
        kind: 'slash',
        isSlash: true,
        command: 'kg',
        args,
        kg: parseKgArgs(args),
        raw: input,
      };
    }

    if (lowerCommand === 'simulate') {
      return {
        kind: 'slash',
        isSlash: true,
        command: 'simulate',
        args,
        simulate: parseSimulateArgs(args),
        raw: input,
      };
    }

    return {
      kind: 'slash',
      isSlash: true,
      command: lowerCommand,
      args,
      raw: input,
    };
  }

  return { kind: 'natural', isSlash: false, command: null, args: [], raw: input };
}

function inferFromNaturalInput(input = '') {
  const normalized = input.toLowerCase();
  if (normalized.includes('system status')) {
    return { route: 'system', tool: 'getSystemStatus', reason: 'Natural language status inference' };
  }

  return { route: 'assistant', needsAI: true, reason: 'Natural language assistant request' };
}

export function resolveRoute(parsed, input) {
  if (parsed.kind === 'empty') {
    return { route: 'assistant', needsAI: false, action: 'empty', reason: 'Empty input' };
  }

  if (parsed.kind === 'natural') {
    return inferFromNaturalInput(input);
  }

  if (parsed.command === 'memory') {
    if (!parsed.subcommand) {
      return { route: 'memory', action: 'memory_help', reason: 'Memory command root' };
    }

    if (parsed.subcommand === 'list') {
      return { route: 'memory', tool: 'listMemory', reason: 'Memory list command' };
    }

    if (parsed.subcommand === 'save') {
      return {
        route: 'memory',
        tool: 'saveMemory',
        args: { text: parsed.args.join(' ') },
        reason: 'Memory save command',
      };
    }

    if (parsed.subcommand === 'find') {
      return {
        route: 'memory',
        tool: 'findMemory',
        args: { query: parsed.args.join(' ') },
        reason: 'Memory find command',
      };
    }

    return { route: 'memory', action: 'invalid_memory_subcommand', reason: 'Unknown memory subcommand' };
  }

  if (parsed.command === 'kg') {
    if (parsed.kg?.action === 'kg_help') {
      return { route: 'kg', action: 'kg_help', reason: 'Knowledge graph help command' };
    }

    if (parsed.kg?.action === 'invalid_kg_subcommand') {
      return { route: 'kg', action: 'invalid_kg_subcommand', reason: 'Unknown kg subcommand' };
    }

    if (parsed.kg?.tool) {
      return {
        route: 'kg',
        tool: parsed.kg.tool,
        args: parsed.kg.args,
        reason: `Knowledge graph command mapped to ${parsed.kg.tool}`,
      };
    }
  }

  if (parsed.command === 'simulate') {
    if (parsed.simulate?.action === 'simulate_help') {
      return { route: 'simulation', action: 'simulate_help', reason: 'Simulation help command' };
    }

    if (parsed.simulate?.action === 'invalid_simulate_subcommand') {
      return { route: 'simulation', action: 'invalid_simulate_subcommand', reason: 'Unknown simulate subcommand' };
    }

    if (parsed.simulate?.tool) {
      return {
        route: 'simulation',
        tool: parsed.simulate.tool,
        args: parsed.simulate.args,
        reason: `Simulation command mapped to ${parsed.simulate.tool}`,
      };
    }
  }

  if (slashMap[parsed.command]) {
    return { ...slashMap[parsed.command], needsAI: false, reason: `Slash command /${parsed.command}` };
  }

  return {
    route: 'assistant',
    needsAI: false,
    action: 'invalid_command',
    reason: `Unknown slash command /${parsed.command}`,
  };
}
