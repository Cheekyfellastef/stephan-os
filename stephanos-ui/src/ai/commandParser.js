export function parseCommand(input = '') {
  const trimmed = input.trim();

  if (!trimmed) {
    return { kind: 'empty', isSlash: false, command: null, args: [], raw: input };
  }

  if (trimmed.startsWith('/')) {
    const [commandRaw, ...args] = trimmed.slice(1).split(' ');
    const command = commandRaw.toLowerCase();
    const subcommand = command === 'memory' || command === 'kg' ? (args[0] ?? '').toLowerCase() : null;
    return {
      kind: 'slash',
      isSlash: true,
      command,
      subcommand,
      args: command === 'memory' ? args.slice(1) : args,
      raw: input,
    };
  }

  return { kind: 'natural', isSlash: false, command: null, args: [], raw: input };
}
