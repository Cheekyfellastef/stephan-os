// One source-defined compilation closure for the mobile native component.
// A file list is not source, release, enrollment or installation authority.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const declaration = JSON.parse(readFileSync(new URL('shared/agents/sovereignMobileInstallerNativeClosureV1.json', root)));
if (Object.keys(declaration).sort().join(',') !== 'maximumUnitBytes,paths,schemaVersion'
    || declaration.schemaVersion !== 'stephanos.mobile-installer-native-closure.v1'
    || declaration.maximumUnitBytes !== 32768 || declaration.paths.length !== 16
    || new Set(declaration.paths.map(path => path.toLowerCase())).size !== declaration.paths.length
    || declaration.paths.some(path => typeof path !== 'string'
      || !/^scripts\/windows\/Sovereign[A-Za-z0-9]+V1\.cs$/.test(path)))
  throw Error('MOBILE_NATIVE_CLOSURE_DECLARATION_UNPROVEN');
export const MOBILE_INSTALL_NATIVE_SOURCE_PATHS_V1 = Object.freeze([...declaration.paths]);
export function readMobileInstallerNativeSourceV1() {
  return MOBILE_INSTALL_NATIVE_SOURCE_PATHS_V1.map(path => {
    const url = new URL(path, root), bytes = readFileSync(url);
    if (bytes.length > declaration.maximumUnitBytes) throw Error('MOBILE_NATIVE_UNIT_BOUND:' + path);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return Object.freeze({ path, absolutePath: fileURLToPath(url), bytes });
  });
}
