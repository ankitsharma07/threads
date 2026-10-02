import {THEMES} from './view-model.js';
// Reading fonts are local font stacks only; the reader never loads remote fonts.
export const FONTS={
  system:{label:'System',stack:'system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",sans-serif'},
  sans:{label:'Sans serif',stack:'Inter,"Segoe UI Variable Text","Segoe UI","Helvetica Neue",Helvetica,Arial,"Noto Sans",sans-serif'},
  serif:{label:'Serif',stack:'"Iowan Old Style",Charter,"Bitstream Charter",Georgia,Cambria,"Noto Serif",serif'},
  humanist:{label:'Humanist',stack:'Seravek,"Gill Sans Nova",Ubuntu,Calibri,"DejaVu Sans",source-sans-pro,sans-serif'},
  rounded:{label:'Rounded',stack:'ui-rounded,"SF Pro Rounded",Nunito,"Varela Round",Quicksand,system-ui,sans-serif'},
  legible:{label:'High legibility',stack:'"Atkinson Hyperlegible","Atkinson Hyperlegible Next",Lexend,Verdana,"DejaVu Sans",sans-serif'},
  mono:{label:'Monospace',stack:'ui-monospace,"SF Mono","Cascadia Code","JetBrains Mono",Consolas,"Liberation Mono",monospace'}
};
export const FONT_SIZES=[13,14,15,16,17,18,20];
export const LINE_SPACING={compact:1.45,comfortable:1.62,relaxed:1.8};
export const DEFAULTS={theme:'system',order:'chronological',allowRemoteContent:false,foldLongThreads:true,inlineAttachments:true,fontFamily:'system',fontSize:15,lineSpacing:'comfortable'};
const controls={theme:'theme',order:'order',allowRemoteContent:'remote-content',foldLongThreads:'fold-long-threads',inlineAttachments:'inline-attachments',fontFamily:'font-family',fontSize:'font-size',lineSpacing:'line-spacing'};
export function normalizePreference(key,value){
  if(key==='theme')return THEMES.includes(value)?value:DEFAULTS.theme;
  if(key==='order')return value==='reverse'?'reverse':'chronological';
  if(key==='fontFamily')return Object.hasOwn(FONTS,value)?value:DEFAULTS.fontFamily;
  if(key==='fontSize'){const size=Number(value);return FONT_SIZES.includes(size)?size:DEFAULTS.fontSize;}
  if(key==='lineSpacing')return Object.hasOwn(LINE_SPACING,value)?value:DEFAULTS.lineSpacing;
  return typeof value==='boolean'?value:DEFAULTS[key];
}
export function bindPreferences({document,messenger,onChange={},report=()=>{}}){
  if(document.createElement)fillTypographyControls(document);
  const values={...DEFAULTS},touched=new Set();
  function apply(key,value){values[key]=normalizePreference(key,value);const control=document.getElementById(controls[key]);
    if(typeof DEFAULTS[key]==='boolean')control.checked=values[key];else control.value=String(values[key]);
    onChange[key]?.(values[key]);
  }
  async function set(key,value){touched.add(key);apply(key,value);try{await messenger.storage.local.set({[key]:values[key]});}catch(e){report(e.message);}}
  for(const key of Object.keys(DEFAULTS)){apply(key,DEFAULTS[key]);const control=document.getElementById(controls[key]);control.onchange=()=>set(key,typeof DEFAULTS[key]==='boolean'?control.checked:control.value);}
  const ready=messenger.storage.local.get(Object.keys(DEFAULTS)).then(saved=>{for(const key of Object.keys(DEFAULTS))if(!touched.has(key))apply(key,saved[key]);}).catch(e=>report(e.message));
  messenger.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;for(const key of Object.keys(DEFAULTS))if(changes[key]){touched.add(key);apply(key,changes[key].newValue);}});
  return {set,ready,values};
}
// Typography is shared by the reader and the settings preview through CSS custom properties.
export function applyTypography(root,{fontFamily,fontSize,lineSpacing}){
  if(fontFamily!==undefined)root.style.setProperty('--reading-font',FONTS[fontFamily].stack);
  if(fontSize!==undefined)root.style.setProperty('--reading-size',`${fontSize}px`);
  if(lineSpacing!==undefined)root.style.setProperty('--reading-leading',String(LINE_SPACING[lineSpacing]));
}
// Builds the font, size and spacing pickers so the reader popover and settings page stay identical.
export function fillTypographyControls(document){
  const fill=(id,entries)=>{const select=document.getElementById(id);if(!select || select.options?.length || select.children?.length)return;for(const [value,label,font] of entries){const option=document.createElement('option');option.value=value;option.textContent=label;if(font)option.style.fontFamily=font;select.append(option);}};
  fill('font-family',Object.entries(FONTS).map(([key,font])=>[key,font.label,font.stack]));
  fill('font-size',FONT_SIZES.map(size=>[String(size),size===DEFAULTS.fontSize?`${size} px (default)`:`${size} px`]));
  fill('line-spacing',[['compact','Compact'],['comfortable','Comfortable'],['relaxed','Relaxed']]);
}
