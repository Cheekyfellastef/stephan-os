// Canonical Battle Bridge host binaries. Authority-bearing recovery code must
// fail closed instead of resolving executables through PATH or the cwd.
export const BATTLE_BRIDGE_WINDOWS_HOST = Object.freeze({
  cmd: 'C:\\Windows\\System32\\cmd.exe',
  powershell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  wscript: 'C:\\Windows\\System32\\wscript.exe',
  node: 'C:\\Program Files\\nodejs\\node.exe',
  npm: 'C:\\Program Files\\nodejs\\npm.cmd',
  git: 'C:\\Program Files\\Git\\cmd\\git.exe',
  tailscale: 'C:\\Program Files\\Tailscale\\tailscale.exe',
  githubCli: 'C:\\Program Files\\GitHub CLI\\gh.exe',
});
