// One layout describes drawing and pointer routing for the existing wall.
// Local workspace pages do not acquire the connected app's input authority.
export const PANEL_CANVAS = Object.freeze({width:3072,height:954});
const rect=(x,y,w,h)=>({x:x/PANEL_CANVAS.width,y:y/PANEL_CANVAS.height,w:w/PANEL_CANVAS.width,h:h/PANEL_CANVAS.height});
export const HOLODECK_PANELS=Object.freeze([
  Object.freeze({id:'settings',title:'WORKSPACE SETTINGS',...rect(40,112,700,730)}),
  Object.freeze({id:'chatgpt',title:'CHATGPT',...rect(764,112,1544,730)}),
  Object.freeze({id:'tools',title:'AUDIO / CONNECTION',...rect(2332,112,700,730)}),
]);
export const CHATGPT_CONTENT=Object.freeze({x:784,y:254,w:1504,h:560,...PANEL_CANVAS});
const button=(panel,id,label,x,y,w=310,h=44,page=null)=>Object.freeze({panel,id,label,...rect(x,y,w,h),...(page?{page}:{})});
const left=62,right=408,wide=656,toolsLeft=2354,toolsRight=2700;
export const PANEL_BUTTONS=Object.freeze([
  button('settings','mode-seated','Seated',left,184),button('settings','mode-standing','Standing',right,184),
  button('settings','height-down','Height −',left,264),button('settings','height-up','Height +',right,264),
  button('settings','tilt-down','Tilt −',left,354),button('settings','tilt-up','Tilt +',right,354),
  button('settings','tilt-flat','Flat',left,408),button('settings','tilt-vertical','Vertical',right,408),
  button('settings','comfort-reset','Reset profile',left,462,wide),
  button('settings','furniture-keyboard','Keyboard',left,558),button('settings','furniture-table','Table',right,558),
  button('settings','furniture-left','Left 10 cm',left,612),button('settings','furniture-right','Right 10 cm',right,612),
  button('settings','furniture-away','Away 10 cm',left,662),button('settings','furniture-near','Near 10 cm',right,662),
  button('settings','furniture-up','Raise 5 cm',left,712),button('settings','furniture-down','Lower 5 cm',right,712),
  button('settings','furniture-reset','Reset selected position',left,764,wide),
  ...[['fit','Fit'],['zoom-out','Zoom −'],['zoom-in','Zoom +'],['pan-left','View ←'],['pan-right','View →'],['pan-up','View ↑'],['pan-down','View ↓']]
    .map(([id,label],i)=>button('chatgpt',id,label,784+i*216,190,208,42)),
  button('tools','tools-audio','Audio',toolsLeft,184),button('tools','tools-connection','Connection',toolsRight,184),
  button('tools','audio-refresh','Find microphone & speakers',toolsLeft,248,wide,46,'audio'),
  button('tools','audio-input-prev','Previous mic',toolsLeft,370,310,44,'audio'),button('tools','audio-input-next','Next mic',toolsRight,370,310,44,'audio'),
  button('tools','audio-output-prev','Previous output',toolsLeft,502,310,44,'audio'),button('tools','audio-output-next','Next output',toolsRight,502,310,44,'audio'),
  button('tools','audio-test-microphone','Test microphone',toolsLeft,568,310,48,'audio'),button('tools','audio-stop-microphone','Stop mic test',toolsRight,568,310,48,'audio'),
  button('tools','audio-test-speakers','Play speaker test',toolsLeft,678,wide,48,'audio'),
  button('tools','connection-probe','Check Windows helper',toolsLeft,248,wide,48,'connection'),
  button('tools','choose-window','Choose interactive window',toolsLeft,308,wide,48,'connection'),
  button('tools','window-prev','Previous window',toolsLeft,446,310,48,'connection'),button('tools','window-next','Next window',toolsRight,446,310,48,'connection'),
  button('tools','connect-window','Connect selected window',toolsLeft,506,wide,48,'connection'),
  button('tools','disconnect-window','Disconnect ChatGPT',toolsLeft,566,wide,48,'connection'),
]);
export function panelAt(u,v){
  if(!Number.isFinite(u)||!Number.isFinite(v))return null;
  return HOLODECK_PANELS.find(p=>u>=p.x&&u<=p.x+p.w&&v>=p.y&&v<=p.y+p.h)??null;
}
export function panelButtons(panelId,toolsPage='audio'){
  return PANEL_BUTTONS.filter(b=>b.panel===panelId&&(!b.page||b.page===toolsPage));
}
export function panelButtonAt(u,v,toolsPage='audio'){
  const panel=panelAt(u,v);if(!panel)return null;
  return panelButtons(panel.id,toolsPage).find(b=>u>=b.x&&u<=b.x+b.w&&v>=b.y&&v<=b.y+b.h)??null;
}
