// Optional acceptance commands on the existing owner-authenticated goal
// admission. This is a strict subset of the existing bounded test executor,
// never a shell, environment, dependency-install or mutation-scope grant.
export function projectGoalAdmissionRequiredTestsV1(value) {
  if (value === undefined) return Object.freeze({ valid: true, supplied: false, commands: Object.freeze([]) });
  const invalid = () => Object.freeze({ valid: false, supplied: true, commands: Object.freeze([]) });
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return invalid();
  const commands = [];
  for (const command of value) {
    if (typeof command !== 'string' || command.length > 256 || command !== command.trim()) return invalid();
    if (command !== 'npm run stephanos:verify') {
      const match = /^node --test ((?:scripts|shared|stephanos-server|packages|tests?)\/[A-Za-z0-9._/-]+\.test\.(?:mjs|cjs|js))$/.exec(command);
      if (!match || match[1].split('/').some(segment => !segment || segment === '.' || segment === '..'
          || ['.git', 'node_modules', 'dist', 'data', 'runtime-data', 'root-data'].includes(segment))) return invalid();
    }
    if (commands.includes(command)) return invalid();
    commands.push(command);
  }
  return Object.freeze({ valid: true, supplied: true, commands: Object.freeze(commands) });
}
