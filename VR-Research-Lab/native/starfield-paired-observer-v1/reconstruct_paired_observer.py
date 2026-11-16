"""Deterministic, local-only reconstruction from an exact native owner checkout.

No commands, network, game access or executable loading are performed here.
Private owner expressions are extracted locally and never embedded in this module.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import shutil

ORIGINAL = {
    "native-boundary-trace.cpp": "f583c5917b11101781312d010564841f5d92b32d47349d8e2d10be8ce08fa2e7",
    "native-paired-output.h": "bbd7c4817b5fb2d500a41161161a81315e17361f8f7a0d09317dafce6d6d2041",
    "native-eye-capture.h": "f8175b0113266223b8c3bc3199eb023ddd22fc9b78c7e0bb9c02df6b1545de6e",
    "scoped-eye-ledger.h": "b4ba195c068cdc863e384f6345bc8eb644894f5db78d9d31d933418b19ec4cfd",
}
ORIGINAL_FILES = {'atomic-vtable-observer.h': {'sha256': '5190a7681cad4a59efbdbde2eb4604ab1e159a9089ec0ca461fc0b3eef100c04', 'bytes': 9335}, 'breakpoint-hooks.h': {'sha256': '1a61021ca6b96512abced67e81652b367d146325bb179752d5e0bd60abf38922', 'bytes': 6602}, 'callback-admission.h': {'sha256': '4ecdd779e80b642cb17b1d2e8dee9d1272e53c4ec8965f59a4ead59aac0e31b9', 'bytes': 799}, 'capture-readiness.h': {'sha256': '7dda196b89d1c0864330e6ecd4a30fda24591b31cd44c30fea2ed59d2e4251b9', 'bytes': 2875}, 'copy-queue-coverage.h': {'sha256': 'effdfb1f421881e57415cefedc52303a9f3c8d6754cb0b12aa8201aa7af42201', 'bytes': 5139}, 'copy-resource-access.h': {'sha256': 'b59ffd2ee56604282a8018fb912d4f1793782999fd4ce8ffe1c9145f59608678', 'bytes': 232}, 'eye-capture-ledger.h': {'sha256': 'b856ba96b9716f5a07380a71c63e916d1c9e9144e3d0e650fb34cf977e7ac4db', 'bytes': 12643}, 'eye-image-pair.h': {'sha256': '18508140a202dcfe32fdecbb7bb0ddaa2bc95bee48eb706edb69ad17e2407e85', 'bytes': 10014}, 'gpu-api-observer.h': {'sha256': '1c487d36c06a84d440264fd1ee4743c99a2290042497b3b5e52d29538b33de6b', 'bytes': 14846}, 'gpu-resource-facts.h': {'sha256': '1499f5a7b105d5e99d3665404ea904777445cf588d2f1a706b4eab99aab17cff', 'bytes': 5937}, 'native-allocation-manifest.h': {'sha256': '436fa609f64bc5a40b331866613a07c9fa823eb16e347aa55e9c126375eff598', 'bytes': 59580}, 'native-allocation-proof.h': {'sha256': '3ed989c599ce0588db927b8d6b09bbdd94ab59edfa4d2c915779c7bba80754b5', 'bytes': 1848}, 'native-boundary-trace.cpp': {'sha256': 'f583c5917b11101781312d010564841f5d92b32d47349d8e2d10be8ce08fa2e7', 'bytes': 49303}, 'native-camera-manifest.h': {'sha256': '6ef72ffc75e5424b83dbcb670b8faf80c9791c1b10958ec4434b58cfe5e8e12c', 'bytes': 848}, 'native-camera-owner.h': {'sha256': 'aed4f233731a208ef26acec6eefc88d8f0f81663ff074f7f2253c59b20e702f2', 'bytes': 5056}, 'native-camera-probe.h': {'sha256': 'b492925baae0b8b9850ba56c7efb261f59cf78384ddc1138612d314f7ab062a4', 'bytes': 3412}, 'native-dual-view-probe.h': {'sha256': 'e5a58c6e8c7ad3ab03994fe7fa4cb37514d3964604bd813ed6c64c60eb8e2274', 'bytes': 9676}, 'native-eye-capture.h': {'sha256': 'f8175b0113266223b8c3bc3199eb023ddd22fc9b78c7e0bb9c02df6b1545de6e', 'bytes': 27012}, 'native-eye-copy-queue.h': {'sha256': '7c9c298eb9e92065ca9c5c691dd852ad49fc6e5de081b6832d6e060bd1b028a2', 'bytes': 4402}, 'native-eye-identity.h': {'sha256': 'fb8df9fa55fa80bd35b1f9fcf2188dcf0250de5729a52758579bbde97f3afd43', 'bytes': 2690}, 'native-eye-manifest.h': {'sha256': '109f493031aba208c0530a6a101b520c34f7e4860743a7cc73a31e751d86391e', 'bytes': 180}, 'native-eye-output-adapter.h': {'sha256': '72845b3c90d16506bf87bad5fba9116045f88098636fa9fd7641b93aa9f85310', 'bytes': 10728}, 'native-eye-output-code.h': {'sha256': '2457b15af691c1e57b2a14b3f373ad58b192a0848e85d9f07e3c5afd73e1a776', 'bytes': 62469}, 'native-eye-output-plan.h': {'sha256': 'a7dc4a60009abfe99195cdf678030cd9926fb3369e7b3cfcadc94d61dfb4d777', 'bytes': 15643}, 'native-eye-output-result.h': {'sha256': 'd9319be9a47ed8cff089dfecf919b2e6ae067919a0770619f022ed3018304757', 'bytes': 8888}, 'native-film-output.h': {'sha256': '1ed45853a42985d50d9bd736f7cc855cc67d0b7c5f4ccf74cf96d472a7f85883', 'bytes': 2029}, 'native-gpu-com.h': {'sha256': 'c06f69231c074a3812776adf5688d99fff0f06e70c290ed2e47561b17ac6f8d6', 'bytes': 11632}, 'native-gpu-manifest.h': {'sha256': 'a0ce97a30741469fe08f1d3ed2224dcdff68a5d1fef7c89ced74dcb061eb28f0', 'bytes': 786}, 'native-gpu-order.h': {'sha256': '6cdeaefbbc4dae84d3ed1c4795171c89635dbf77a5a3a059b60ca35134beed03', 'bytes': 15094}, 'native-gpu-window.h': {'sha256': '5e60c6e1f05cc0767c5e9bef7001a647f63649cec6d16e785e3cce8f8ce66d57', 'bytes': 3156}, 'native-output-manifest.h': {'sha256': 'bf7f7c0538ecd968ae20b78d673b376faef83d72caeebd802c5dbcd0c0390964', 'bytes': 293}, 'native-output-map.h': {'sha256': 'b052b2541fb329123d52caf65869c89bbb7359a41a6a1e369185ea91ed04464d', 'bytes': 4789}, 'native-output-probe.h': {'sha256': '8fd66382717614a4a3c10d404933338e96b2ae31068b0e69105bf6ba2cb7dd90', 'bytes': 1726}, 'native-paired-output.h': {'sha256': 'bbd7c4817b5fb2d500a41161161a81315e17361f8f7a0d09317dafce6d6d2041', 'bytes': 7692}, 'native-parallel-manifest.h': {'sha256': 'dccbb2aca01f24f31a8ece831817eb1f9f45d4e609ad1d3361a8316310ce0ba7', 'bytes': 302}, 'native-parallel-output.cpp': {'sha256': '022d4e36ad532bfbb0373fd15a592f290b9dbe4f30bc3ef821997b04ff7fb2c2', 'bytes': 8330}, 'native-render-view.h': {'sha256': '303593eed84da74b300633a056cc205170353e590788b433c8ebf8894f12ed84', 'bytes': 9193}, 'native-resource-audit-probe.h': {'sha256': '89c07e4d623bcbd2bc5dce47278f935554899aa2936b12c09f099aaf2895c690', 'bytes': 6693}, 'native-resource-audit.h': {'sha256': '5dbc65040e9d9246ebdad06d7d456361653c0b64554c43c3dc356297290a646e', 'bytes': 12814}, 'native-rtv-binding.h': {'sha256': '738d9aae5034fec9887120cf72c2abd6185992aee4286f5532b360359d5c89cb', 'bytes': 1126}, 'native-rtv-manifest.h': {'sha256': '27bbcbc53b39797fe25fe9fb75de31901d5e5b8b6cf58d3030f55d11bea7ae30', 'bytes': 5245}, 'native-texture-description.h': {'sha256': '96ce6f6dfc91871da84569acdae7bd22e701aaad52825f404e693401fc1a72db', 'bytes': 3245}, 'native-trace-manifest.h': {'sha256': 'f1de03f73c22ff1c1c49ab86979b352d310baff229607fd5e452936e4436500c', 'bytes': 619}, 'native-view-binding-audit.h': {'sha256': 'b02104d548bb744293777dd1cc84797007bbd0d550c76f0bb4970a3663ea44d6', 'bytes': 11004}, 'native-view-binding-probe.h': {'sha256': '04d7174911e17378772332b042ffa20e27708c8dc9512632f90ce11b857b39a8', 'bytes': 8521}, 'native-view-lifecycle.h': {'sha256': '7ab44b087090927fa600f644fad29acba56a09d573bbbde2427d3705c868ae7b', 'bytes': 3024}, 'native-view-manifest.h': {'sha256': '7696bb8522bbc7ea471ab27f525fd0dc88f8681454a6d7de5f09c8d1d47a81a1', 'bytes': 3670}, 'native-worker-view.h': {'sha256': 'ac8e22a63f70f633b3a8466f4b5951a411844f71023e9f2a451de43a9c346dbb', 'bytes': 1003}, 'scoped-eye-ledger.h': {'sha256': 'b4ba195c068cdc863e384f6345bc8eb644894f5db78d9d31d933418b19ec4cfd', 'bytes': 12720}, 'stereo-frame-store.h': {'sha256': '3472b2db8524f28f827a9733c3febc04c670dfbc0e14dd70279f26b1c315059f', 'bytes': 18877}, 'stereo-probe.cpp': {'sha256': 'e083bb38c2016f885bc7ac276cde271a19ec609de688e9d2383d2999473184e1', 'bytes': 15575}, 'test-breakpoint-hooks.cpp': {'sha256': 'bc362d5aa28d78ee21999a16504e6e62999929c541dd81b2cdf89ae5759506b9', 'bytes': 6948}, 'test-capture-readiness.cpp': {'sha256': '67ddb9b28c06194438490741ce46aa3c66e93378d156f12ef9829a7f698a39a8', 'bytes': 2501}, 'test-copy-queue-coverage.cpp': {'sha256': '98bbe83dd3b2a9fcd440ef2b4504cfb2b7ad9f8acd00f121a8e46cf4e9064faa', 'bytes': 3013}, 'test-eight-hooks.cpp': {'sha256': 'd66a92bd5c905bedff95ef525242d16d875cb645bb12a0b567c0f0d0ba10c744', 'bytes': 2431}, 'test-eye-capture-ledger.cpp': {'sha256': '8650cde8c9332f07b6970cc037b3cf35a97e74b9e94299d06a2f30769bf8aa9b', 'bytes': 5299}, 'test-eye-image-pair.cpp': {'sha256': 'd67f1bb957c844cb919154eb8a78afcec5436f58f3655738ce3909c5804a772f', 'bytes': 3947}, 'test-film-output.cpp': {'sha256': 'abe95132b3f5ca92bf7a00d7f8a6108b0739a0977bb32bda28990f88d3c79684', 'bytes': 3932}, 'test-gpu-api-observer.cpp': {'sha256': '7f2b0ff1f6783bb82b35aec8d03b36ee51001b1cca6d8813cc2b23cdce2f74fa', 'bytes': 3413}, 'test-gpu-copy-observer.cpp': {'sha256': 'b616f6f65ac366e58e8dffd8f2422691c51269a0a7ed5d3469e2aa6606e302f1', 'bytes': 9525}, 'test-gpu-draw-observer.cpp': {'sha256': '035a280ba8cbf9f2e41492ca2b05f4428c0eaa5627833c2681606c6d05dcf1d3', 'bytes': 8530}, 'test-gpu-marker-omission.cpp': {'sha256': 'aef9a22858068443c84ebe9e6502b48451cdbc59153e7b3b39a3a16a34cae0a6', 'bytes': 1323}, 'test-gpu-resource-facts.cpp': {'sha256': 'f9fe640409871876d31ae2fe0b3683a745f175a3895be55fdd5acb3f137564f6', 'bytes': 4798}, 'test-gpu-scoped-snapshot.cpp': {'sha256': '2a124ae9b0a0db806a29a4f03b3fc74e223b621e2d98613f26acc0b8d6330436', 'bytes': 14082}, 'test-gpu-shared-observer.cpp': {'sha256': '492afbbb98d8085d0abc9ee0409f4e5edf76412031e61fc92e07f245c67030e3', 'bytes': 1456}, 'test-gpu-window.cpp': {'sha256': 'f1bb5f1086518734669c44ba6b1f92371e4ba2996cbd654b7624ae171851f779', 'bytes': 2895}, 'test-native-camera-owner.cpp': {'sha256': 'b0e7f72a45f8a50ab01f0006aa1c8dceb3d089b47a5c6450d637805bf0f30c4c', 'bytes': 4422}, 'test-native-eye-output-plan.cpp': {'sha256': '4af2ecb35d9aa0d528431253c9b3a01820ba1b867b08a8fbd3590956886962c5', 'bytes': 13458}, 'test-native-gpu-com.cpp': {'sha256': 'b3c229c3a55c4c19e759a2524229a5ba93315704c457c48f6120e9f64e626f75', 'bytes': 2357}, 'test-native-output-map.cpp': {'sha256': 'a69bb3431f243f05623eb823ed093914ffb89aecf58d2ffd333bfa94eec1975e', 'bytes': 3221}, 'test-native-render-view.cpp': {'sha256': 'c31d66078ae64b5fb652c04a6b0e10f52cde0423a6ad5cc34bb3e4b3919250d8', 'bytes': 7694}, 'test-native-resource-audit.cpp': {'sha256': 'f223f9172481edda6e79d89a3a90eb99f2bc95dade5858eed56727d46a920f89', 'bytes': 5282}, 'test-native-texture-description.cpp': {'sha256': 'a6269aae12d890a3c77e1b8b378a955bf5ed2e09a8d3fae3fc3080da105f1189', 'bytes': 1810}, 'test-native-view-binding-audit.cpp': {'sha256': '0d2c38aa98b2753bc25fd50708e4456f7f3bcf9c5dce025adcf4df482eeba5e9', 'bytes': 4954}, 'test-native-view-lifecycle.cpp': {'sha256': 'd641da540f0158fc9317cebc50030c0b00ee9e6d8e792c82acc1e6cfc889605f', 'bytes': 1992}, 'test-rtv-binding.cpp': {'sha256': '25d1441f53b7f7877cfc836e932c8a7cf4072c04e02769e85fbf423f03e10974', 'bytes': 1517}, 'test-scoped-eye-ledger.cpp': {'sha256': '16f7a8f9972dd72354fe82260a56c619c64e1dedd3624c58f01845d44a730ebf', 'bytes': 6269}, 'test-staged-hooks.cpp': {'sha256': '0b32d84de73061b966cda57744da15621ae13dc893c8861a97f69553fdd45a60', 'bytes': 3499}, 'test-stereo-frame-store.cpp': {'sha256': 'fd6142b6761ff6beee1aa2bea499cf5c0c373094dc765c21751650ca784416aa', 'bytes': 16612}, 'test-stereo-queue-fault.h': {'sha256': '4b5abb39a3801fbf8ff12fbef6ec44b2639fd9638071f339ad59069fd6307bba', 'bytes': 4643}, 'test-vtable-observer.cpp': {'sha256': '1d696e773a478755cd52d421561e5b6763a9daa6a94aaddb9368cd608c933f5b', 'bytes': 8767}, 'vendor/minhook/include/MinHook.h': {'sha256': 'c3608e584bd9659aebdbb4c8c82585605989193623f240552d35c43311b3d31a', 'bytes': 7715}, 'vendor/minhook/minhook.x64.lib': {'sha256': '8390df72c6b994e2cf9ceca456e099840fa8fb1884421c10be7895d67f115880', 'bytes': 45312}, 'vendor/minhook/src/buffer.c': {'sha256': '69045b390e0f18cf149ea0451ae750f389654eb8d2ed7f2f89c7ff04b7909519', 'bytes': 10126}, 'vendor/minhook/src/buffer.h': {'sha256': '175ec5496c020509cf4c7670322b51b5bcd5b63a345bfefc4a19b43675857fa7', 'bytes': 1862}, 'vendor/minhook/src/hde/hde32.c': {'sha256': '2d4d7dd73d609028822aaf71ac05112b83fe6cc2ae2d6d71fa051b3fc6acfc43', 'bytes': 9642}, 'vendor/minhook/src/hde/hde32.h': {'sha256': '754579fbcec5f64fa229646ceecb241c0b7f31c8a0bb12370e604c316c569315', 'bytes': 2555}, 'vendor/minhook/src/hde/hde64.c': {'sha256': '06b588a5140e15f0a55e13ddadc7e3a4648f3223cefab2d5285b796a422bb9f5', 'bytes': 9842}, 'vendor/minhook/src/hde/hde64.h': {'sha256': 'fd5b39e2865e12b9525ebda8fd9e9658b341ead5932d1bcb412a189f81ca42ca', 'bytes': 2714}, 'vendor/minhook/src/hde/pstdint.h': {'sha256': '975488009779ea99c7e04b83a160397d5cd7195cb5bf6ad79180805f756c7d00', 'bytes': 1701}, 'vendor/minhook/src/hde/table32.h': {'sha256': 'e56f8641bd9133c1b99a1e6555b19eebe7ed663e5ea8de4edbe74ba461161ab4', 'bytes': 3581}, 'vendor/minhook/src/hde/table64.h': {'sha256': '0b6c69ad498e67907e0c574ab06123aee4ec30c99fa181099ea929a8d820bfc1', 'bytes': 3651}, 'vendor/minhook/src/hook.c': {'sha256': 'c3d40749f9d4efd96d87716cc9105eafbaa8b32e94fb61c0ee820a5adfa263f7', 'bytes': 27051}, 'vendor/minhook/src/trampoline.c': {'sha256': '57a661dc765766c501d2ef60e324f20045c8e299e862ea7c8e3a00360219aa89', 'bytes': 10951}, 'vendor/minhook/src/trampoline.h': {'sha256': '23681f7768d5dbd23ea14b45ba64e488a337501f23122253c532b05dbed4b85f', 'bytes': 3864}}
PAIRED_LEDGER = "27473c981eeeb6584263241aa5d88c0e44131ad2850b8cbf524f0a06e4583452"
MEMBERS = (
    "paired-source-observation.h", "native-paired-source-observer.h", "scoped-eye-ledger.h",
    "test-paired-scoped-eye-ledger.cpp", "test-scoped-eye-ledger.cpp",
    "test-paired-source-observation.cpp", "test-paired-source-observer-source.py",
    "analyze-paired-source-observation.py", "build-paired-source-observe.cmd",
    "paired-observer-recipe.json", "reconstruct_paired_observer.py",
)
ARTIFACTS = ("test-scoped-eye-ledger.exe", "test-paired-scoped-eye-ledger.exe",
             "test-paired-source-observation.exe", "native-paired-source-observe-test.exe",
             "native-paired-source-observe.dll")
MARKER = "STEPHANOS_PAIRED_OBSERVER_BUILD_PASSED"

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def one(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise ValueError("non-unique transformation anchor")
    return text.replace(old, new, 1)

def capture(text: str, expression: str) -> str:
    values = re.findall(expression, text, re.MULTILINE)
    if len(values) != 1:
        raise ValueError("non-unique owner expression")
    return values[0]

def function(text: str, name: str) -> str:
    match = re.search(r"^(?:bool|uintptr_t|native_output::AllocationProof) " + re.escape(name) + r"\([^;]*?\) \{", text, re.MULTILINE)
    if not match:
        raise ValueError("missing owner function " + name)
    opening = text.index("{", match.start())
    depth = 1
    for index in range(opening + 1, len(text)):
        depth += (text[index] == "{") - (text[index] == "}")
        if depth == 0:
            return text[match.start():index + 1]
    raise ValueError("unterminated owner function")

def private_owner(eye: str, output: str) -> str:
    retained = [function(eye, name) for name in (
        "EyeChain", "EyeDescription", "EyeSameDescription", "EyeAllocationCodeIdentity",
        "EyeAllocation", "EyeList", "EyeView")]
    film = capture(eye, r"const auto mapped=(native_output::FilmOutput\([^;]+\));")
    film = film.replace("scope.pass", "pass").replace("scope.packet", "packet")
    view = capture(eye, r"const bool viewValid=(EyeView\([^;]+\));")
    for old, new in (("candidate.worker", "worker"), ("candidate.packet", "packet"),
                     ("candidate.view", "view"), ("candidate.eye", "role")):
        view = view.replace(old, new)
    counter = capture(eye, r"candidate\.counter=(Read<uint32_t>\([^;]+\));")
    constants = {
        "FilmCaller": capture(eye, r"reinterpret_cast<uintptr_t>\(_ReturnAddress\(\)\)-g_base==([^\s]+)"),
        "DrawCaller": capture(eye, r"event\.caller-g_base==([^\s]+)"),
        "TargetCaller": capture(eye, r"event\.caller-g_base!=([^\s]+)"),
        "SubmitCaller": capture(eye, r"bool nativeBatch=e\.caller-g_base==([^\s]+)"),
    }
    start = "struct Packet { uintptr_t items, collection, parent; uint16_t ordinal; };"
    block = output[output.index(start):output.index("auto& observation = g_outputObservations[index];", output.index(start))]
    observe = capture(output, r"observation\.result = (native_output::Observe\([^;]+\));")
    return "\n".join((
        "#pragma once", "// Generated privately from exact-hash original owner functions.",
        "namespace paired_native_owner {", *retained,
        *(f"constexpr uintptr_t {name}={value};" for name, value in constants.items()),
        "inline uint32_t Counter(){return " + counter + ";}",
        "inline native_output::Result FilmOutput(uintptr_t pass,uintptr_t packet){return " + film + ";}",
        "inline bool ScopeView(uintptr_t worker,uintptr_t packet,uint32_t& view,unsigned& role){return " + view + ";}",
        "inline native_output::Result MapOutput(uintptr_t pass,void* parent,void* container){", block,
        "return " + observe + ";}", "}", ""))

def transformed(original_root: Path, original_bytes=None) -> dict[str, bytes]:
    text = {name: ((original_bytes[name] if original_bytes is not None else (original_root / name).read_bytes()).decode("utf-8").replace("\r\n", "\n")) for name in ORIGINAL}
    boundary = text["native-boundary-trace.cpp"]
    boundary = one(boundary, '#ifdef STEPH_NATIVE_EYE_OUTPUT\n    swprintf_s(slash + 1, 32768 - (slash + 1 - path), L"native-eye-output-%lu.jsonl", GetCurrentProcessId());', '#ifdef STEPH_PAIRED_SOURCE_OBSERVE\n    swprintf_s(slash + 1, 32768 - (slash + 1 - path), L"native-paired-source-observe-%lu.jsonl", GetCurrentProcessId());\n#elif defined(STEPH_NATIVE_EYE_OUTPUT)\n    swprintf_s(slash + 1, 32768 - (slash + 1 - path), L"native-eye-output-%lu.jsonl", GetCurrentProcessId());')
    includes = """#ifdef STEPH_PAIRED_SOURCE_OBSERVE
