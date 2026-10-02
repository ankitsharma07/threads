import {bindPreferences,applyTypography} from './preferences.js';
import {bindIndexControls} from './index-controls.js';
const report=message=>{document.getElementById('status').textContent=message;};
const root=document.documentElement;
bindPreferences({document,messenger,onChange:{theme:value=>{root.dataset.theme=value;},fontFamily:fontFamily=>applyTypography(root,{fontFamily}),fontSize:fontSize=>applyTypography(root,{fontSize}),lineSpacing:lineSpacing=>applyTypography(root,{lineSpacing})},report});
bindIndexControls({document,messenger,report});
