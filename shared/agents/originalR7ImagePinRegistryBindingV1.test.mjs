import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL(
  '../../src/windows/Stephanos.OriginalR7CustodyWitness/OriginalR7ImagePinPreflight.cs',
  import.meta.url,
), 'utf8');
const serviceKey = String.raw`SYSTEM\CurrentControlSet\Services\StephanosOriginalR7CustodyWitness`;

// Source-contract regressions, not installed-registry, containment or signer proof.
// The fixed Stage-B writer and SCM reader already use this protected service key.
function assertFixedPinReader(text) {
  const definition = /private const string ServiceKey\s*=\s*@"([^"]+)";/.exec(text);
  assert.ok(definition, 'the image reader must bind one fixed service key');
  assert.equal(definition[1], serviceKey, 'image and SCM readers must consume the staged pin');
  assert.match(text, /Registry\.LocalMachine\.OpenSubKey\(\s*ServiceKey, writable: false\)/);
  assert.match(text, /private const string DigestName = "PinnedImageSha256";/);
  assert.match(text, /registry is null \|\| registry\.GetValueKind\(DigestName\) != RegistryValueKind\.String/);
  assert.match(text, /registry\.GetValue\(DigestName, null,\s*RegistryValueOptions\.DoNotExpandEnvironmentNames\)/);
  assert.match(text, /return Held\("R7_IMAGE_PIN_NOT_PROVISIONED"\)/);
  assert.match(text, /return Evaluate\(Environment\.ProcessPath, pin\)/);
}

test('image-pin startup reads the fixed service registration staged by Stage-B', () => {
  assertFixedPinReader(source);
});

test('a Parameters-only or redirected pin reader cannot pass the binding contract', () => {
  for (const suffix of [String.raw`\Parameters`, String.raw`\OtherService`, ' ']) {
    const changed = source.replace(`@"${serviceKey}"`, `@"${serviceKey}${suffix}"`);
    assert.notEqual(changed, source, 'mutation must affect the actual key definition');
    assert.throws(() => assertFixedPinReader(changed));
  }
  const legacy = source.replaceAll('ServiceKey', 'ParametersKey')
    .replace(`@"${serviceKey}"`, `@"${serviceKey}\\Parameters"`);
  assert.throws(() => assertFixedPinReader(legacy));
});

test('the image pin is never read from a writable key, alternate hive or untyped value', () => {
  for (const [before, after] of [
    ['ServiceKey, writable: false', 'ServiceKey, writable: true'],
    ['Registry.LocalMachine.OpenSubKey', 'Registry.CurrentUser.OpenSubKey'],
    ['registry.GetValueKind(DigestName) != RegistryValueKind.String', 'false'],
    ['RegistryValueOptions.DoNotExpandEnvironmentNames', 'RegistryValueOptions.None'],
    ['return Evaluate(Environment.ProcessPath, pin)', 'return Held("PIN_ASSUMED", true)'],
  ]) {
    const changed = source.replace(before, after);
    assert.notEqual(changed, source, 'mutation must change the production reader');
    assert.throws(() => assertFixedPinReader(changed));
  }
});

test('a matched pin still cannot claim physical custody or lease release', () => {
  const preflight = source.slice(0, source.indexOf('internal sealed class OriginalR7NativeProvisioningSource'));
  assert.match(preflight, /=> new\(code, digestMatches, false, false, false, false\)/);
  assert.match(preflight, /return Held\("R7_IMAGE_DIGEST_MATCHED_PIN_UNATTESTED", true\)/);
  assert.doesNotMatch(preflight, /\b(?:SetValue|CreateSubKey|SetAccessControl|SignData|SignHash)\s*\(/);
});