#define STEPH_BOUNDARY_HOOK_LIMIT 7
#include "paired-source-observation.h"
#include "gpu-api-observer.h"
#include "gpu-resource-facts.h"
#include <new>
#include "native-eye-manifest.h"
#include "native-film-output.h"
#include "native-rtv-binding.h"
#include "native-rtv-manifest.h"
#include "native-allocation-proof.h"
#include "native-allocation-manifest.h"
#include "native-worker-view.h"
#elif defined(STEPH_EYE_IMAGE_PROBE)
"""
    boundary = one(boundary, "#ifdef STEPH_EYE_IMAGE_PROBE\n#define STEPH_BOUNDARY_HOOK_LIMIT 5\n", includes + "#define STEPH_BOUNDARY_HOOK_LIMIT 5\n")
    boundary = one(boundary, '#ifdef STEPH_EYE_IMAGE_PROBE\n#include "native-eye-capture.h"\n#endif',
        '#ifdef STEPH_EYE_IMAGE_PROBE\n#include "native-eye-capture.h"\n#endif\n#ifdef STEPH_PAIRED_SOURCE_OBSERVE\n#include "native-paired-source-observer.h"\n#endif')
    boundary = one(boundary, "    struct Hook { uintptr_t rva; void* detour; void** original; const unsigned char* bytes; } hooks[] = {", """#ifdef STEPH_PAIRED_SOURCE_OBSERVE
    if(memcmp(reinterpret_cast<void*>(g_base+EyeDrawRva),EyeDrawBytes,sizeof(EyeDrawBytes))
        || !paired_native_owner::EyeAllocationCodeIdentity()) {
        Write(output,"{\\"status\\":\\"rejected-paired-observer-owner\\"}\\n");CloseHandle(output);return 6;
    }
