const PNG_SIGNATURE = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

function fail(reason){return Object.freeze({ok:false,reason,width:0,height:0});}
function pass(width,height,format){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1)return fail('dimensions-invalid');
  return Object.freeze({ok:true,width,height,format});
}

function inspectAvif(bytes){
  if(bytes.length<24||bytes.subarray(4,12).toString('ascii')!=='ftypavif')return fail('avif-signature-invalid');
  const marker=bytes.indexOf(Buffer.from('ispe'));
  if(marker<4||marker+16>bytes.length)return fail('avif-ispe-missing');
  return pass(bytes.readUInt32BE(marker+8),bytes.readUInt32BE(marker+12),'avif');
}

function inspectPng(bytes){
  if(bytes.length<24||!bytes.subarray(0,8).equals(PNG_SIGNATURE)||bytes.subarray(12,16).toString('ascii')!=='IHDR')return fail('png-signature-invalid');
  return pass(bytes.readUInt32BE(16),bytes.readUInt32BE(20),'png');
}

function inspectJpeg(bytes){
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return fail('jpeg-signature-invalid');
  const sof=new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  let offset=2;
  while(offset+3<bytes.length){
    if(bytes[offset]!==0xff){offset+=1;continue;}
    while(offset<bytes.length&&bytes[offset]===0xff)offset+=1;
    const marker=bytes[offset++];
    if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(offset+2>bytes.length)break;
    const length=bytes.readUInt16BE(offset);
    if(length<2||offset+length>bytes.length)break;
    if(sof.has(marker)){
      if(length<7)return fail('jpeg-sof-invalid');
      return pass(bytes.readUInt16BE(offset+3),bytes.readUInt16BE(offset+5),'jpeg');
    }
    offset+=length;
  }
  return fail('jpeg-sof-missing');
}

function readUInt24LE(bytes,offset){return bytes[offset]|(bytes[offset+1]<<8)|(bytes[offset+2]<<16);}
function inspectWebp(bytes){
  if(bytes.length<30||bytes.subarray(0,4).toString('ascii')!=='RIFF'||bytes.subarray(8,12).toString('ascii')!=='WEBP')return fail('webp-signature-invalid');
  const chunk=bytes.subarray(12,16).toString('ascii');
  if(chunk==='VP8X')return pass(readUInt24LE(bytes,24)+1,readUInt24LE(bytes,27)+1,'webp');
  return fail('webp-dimensions-unsupported');
}

function inspectSvg(bytes){
  const text=bytes.toString('utf8',0,Math.min(bytes.length,32*1024));
  const svg=text.match(/<svg\b[^>]*>/i)?.[0]||'';
  if(!svg)return fail('svg-root-missing');
  const width=Number(svg.match(/\bwidth=["']([0-9]+(?:\.[0-9]+)?)/i)?.[1]||0);
  const height=Number(svg.match(/\bheight=["']([0-9]+(?:\.[0-9]+)?)/i)?.[1]||0);
  if(width&&height)return pass(Math.round(width),Math.round(height),'svg');
  const viewBox=svg.match(/\bviewBox=["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)/i);
  if(viewBox)return pass(Math.round(Number(viewBox[1])),Math.round(Number(viewBox[2])),'svg');
  return fail('svg-dimensions-missing');
}

export function inspectMediaAssetBytes(bytes,extension){
  if(!Buffer.isBuffer(bytes)||bytes.length<1)return fail('bytes-missing');
  switch(String(extension||'').toLowerCase()){
    case 'avif': return inspectAvif(bytes);
    case 'png': return inspectPng(bytes);
    case 'jpg':
    case 'jpeg': return inspectJpeg(bytes);
    case 'webp': return inspectWebp(bytes);
    case 'svg': return inspectSvg(bytes);
    default: return fail('extension-unsupported');
  }
}
