import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const R7_PACKAGE_ARCHIVE_MAX_BYTES = 132 * 1024 * 1024;
const IMAGE_MAX=128*1024*1024, MANIFEST_MAX=16*1024, NOTICES_MAX=1024*1024;
const IMAGE='Stephanos.OriginalR7CustodyWitness.exe', MANIFEST='UNTRUSTED-CI-PACKAGE-MANIFEST.txt';
const LIMITS=new Map([[IMAGE,IMAGE_MAX],[MANIFEST,MANIFEST_MAX],['THIRD_PARTY_NOTICES.txt',NOTICES_MAX]]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireSafe=(ok,code)=>{ if(!ok) throw new Error('R7_UNTRUSTED_PACKAGE_'+code); };
const CRC=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
function crc(bytes){let n=0xffffffff;for(const b of bytes)n=CRC[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}

// In-memory, bounded readback of the existing unsigned CI package. Never write
// entries, load assemblies, execute the image, grant trust or admit a signer.
// Multi-entry support is intentionally separate from the canonical 256KiB
// one-entry independent-review ZIP contract. No limits on that contract change.
export function inspectR7UntrustedSourcePackage(archive, expected) {
  requireSafe(Buffer.isBuffer(archive)&&archive.length>=22&&archive.length<=R7_PACKAGE_ARCHIVE_MAX_BYTES,'ARCHIVE_LENGTH');
  requireSafe(hash(archive)===expected.bundleSha256,'ARCHIVE_HASH');
  const end=archive.length-22;
  requireSafe(archive.readUInt32LE(end)===0x06054b50&&archive.readUInt16LE(end+4)===0
    &&archive.readUInt16LE(end+6)===0&&archive.readUInt16LE(end+20)===0,'END_RECORD');
  const count=archive.readUInt16LE(end+10), centralSize=archive.readUInt32LE(end+12), central=archive.readUInt32LE(end+16);
  requireSafe(count>=2&&count<=3&&archive.readUInt16LE(end+8)===count
    &&central+centralSize===end&&central>=30,'CENTRAL_BOUNDS');
  const entries=new Map(); let cursor=central, localEnd=0, expanded=0;
  for(let i=0;i<count;i++) {
    requireSafe(cursor+46<=end&&archive.readUInt32LE(cursor)===0x02014b50,'CENTRAL_RECORD');
    const version=archive.readUInt16LE(cursor+6), flags=archive.readUInt16LE(cursor+8), method=archive.readUInt16LE(cursor+10);
    const checksum=archive.readUInt32LE(cursor+16), compressed=archive.readUInt32LE(cursor+20), size=archive.readUInt32LE(cursor+24);
    const nameLength=archive.readUInt16LE(cursor+28), extra=archive.readUInt16LE(cursor+30), comment=archive.readUInt16LE(cursor+32);
    const offset=archive.readUInt32LE(cursor+42), next=cursor+46+nameLength;
    requireSafe(version>=10&&version<=20&&(flags&~0x808)===0&&[0,8].includes(method)
      &&extra===0&&comment===0&&archive.readUInt16LE(cursor+34)===0&&next<=end,'ENTRY_FORMAT');
    const nameBytes=archive.subarray(cursor+46,next), name=new TextDecoder('utf-8',{fatal:true}).decode(nameBytes);
    requireSafe(LIMITS.has(name)&&!entries.has(name)&&Buffer.from(name).equals(nameBytes),'ENTRY_NAME');
    // Reject Unix symlink/special entry modes and Windows directory attributes.
    const attr=archive.readUInt32LE(cursor+38), unixType=(attr>>>16)&0xf000;
    requireSafe((unixType===0||unixType===0x8000)&&(attr&0x10)===0,'ENTRY_TYPE');
    expanded+=size;
    requireSafe(size>0&&size<=LIMITS.get(name)&&expanded<=IMAGE_MAX+MANIFEST_MAX+NOTICES_MAX
      &&compressed!==0xffffffff&&size!==0xffffffff&&offset===localEnd&&offset+30<=central,'ENTRY_SIZE_OR_OVERLAP');
    requireSafe(archive.readUInt32LE(offset)===0x04034b50
      &&archive.readUInt16LE(offset+4)===version&&archive.readUInt16LE(offset+6)===flags
      &&archive.readUInt16LE(offset+8)===method&&archive.readUInt16LE(offset+26)===nameLength
      &&archive.readUInt16LE(offset+10)===archive.readUInt16LE(cursor+12)
      &&archive.readUInt16LE(offset+12)===archive.readUInt16LE(cursor+14)
      &&archive.readUInt16LE(offset+28)===0
      &&archive.subarray(offset+30,offset+30+nameLength).equals(nameBytes),'LOCAL_RECORD');
    const start=offset+30+nameLength, finish=start+compressed, descriptor=(flags&8)!==0;
    requireSafe(finish+(descriptor?16:0)<=central,'PAYLOAD_BOUNDS');
    if(descriptor) {
      requireSafe(archive.readUInt32LE(offset+14)===0&&archive.readUInt32LE(offset+18)===0&&archive.readUInt32LE(offset+22)===0
        &&archive.readUInt32LE(finish)===0x08074b50&&archive.readUInt32LE(finish+4)===checksum
        &&archive.readUInt32LE(finish+8)===compressed&&archive.readUInt32LE(finish+12)===size,'DESCRIPTOR');
    } else requireSafe(archive.readUInt32LE(offset+14)===checksum&&archive.readUInt32LE(offset+18)===compressed
      &&archive.readUInt32LE(offset+22)===size,'LOCAL_SIZE');
    let bytes;
    if(method===0){requireSafe(size===compressed,'STORED_SIZE');bytes=archive.subarray(start,finish);}
    else {
      const inflated=inflateRawSync(archive.subarray(start,finish),{maxOutputLength:LIMITS.get(name),info:true});
      requireSafe(inflated.engine.bytesWritten===compressed,'DEFLATE_TRAILING_BYTES');bytes=inflated.buffer;
    }
    requireSafe(bytes.length===size&&crc(bytes)===checksum,'PAYLOAD_SIZE_OR_CRC');
    entries.set(name,{digest:hash(bytes),bytes:name===MANIFEST?Buffer.from(bytes):null});
    localEnd=finish+(descriptor?16:0);cursor=next;
  }
  requireSafe(cursor===end&&localEnd===central&&entries.has(IMAGE)&&entries.has(MANIFEST),'EXACT_ENTRY_ESTATE');
  requireSafe(entries.get(IMAGE).digest===expected.imageSha256&&entries.get(MANIFEST).digest===expected.manifestSha256,'IMAGE_OR_RAW_MANIFEST_HASH');
  const raw=entries.get(MANIFEST).bytes;
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(raw);
  const lines=text.split(/\r?\n/); if(lines.at(-1)==='')lines.pop();
  const actual=new Map();
  for(const line of lines){const m=/^([A-Za-z][A-Za-z0-9]*)=([^\r\n]*)$/.exec(line);requireSafe(m&&!actual.has(m[1]),'MANIFEST_RECORD');actual.set(m[1],m[2]);}
  const wanted={schemaVersion:'stephanos.original-r7-source-only-package.v1',repository:'Cheekyfellastef/stephan-os',
    sourceHead:expected.sourceHead,imageFile:IMAGE,imageSha256:expected.imageSha256,
    managedPayloadLayout:'SINGLE_FILE_WIN_X64_SELF_CONTAINED',binaryStatus:'UNSIGNED_UNCOMMISSIONED',
    protectedServiceSidQualified:'false',originalWriterProvenanceAuthenticated:'false',wholeSourceWriterExclusionProven:'false',
    signingAuthorityProven:'false',operatorApprovalProven:'false',physicalBattleBridgeCommissioned:'false',originalLeaseReleased:'false',historicalOutcome:'UNKNOWN'};
  requireSafe(actual.size===Object.keys(wanted).length&&Object.entries(wanted).every(([key,value])=>actual.get(key)===value),'MANIFEST_BINDING');
  return Object.freeze({classification:'R7_UNSIGNED_CI_PACKAGE_SOURCE_PROVENANCE_ONLY',
    sourceHead:expected.sourceHead,imageSha256:expected.imageSha256,bundleSha256:expected.bundleSha256,
    manifestSha256:expected.manifestSha256,entryCount:count,hostExecutionAuthorized:false,
    rootEnrollmentAuthorized:false,independentSignatureProven:false,canonicalLeaseReleaseAuthorized:false});
}
