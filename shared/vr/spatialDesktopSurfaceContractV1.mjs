// A human-operated view of one existing app. This is not an agent command API.
export const SPATIAL_DESKTOP_SURFACE_SCHEMA='stephanos.spatial-desktop-surface.v1';
export function validateSpatialSurfaceInput(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const common=['kind','generation','sequence'];
  const fields={click:['x','y'],scroll:['x','y','delta'],text:['text'],key:['key']};
  if(!Object.hasOwn(fields,value.kind))return false;
  const keys=[...common,...fields[value.kind]];
  if(Object.keys(value).length!==keys.length||Object.keys(value).some(k=>!keys.includes(k)))return false;
  if(!Number.isSafeInteger(value.generation)||value.generation<1||!Number.isSafeInteger(value.sequence)||value.sequence<1)return false;
  if(value.kind==='click'||value.kind==='scroll') {
    if(![value.x,value.y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))return false;
    return value.kind==='click'||value.delta===120||value.delta===-120;
  }
  if(value.kind==='text')return typeof value.text==='string'&&value.text.length>0&&value.text.length<=256&&!/[\u0000-\u001f\u007f]/u.test(value.text);
  return ['Enter','Backspace','Tab','Escape','Left','Right'].includes(value.key);
}
