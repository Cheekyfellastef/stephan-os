// Canonical Battle Bridge host binaries. Authority-bearing recovery code must
// fail closed instead of resolving executables through PATH or the cwd.
export const BATTLE_BRIDGE_WINDOWS_HOST = Object.freeze({
  powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  node: 'C:\\Program Files\\nodejs\\node.exe',
  git: 'C:\\Program Files\\Git\\cmd\\git.exe',
});
