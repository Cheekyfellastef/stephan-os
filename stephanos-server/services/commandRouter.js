const slashMap = {
  help: { route: 'system', action: 'help' },
  status: { route: 'system', tool: 'getSystemStatus' },
  tools: { route: 'system', tool: 'listAvailableTools' },
  agents: { route: 'system', tool: 'listAvailableAgents' },
  clear: { route: 'system', action: 'clear' },
};

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