#endif
    struct Hook { uintptr_t rva; void* detour; void** original; const unsigned char* bytes; } hooks[] = {""")
    boundary = one(boundary, "#ifdef STEPH_EYE_IMAGE_PROBE\n        {EyeDrawRva,reinterpret_cast<void*>(EyeDraw),reinterpret_cast<void**>(&g_eyeDraw),EyeDrawBytes},\n#endif", """#ifdef STEPH_EYE_IMAGE_PROBE
        {EyeDrawRva,reinterpret_cast<void*>(EyeDraw),reinterpret_cast<void**>(&g_eyeDraw),EyeDrawBytes},
#endif
#ifdef STEPH_PAIRED_SOURCE_OBSERVE
        {EyeDrawRva,reinterpret_cast<void*>(paired_observe::Draw),reinterpret_cast<void**>(&paired_observe::originalDraw),EyeDrawBytes},
#endif""")
    boundary = one(boundary, "#ifdef STEPH_EYE_IMAGE_PROBE\n            eyeInitializationAttempted = true;", """#ifdef STEPH_PAIRED_SOURCE_OBSERVE
            eyeInitializationAttempted = true;
            const bool initialized = paired_observe::Initialize(g_outputCalibration.device);
#elif defined(STEPH_EYE_IMAGE_PROBE)
            eyeInitializationAttempted = true;""")
    boundary = one(boundary, "            if(ResourceAuditComplete() && EyeAllocationComplete() && EyeOutputDescriptionsComplete())break;", """#ifdef STEPH_PAIRED_SOURCE_OBSERVE
            if(paired_observe::Poll())break;
#else
            if(ResourceAuditComplete() && EyeAllocationComplete() && EyeOutputDescriptionsComplete())break;
#endif""")
    boundary = one(boundary, "    g_record.store(false, std::memory_order_release);\n#ifdef STEPH_NATIVE_EYE_OUTPUT", """    g_record.store(false, std::memory_order_release);
#ifdef STEPH_PAIRED_SOURCE_OBSERVE
    const bool pairedNativeDrained=!eyeInitializationAttempted || paired_observe::StopBeforeRestore();
#endif
#ifdef STEPH_NATIVE_EYE_OUTPUT""")
    boundary = one(boundary, "    bool disabled=allocationDrained && boundary_hooks::RestoreAll();", """#ifdef STEPH_PAIRED_SOURCE_OBSERVE
    bool disabled=allocationDrained && pairedNativeDrained && boundary_hooks::RestoreAll();
#else
    bool disabled=allocationDrained && boundary_hooks::RestoreAll();
#endif""")
    boundary = one(boundary, "    Sleep(250);\n#ifdef STEPH_EYE_IMAGE_PROBE", """    Sleep(250);
#ifdef STEPH_PAIRED_SOURCE_OBSERVE
    if(eyeInitializationAttempted)paired_observe::Finish(output);
    else Write(output,"{\\"pairedSourceObservation\\":true,\\"initializationAttempted\\":false,\\"pixelsCaptured\\":false}\\n");
#endif
#ifdef STEPH_EYE_IMAGE_PROBE""")
    boundary = one(boundary, "#ifdef STEPH_EYE_IMAGE_PROBE\n    if(!g_eyeRestored)", """#ifdef STEPH_PAIRED_SOURCE_OBSERVE
    if(eyeInitializationAttempted && !paired_observe::comRestored)terminalStatus="com-restoration-incomplete-game-exit-required";
    if(!disabled)terminalStatus="native-restoration-incomplete-game-exit-required";
#endif
#ifdef STEPH_EYE_IMAGE_PROBE
    if(!g_eyeRestored)""")
    boundary = one(boundary, "int main() {\n#ifdef STEPH_NATIVE_EYE_OUTPUT", """int main() {
#ifdef STEPH_PAIRED_SOURCE_OBSERVE
    if(!paired_observe::SelfTest())return 139;
#endif
#ifdef STEPH_NATIVE_EYE_OUTPUT""")
    output = one(text["native-paired-output.h"],
        "                struct AllocationObservationLease{~AllocationObservationLease(){g_resourceAuditGate.Leave();}} allocationLease;",
        """                struct AllocationObservationLease{~AllocationObservationLease(){g_resourceAuditGate.Leave();}} allocationLease;
#ifdef STEPH_PAIRED_SOURCE_OBSERVE
                paired_observe::Output(pass,parent,graphData,container);
#endif""")
    return {"native-boundary-trace.cpp": boundary.encode(), "native-paired-output.h": output.encode(),
            "native-paired-observer-owner.h": private_owner(text["native-eye-capture.h"], text["native-paired-output.h"]).encode()}

def reconstruct(original_root: Path, destination: Path, overlay_bytes: dict[str, bytes]) -> dict:
    original_root = Path(original_root).resolve(strict=True)
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError("destination must be fresh")
    if set(overlay_bytes) != set(MEMBERS) or any(not isinstance(v, bytes) for v in overlay_bytes.values()):
        raise ValueError("exact overlay members required")
    original_bytes = {}
    if destination.resolve().is_relative_to(original_root):
        raise ValueError("destination cannot be inside original")
    for name, expected in ORIGINAL_FILES.items():
        data = (original_root / name).read_bytes()
        original_bytes[name] = data
        if sha(data) != expected["sha256"] or len(data) != expected["bytes"]:
            raise ValueError("original owner hash mismatch: " + name)
    if sha(overlay_bytes["scoped-eye-ledger.h"]) != PAIRED_LEDGER:
        raise ValueError("paired model hash mismatch")
    if overlay_bytes["test-scoped-eye-ledger.cpp"] != (original_root / "test-scoped-eye-ledger.cpp").read_bytes():
        raise ValueError("legacy fixture changed")
    generated = transformed(original_root, original_bytes)
    # A compile closure only: no old DLL, executable, captured log or game file.
    closure = [original_root / name for name in ORIGINAL_FILES]
    if any(p.is_symlink() or any(parent.is_symlink() for parent in p.parents if parent != original_root.parent) for p in closure):
        raise ValueError("symlink in original compile closure")
    before = {str(p.relative_to(original_root)): sha(p.read_bytes()) for p in closure}
    destination.mkdir(parents=True, exist_ok=False)
    for p in closure:
        target = destination / p.relative_to(original_root);target.parent.mkdir(parents=True, exist_ok=True);target.write_bytes(original_bytes[str(p.relative_to(original_root))])
    for name, data in {**overlay_bytes, **generated}.items():
        (destination / name).write_bytes(data)
    if any(sha((original_root / name).read_bytes()) != digest for name, digest in before.items()):
        raise ValueError("original changed during reconstruction")
    members = {str(p.relative_to(destination)): {"sha256": sha(p.read_bytes()), "bytes": p.stat().st_size} for p in sorted(destination.rglob("*")) if p.is_file()}
    return {"schema": 1, "buildCommand": "build-paired-source-observe.cmd", "successMarker": MARKER,
            "artifacts": list(ARTIFACTS), "files": members,
            "originalCompileClosureMembers": len(before), "originalUnchanged": True,
            "nativeBuildPerformed": False, "gpuCopyCommandsIssued": False}
