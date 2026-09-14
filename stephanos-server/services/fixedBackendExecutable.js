const WINDOWS_EXECUTABLES = Object.freeze({
  git: 'C:\\Program Files\\Git\\cmd\\git.exe',
  githubCli: 'C:\\Program Files\\GitHub CLI\\gh.exe',
  powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
});

const PORTABLE_EXECUTABLES = Object.freeze({
  git: 'git',
  githubCli: 'gh',
  powershell: 'powershell.exe',
});

export function fixedBackendExecutable(name, platform = process.platform) {
  const table = platform === 'win32' ? WINDOWS_EXECUTABLES : PORTABLE_EXECUTABLES;
  const executable = table[String(name || '')];
  if (!executable) throw new Error(`BACKEND_EXECUTABLE_NOT_ALLOWLISTED name=${String(name || '')}`);
  return executable;
}
