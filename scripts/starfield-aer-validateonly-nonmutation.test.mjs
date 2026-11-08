import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const script = readFileSync(resolve("scripts/windows/run-starfield-aer-stabilizer-observe.ps1"), "utf8");
function section(start, end) {
  const from = script.indexOf(start);
  const until = script.indexOf(end, from + start.length);
  assert.ok(from >= 0 && until > from, "expected bounded source function section");
  return script.slice(from, until);
}
const helpers = [
  section("function Require-File(", "function Start-StarfieldWithMetaAirLinkIsolation"),
  section("function Set-MutarConfigValue(", "function Validate-LocalState"),
].join("\n");
function hash(content) {
  return createHash("sha256").update(content).digest("hex");
}
function quote(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}

test("the actual AER entry forwards ValidateOnly into a read-only config guard", () => {
  assert.match(script, /\$config\s*=\s*Repair-ComfortableAerConfig\s+-ConfigPath\s+\$configPath\s+-ValidationOnly:\$ValidateOnly/);
  assert.match(helpers, /if \(\$ValidationOnly\) \{/);
  assert.match(helpers, /AER_VALIDATION_CONFIG_REPAIR_REQUIRED_NO_MUTATION/);
  assert.match(helpers, /return \$before/);
});

const scenarios = [
  ["valid LF", "VR_AsyncAER=false\nDLSS_AER_Enabled=true\nCreationEngine_MotionVectorFix=false\n", true],
  ["valid CRLF", "VR_AsyncAER=false\r\nDLSS_AER_Enabled=true\r\n", true],
  ["valid surrounding spaces", "VR_AsyncAER = false \r\nDLSS_AER_Enabled = true\r\n", true],
  ["missing async", "DLSS_AER_Enabled=true\n", false],
  ["duplicate async", "VR_AsyncAER=false\nVR_AsyncAER=true\nDLSS_AER_Enabled=true\n", false],
  ["invalid dlss", "VR_AsyncAER=false\nDLSS_AER_Enabled=false\n", false],
  ["motion uppercase TRUE", "VR_AsyncAER=false\nDLSS_AER_Enabled=true\nCreationEngine_MotionVectorFix=TRUE\n", false],
  ["motion mixed TrUe", "VR_AsyncAER=false\nDLSS_AER_Enabled=true\nCreationEngine_MotionVectorFix=TrUe\n", false],
  ["duplicate motion", "VR_AsyncAER=false\nDLSS_AER_Enabled=true\nCreationEngine_MotionVectorFix=false\nCreationEngine_MotionVectorFix=false\n", false],
];

for (const [name, contents, accepted] of scenarios) {
  test("disposable Windows AER ValidateOnly preserves file bytes/time: " + name,
    { skip: process.platform !== "win32" },
    () => {
      const dir = mkdtempSync(join(tmpdir(), "stephanos-vr2707-"));
      try {
        const config = join(dir, "vr_config.txt");
        const harness = join(dir, "run.ps1");
        writeFileSync(config, contents, "utf8");
        const beforeHash = hash(readFileSync(config));
        const originalTime = new Date("2020-01-01T00:00:00.000Z");
        // Preserve the original timestamp to catch subtle rewrites of identical bytes.
        utimesSync(config, originalTime, originalTime);
        const beforeTime = statSync(config).mtimeMs;
        const powershell = [
          "$ErrorActionPreference = 'Stop'",
          helpers,
          "$configPath = " + quote(config),
          "try { $null = Repair-ComfortableAerConfig -ConfigPath $configPath -ValidationOnly; Write-Output 'VERDICT_ACCEPT' }",
          "catch { Write-Output 'VERDICT_REJECT' }",
        ].join("\n");
        writeFileSync(harness, powershell, "utf8");
        const result = spawnSync("powershell.exe", [
          "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harness
        ], { encoding: "utf8", timeout: 30000 });
        assert.equal(result.status, 0, result.stderr);
        assert.ok(result.stdout.includes(accepted ? "VERDICT_ACCEPT" : "VERDICT_REJECT"), result.stdout);
        assert.equal(hash(readFileSync(config)), beforeHash, "ValidateOnly mutated real disposable bytes");
        assert.equal(statSync(config).mtimeMs, beforeTime, "ValidateOnly touched file timestamp");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
}
