import importlib.util,pathlib
spec=importlib.util.spec_from_file_location('package_reader',pathlib.Path(__file__).with_name('prepare-r7-hosted-native-package.py'))
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
globals().update({k:v for k,v in vars(reader).items() if not k.startswith('__')})

import unittest, copy, warnings, zlib
def fixture_pe(trailer):
    image=bytearray(128);image[:2]=b"MZ";struct.pack_into("<I",image,60,64);image[64:68]=b"PE\0\0";struct.pack_into("<H",image,68,0x8664);struct.pack_into("<H",image,88,0x20b);return bytes(image)+trailer
def zipped(entries):
    output=io.BytesIO()
    with zipfile.ZipFile(output,"w",compression=zipfile.ZIP_DEFLATED) as z:
        for name,body in entries:z.writestr(name,body)
    return output.getvalue()
def fixture(edit_pins=None,edit_parts=None,edit_manifest=None,outer_extra=None,inner_extra=None):
    head="a"*40;tree="b"*40
    images={"R7NativeQualification.sys":fixture_pe(b"driver"),"R7NativeQualificationClient.exe":fixture_pe(b"client")}
    parts=[{"name":name,"bytes":len(body),"sha256":sha(body)} for name,body in images.items()]
    if edit_parts:edit_parts(parts)
    manifest={"schemaVersion":"stephanos.r7-native-test-package.v1","sourceHead":head,"sourceTree":tree,"runId":"100","runAttempt":"1","components":copy.deepcopy(parts),"productionAuthority":False,"nativeCallbacksExecuted":False,"driverLoaded":False,"leaseChanged":False}
    if edit_manifest:edit_manifest(manifest)
    entries=list(images.items())+[("manifest.json",json.dumps(manifest).encode()),("README.txt",b"fixed fixture")]
    if inner_extra:entries+=inner_extra
    package=zipped(entries)
    pins={"schemaVersion":"stephanos.r7-native-test-package-pins.v1","sourceHead":head,"sourceTree":tree,"runId":"100","runAttempt":"1","archiveBytes":len(package),"archiveSha256":sha(package),"components":parts,"driverLoaded":False,"nativeCallbacksExecuted":False,"productionAuthority":False,"leaseChanged":False}
    if edit_pins:edit_pins(pins)
    outer=[("r7-native-test-package.zip",package),("r7-native-test-package-pins.json",json.dumps(pins).encode())]
    if outer_extra:outer+=outer_extra
    data=zipped(outer)
    return data,{"artifactArchiveSha256":sha(data),"sourceHead":head,"sourceTree":tree,"nativeRunId":100,"nativeRunAttempt":1}
class ReaderTests(unittest.TestCase):
    def test_valid_bound_package(self):
        data,expected=fixture();pins,package=inspect_package(data,expected);self.assertEqual(pins["archiveSha256"],sha(package))
    def test_outer_hash_splice(self):
        data,expected=fixture();expected["artifactArchiveSha256"]="0"*64
        with self.assertRaisesRegex(ValueError,"ARTIFACT_DIGEST"):inspect_package(data,expected)
    def test_unknown_outer_entry(self):
        data,expected=fixture(outer_extra=[("../outside",b"x")])
        with self.assertRaisesRegex(ValueError,"LAYOUT"):inspect_package(data,expected)
    def test_duplicate_outer_entry(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore");data,expected=fixture(outer_extra=[("r7-native-test-package.zip",b"x")])
        with self.assertRaisesRegex(ValueError,"LAYOUT"):inspect_package(data,expected)
    def test_unknown_inner_entry(self):
        data,expected=fixture(inner_extra=[("KernelLinkProbe.sys",b"x")])
        with self.assertRaisesRegex(ValueError,"LAYOUT"):inspect_package(data,expected)
    def test_unknown_pin_key(self):
        data,expected=fixture(edit_pins=lambda p:p.update(authorized=True))
        with self.assertRaisesRegex(ValueError,"SCHEMA"):inspect_package(data,expected)
    def test_wrong_source(self):
        data,expected=fixture(edit_pins=lambda p:p.update(sourceHead="0"*40))
        with self.assertRaisesRegex(ValueError,"SOURCE"):inspect_package(data,expected)
    def test_wrong_tree(self):
        data,expected=fixture(edit_pins=lambda p:p.update(sourceTree="0"*40))
        with self.assertRaisesRegex(ValueError,"SOURCE"):inspect_package(data,expected)
    def test_wrong_attempt(self):
        data,expected=fixture(edit_pins=lambda p:p.update(runAttempt="2"))
        with self.assertRaisesRegex(ValueError,"SOURCE"):inspect_package(data,expected)
    def test_previously_loaded_driver(self):
        data,expected=fixture(edit_pins=lambda p:p.update(driverLoaded=True))
        with self.assertRaisesRegex(ValueError,"AUTHORITY"):inspect_package(data,expected)
    def test_minted_authority(self):
        data,expected=fixture(edit_pins=lambda p:p.update(productionAuthority=True))
        with self.assertRaisesRegex(ValueError,"AUTHORITY"):inspect_package(data,expected)
    def test_wrong_nested_hash(self):
        data,expected=fixture(edit_pins=lambda p:p.update(archiveSha256="0"*64))
        with self.assertRaisesRegex(ValueError,"PACKAGE_DIGEST"):inspect_package(data,expected)
    def test_wrong_component_hash(self):
        data,expected=fixture(edit_parts=lambda p:p[0].update(sha256="0"*64))
        with self.assertRaisesRegex(ValueError,"COMPONENT_DIGEST"):inspect_package(data,expected)
    def test_component_scope_widening(self):
        data,expected=fixture(edit_parts=lambda p:p[0].update(path="C:/Windows"))
        with self.assertRaisesRegex(ValueError,"COMPONENT_DIGEST"):inspect_package(data,expected)
    def test_wrong_manifest_head(self):
        data,expected=fixture(edit_manifest=lambda p:p.update(sourceHead="0"*40))
        with self.assertRaisesRegex(ValueError,"MANIFEST"):inspect_package(data,expected)
    def test_duplicate_json_key(self):
        with self.assertRaisesRegex(ValueError,"DUPLICATE_JSON_KEY"):unique_json(b'{"a":1,"a":2}')
    def test_corrupt_crc(self):
        data,expected=fixture();value=bytearray(data);value[len(value)//3]^=255;expected["artifactArchiveSha256"]=sha(value)
        with self.assertRaises((ValueError,zipfile.BadZipFile,RuntimeError,EOFError,zlib.error)):inspect_package(bytes(value),expected)
    def test_unsupported_archive_method(self):
        output=io.BytesIO()
        with zipfile.ZipFile(output,"w",compression=zipfile.ZIP_LZMA) as z:z.writestr("fixed",b"x")
        with self.assertRaisesRegex(ValueError,"ARCHIVE_ENTRY"):fixed_zip(output.getvalue(),{"fixed":10})
unittest.main()
