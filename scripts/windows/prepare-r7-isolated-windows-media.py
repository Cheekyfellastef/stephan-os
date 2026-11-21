#!/usr/bin/env python3
"""Extract fixed, hash-pinned evaluation WIM; never mount, apply or execute it.

No network or global package install. Call with ISO, pinned pycdlib wheel and a
new output directory. This prepares media, not execution or license authority.
"""
import hashlib
import json
import pathlib
import struct
import sys
import xml.etree.ElementTree as ET

IMAGE_BYTES = 5044094976
IMAGE_SHA256 = "3e4fa6d8507b554856fc9ca6079cc402df11a8b79344871669f0251535255325"
WIM_BYTES = 4340202461
WIM_SHA256 = "e073fe38d47d9832608ec4dff061cd5358f3924650dcd5c1b13456abc34eaac9"
WHEEL_SHA256 = "bfa0b3631345a14b2741fe088398b6b8dc2838442ea607fd07d027dcc67b9e94"


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_wim_metadata(stream, size):
    header = stream.read(208)
    if len(header) != 208 or header[:8] != b"MSWIM\0\0\0" or struct.unpack_from("<I", header, 8)[0] != 208:
        raise ValueError("WIM_HEADER_INVALID")
    if struct.unpack_from("<HH", header, 40) != (1, 1) or struct.unpack_from("<I", header, 44)[0] != 4:
        raise ValueError("WIM_IMAGE_LAYOUT_INVALID")
    length = int.from_bytes(header[72:79], "little")
    offset, original = struct.unpack_from("<QQ", header, 80)
    if not 1 <= length <= 1048576 or header[79] & ~2 or length != original or offset < 208 or offset + length > size:
        raise ValueError("WIM_XML_RESOURCE_INVALID")
    stream.seek(offset)
    xml = stream.read(length)
    if len(xml) != length:
        raise ValueError("WIM_XML_TRUNCATED")
    text = xml.decode("utf-16")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise ValueError("WIM_XML_DECLARATION_REJECTED")
    document = ET.fromstring(text)
    images = document.findall("IMAGE")
    if document.tag != "WIM" or len(images) != 4:
        raise ValueError("WIM_IMAGE_COUNT_INVALID")
    selected = [row for row in images if row.attrib.get("INDEX") == "1"]
    if len(selected) != 1:
        raise ValueError("WIM_INDEX_AMBIGUOUS")
    image = selected[0]
    expected = {"EDITIONID": "ServerStandardEval", "INSTALLATIONTYPE": "Server Core",
                "ARCH": "9", "VERSION/MAJOR": "10", "VERSION/MINOR": "0", "VERSION/BUILD": "20348",
                "VERSION/SPBUILD": "587", "LANGUAGES/LANGUAGE": "en-US"}
    if any(image.findtext("WINDOWS/" + key) != value for key, value in expected.items()):
        raise ValueError("WIM_FIXED_INDEX_IDENTITY_MISMATCH")
    return xml


def copy_bounded(source, destination, size):
    if not 1 <= size <= IMAGE_BYTES:
        raise ValueError("WIM_SIZE_INVALID")
    remaining = size
    digest = hashlib.sha256()
    with destination.open("xb") as output:
        while remaining:
            chunk = source.read(min(1024 * 1024, remaining))
            if not chunk or len(chunk) > remaining:
                raise ValueError("WIM_COPY_TRUNCATED")
            output.write(chunk)
            digest.update(chunk)
            remaining -= len(chunk)
        if source.read(1):
            raise ValueError("WIM_COPY_EXCEEDED")
        output.flush()
    return digest.hexdigest()


def main(args):
    if len(args) != 3:
        raise ValueError("EXPECTED_ISO_WHEEL_NEW_DIRECTORY")
    image, wheel, output = [pathlib.Path(value).absolute() for value in args]
    if image.is_symlink() or wheel.is_symlink() or not image.is_file() or not wheel.is_file():
        raise ValueError("REGULAR_INPUT_FILES_REQUIRED")
    if image.stat().st_size != IMAGE_BYTES or digest_file(image) != IMAGE_SHA256:
        raise ValueError("OFFICIAL_MEDIA_HASH_MISMATCH")
    if wheel.stat().st_size > 1048576 or digest_file(wheel) != WHEEL_SHA256:
        raise ValueError("ISO_PARSER_HASH_MISMATCH")
    # Resolve the existing parent before exclusive mkdir; never follow an output
    # name supplied by the image and never overwrite an existing directory.
    parent = output.parent.resolve(strict=True)
    output = parent / output.name
    output.mkdir(exist_ok=False)
    sys.path.insert(0, str(wheel.resolve(strict=True)))
    import pycdlib
    iso = pycdlib.PyCdlib()
    iso.open(str(image))
    try:
        if not iso.has_udf():
            raise ValueError("UDF_REQUIRED")
        size = iso.get_record(udf_path="/sources/install.wim").get_data_length()
        if size != WIM_BYTES:
            raise ValueError("FIXED_WIM_SIZE_MISMATCH")
        with iso.open_file_from_iso(udf_path="/sources/install.wim") as source:
            xml = read_wim_metadata(source, size)
            source.seek(0)
            wim_hash = copy_bounded(source, output / "install.wim", size)
        if wim_hash != WIM_SHA256:
            raise ValueError("FIXED_WIM_HASH_MISMATCH")
        (output / "metadata.xml").write_bytes(xml)
        result = {"schemaVersion": "stephanos.r7-isolated-media-stage.v1",
                  "imageSha256": IMAGE_SHA256, "imageBytes": IMAGE_BYTES,
                  "parserSha256": WHEEL_SHA256, "index": 1,
                  "wimBytes": size, "wimSha256": wim_hash,
                  "imageApplied": False, "guestCreated": False,
                  "driverLoaded": False, "productionAuthority": False}
        (output / "media.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result))
    finally:
        iso.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
