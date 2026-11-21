// One layout describes drawing and pointer routing for the existing wall.
// Local workspace pages do not acquire the connected app's input authority.
export const PANEL_CANVAS = Object.freeze({width:3072,height:954});
const rect=(x,y,w,h)=>({x:x/PANEL_CANVAS.width,y:y/PANEL_CANVAS.height,w:w/PANEL_CANVAS.width,h:h/PANEL_CANVAS.height});
export const HOLODECK_PANELS=Object.freeze([
  Object.freeze({id:'settings',title:'CONSOLE / SETTINGS',...rect(40,112,700,730)}),
  Object.freeze({id:'chatgpt',title:'SELECTED WINDOW',...rect(764,112,1544,730)}),
  Object.freeze({id:'tools',title:'AUDIO',...rect(2332,112,700,730)}),
]);
export const CHATGPT_CONTENT=Object.freeze({x:784,y:254,w:1504,h:560,...PANEL_CANVAS});
const button=(panel,id,label,x,y,w=310,h=44,page=null)=>Object.freeze({panel,id,label,...rect(x,y,w,h),...(page?{page}:{})});
const left=62,right=408,wide=656,toolsLeft=2354,toolsRight=2700;
export const WINDOW_ROWS_PER_PAGE=3;
export const PANEL_BUTTONS=Object.freeze([
  button('settings','left-console','Console',left,184),button('settings','left-settings','Settings',right,184),
  button('settings','choose-window','Choose interactive window',left,248,wide,48,'console'),
  button('settings','connection-probe','Check Windows helper',left,308,wide,44,'console'),
  ...Array.from({length:WINDOW_ROWS_PER_PAGE},(_,index)=>button('settings','window-row-'+index,'',left,390+index*46,wide,40,'console')),
  button('settings','window-prev','Previous page',left,536,310,44,'console'),button('settings','window-next','Next page',right,536,310,44,'console'),
  button('settings','connect-window','Connect selected window',left,592,wide,48,'console'),
  button('settings','disconnect-window','Disconnect window',left,650,wide,44,'console'),
  button('settings','mode-seated','Seated',left,252,310,42,'settings'),button('settings','mode-standing','Standing',right,252,310,42,'settings'),
  button('settings','height-down','Height −',left,332,310,40,'settings'),button('settings','height-up','Height +',right,332,310,40,'settings'),
  button('settings','tilt-down','Tilt −',left,416,310,40,'settings'),button('settings','tilt-up','Tilt +',right,416,310,40,'settings'),
  button('settings','tilt-flat','Flat',left,468,310,40,'settings'),button('settings','tilt-vertical','Vertical',right,468,310,40,'settings'),
  button('settings','comfort-reset','Reset profile',left,520,wide,40,'settings'),
  button('settings','furniture-keyboard','Keyboard',left,604,310,38,'settings'),button('settings','furniture-table','Table',right,604,310,38,'settings'),
  button('settings','furniture-left','Left 10 cm',left,652,310,38,'settings'),button('settings','furniture-right','Right 10 cm',right,652,310,38,'settings'),
  button('settings','furniture-away','Away 10 cm',left,696,310,38,'settings'),button('settings','furniture-near','Near 10 cm',right,696,310,38,'settings'),
  button('settings','furniture-up','Raise 5 cm',left,740,310,38,'settings'),button('settings','furniture-down','Lower 5 cm',right,740,310,38,'settings'),
  button('settings','furniture-reset','Reset selected position',left,784,wide,36,'settings'),
  ...[['fit','Fit'],['zoom-out','Zoom −'],['zoom-in','Zoom +'],['pan-left','View ←'],['pan-right','View →'],['pan-up','View ↑'],['pan-down','View ↓'],['scroll-up','Scroll ↑'],['scroll-down','Scroll ↓']]
    .map(([id,label],i)=>button('chatgpt',id,label,784+i*167,190,160,42)),
  button('tools','tools-audio','Local audio tests',toolsLeft,184,wide),
  button('tools','audio-refresh','Find microphone & speakers',toolsLeft,248,wide,46,'audio'),
  button('tools','audio-input-prev','Previous mic',toolsLeft,370,310,44,'audio'),button('tools','audio-input-next','Next mic',toolsRight,370,310,44,'audio'),
  button('tools','audio-output-prev','Previous output',toolsLeft,502,310,44,'audio'),button('tools','audio-output-next','Next output',toolsRight,502,310,44,'audio'),
  button('tools','audio-test-microphone','Test microphone',toolsLeft,568,310,48,'audio'),button('tools','audio-stop-microphone','Stop mic test',toolsRight,568,310,48,'audio'),
  button('tools','audio-test-speakers','Play speaker test',toolsLeft,678,wide,48,'audio'),
]);
export function panelAt(u,v){
  if(!Number.isFinite(u)||!Number.isFinite(v))return null;
  return HOLODECK_PANELS.find(p=>u>=p.x&&u<=p.x+p.w&&v>=p.y&&v<=p.y+p.h)??null;
}
export function panelButtons(panelId,toolsPage='audio',leftPage='console'){
  const page=panelId==='settings'?leftPage:toolsPage;
  return PANEL_BUTTONS.filter(b=>b.panel===panelId&&(!b.page||b.page===page));
}
export function panelButtonAt(u,v,toolsPage='audio',leftPage='console'){
  const panel=panelAt(u,v);if(!panel)return null;
  return panelButtons(panel.id,toolsPage,leftPage).find(b=>u>=b.x&&u<=b.x+b.w&&v>=b.y&&v<=b.y+b.h)??null;
}
