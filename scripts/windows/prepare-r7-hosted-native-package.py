"""Fixed two-layer CI package reader. No native code is executed."""
import hashlib, io, json, pathlib, struct, sys, zipfile
MAX_ARCHIVE = 3 * 1024 * 1024
def sha(data):
    return hashlib.sha256(data).hexdigest()
def unique_json(data):
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result: raise ValueError("DUPLICATE_JSON_KEY")
            result[key] = value
        return result
    return json.loads(data.decode("utf-8-sig"), object_pairs_hook=pairs)
def fixed_zip(data, names):
    if not 1 <= len(data) <= MAX_ARCHIVE: raise ValueError("ARCHIVE_SIZE")
    result = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        rows = archive.infolist()
        if len(rows) != len(names) or {x.filename for x in rows} != set(names):
            raise ValueError("ARCHIVE_LAYOUT")
        for row in rows:
            if row.is_dir() or row.flag_bits & 1 or row.compress_type not in (zipfile.ZIP_STORED,zipfile.ZIP_DEFLATED) or not 1 <= row.file_size <= names[row.filename]:
                raise ValueError("ARCHIVE_ENTRY")
            with archive.open(row) as reader: content = reader.read(names[row.filename]+1)
            if len(content) != row.file_size or len(content) > names[row.filename]:
                raise ValueError("ARCHIVE_ENTRY_LENGTH")
            result[row.filename] = content
    return result
def inspect_package(data, expected):
    if sha(data) != expected["artifactArchiveSha256"]: raise ValueError("ARTIFACT_DIGEST")
    outer = fixed_zip(data, {"r7-native-test-package.zip":2*1024*1024,
                             "r7-native-test-package-pins.json":16384})
    pins = unique_json(outer["r7-native-test-package-pins.json"])
    required = {"schemaVersion","sourceHead","sourceTree","runId","runAttempt","archiveBytes","archiveSha256","components","driverLoaded","nativeCallbacksExecuted","productionAuthority","leaseChanged"}
    if set(pins) != required or pins["schemaVersion"] != "stephanos.r7-native-test-package-pins.v1":
        raise ValueError("PACKAGE_PINS_SCHEMA")
    if pins["sourceHead"] != expected["sourceHead"] or pins["sourceTree"] != expected["sourceTree"] or str(pins["runId"]) != str(expected["nativeRunId"]) or str(pins["runAttempt"]) != str(expected["nativeRunAttempt"]):
        raise ValueError("PACKAGE_SOURCE")
    if any(pins[key] is not False for key in ("driverLoaded","nativeCallbacksExecuted","productionAuthority","leaseChanged")):
        raise ValueError("PACKAGE_AUTHORITY")
    package = outer["r7-native-test-package.zip"]
    if pins["archiveBytes"] != len(package) or pins["archiveSha256"] != sha(package):
        raise ValueError("PACKAGE_DIGEST")
    inner = fixed_zip(package, {"R7NativeQualification.sys":1048576,
                               "R7NativeQualificationClient.exe":1048576,
                               "manifest.json":16384,"README.txt":16384})
    parts = pins["components"]
    if not isinstance(parts,list) or len(parts) != 2: raise ValueError("COMPONENT_LAYOUT")
    for name in ("R7NativeQualification.sys","R7NativeQualificationClient.exe"):
        matching = [x for x in parts if isinstance(x,dict) and x.get("name") == name]
        if len(matching) != 1 or set(matching[0]) != {"name","bytes","sha256"} or matching[0]["bytes"] != len(inner[name]) or matching[0]["sha256"] != sha(inner[name]):
            raise ValueError("COMPONENT_DIGEST")
        image = inner[name]
        if len(image)<64 or image[:2] != b"MZ": raise ValueError("NATIVE_PE")
        offset = struct.unpack_from("<I",image,60)[0]
        if offset+26>len(image) or image[offset:offset+4] != b"PE\0\0" or struct.unpack_from("<H",image,offset+4)[0] != 0x8664 or struct.unpack_from("<H",image,offset+24)[0] != 0x20b:
            raise ValueError("NATIVE_X64_IMAGE")
    manifest = unique_json(inner["manifest.json"])
    if manifest.get("schemaVersion") != "stephanos.r7-native-test-package.v1" or manifest.get("sourceHead") != pins["sourceHead"] or manifest.get("sourceTree") != pins["sourceTree"] or str(manifest.get("runId")) != str(pins["runId"]) or str(manifest.get("runAttempt")) != str(pins["runAttempt"]) or manifest.get("components") != parts or any(manifest.get(key) is not False for key in ("productionAuthority","nativeCallbacksExecuted","driverLoaded","leaseChanged")):
        raise ValueError("PACKAGE_MANIFEST")
    return pins, package
def main(args):
    if len(args) != 3: raise ValueError("FIXED_ZIP_EXPECTATIONS_NEW_DIRECTORY_REQUIRED")
    source, expected_file, output = map(pathlib.Path,args)
    if source.stat().st_size > MAX_ARCHIVE or expected_file.stat().st_size > 16384:
        raise ValueError("INPUT_BOUND")
    expected = unique_json(expected_file.read_bytes())
    pins, package = inspect_package(source.read_bytes(),expected)
    output = output.parent.resolve(strict=True) / output.name
    output.mkdir(exist_ok=False)
    with (output/"r7-native-test-package.zip").open("xb") as writer: writer.write(package)
    with (output/"r7-native-test-package-pins.json").open("x",encoding="utf-8") as writer:
        writer.write(json.dumps(pins,indent=2)+"\n")
    print(json.dumps(pins))
    return 0
if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
