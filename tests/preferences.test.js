import test from 'node:test';
import assert from 'node:assert/strict';
import {bindPreferences,normalizePreference,applyTypography,FONTS} from '../src/preferences.js';
import {bindIndexControls} from '../src/index-controls.js';
function surface(){const ids=new Map(['theme','order','remote-content','fold-long-threads','inline-attachments','font-family','font-size','line-spacing','pause','rescan'].map(id=>[id,{}]));return {getElementById:id=>ids.get(id)};}
test('Reader and add-on settings share saved preferences and synchronize both directions',async()=>{
  const data={theme:'navy',order:'reverse',allowRemoteContent:true,foldLongThreads:false},listeners=[];
  const messenger={storage:{local:{async get(){return {...data};},async set(values){const changes={};for(const [key,value] of Object.entries(values)){changes[key]={newValue:value};data[key]=value;}listeners.forEach(fn=>fn(changes,'local'));}},onChanged:{addListener(fn){listeners.push(fn);}}}};
  const reader=surface(),options=surface(),seen=[];
  const first=bindPreferences({document:reader,messenger,onChange:{order:value=>seen.push(value)}}),second=bindPreferences({document:options,messenger});await Promise.all([first.ready,second.ready]);
  assert.equal(reader.getElementById('theme').value,'navy');assert.equal(options.getElementById('order').value,'reverse');assert.equal(options.getElementById('remote-content').checked,true);assert.equal(reader.getElementById('fold-long-threads').checked,false);
  options.getElementById('theme').value='sepia';await options.getElementById('theme').onchange();assert.equal(reader.getElementById('theme').value,'sepia');
  reader.getElementById('order').value='chronological';await reader.getElementById('order').onchange();assert.equal(options.getElementById('order').value,'chronological');assert.equal(seen.at(-1),'chronological');
  await first.set('allowRemoteContent',false);assert.equal(options.getElementById('remote-content').checked,false);
  await second.set('foldLongThreads',true);assert.equal(reader.getElementById('fold-long-threads').checked,true);
  listeners.forEach(fn=>fn({theme:{newValue:'bogus'}},'local'));assert.equal(options.getElementById('theme').value,'system');
});
test('A delayed preference read cannot overwrite a newer user choice',async()=>{
  let release;const document=surface(),messenger={storage:{local:{get:()=>new Promise(r=>release=r),async set(){}},onChanged:{addListener(){}}}};
  const binding=bindPreferences({document,messenger});await binding.set('theme','black');release({theme:'light'});await binding.ready;assert.equal(document.getElementById('theme').value,'black');
});
test('Index actions and live status update every settings surface',async()=>{
  const listeners=[],requests=[],document=surface(),messenger={storage:{onChanged:{addListener(fn){listeners.push(fn);}}},runtime:{async sendMessage(msg){requests.push(msg.type);return msg.type==='status'?{indexingEnabled:false}:{enabled:true};}}};
  const reports=[];bindIndexControls({document,messenger,report:message=>reports.push(message)});await new Promise(r=>setImmediate(r));assert.equal(document.getElementById('pause').textContent,'Resume indexing');
  await document.getElementById('pause').onclick();assert.equal(document.getElementById('pause').textContent,'Pause indexing');listeners[0]({indexingEnabled:{newValue:false}},'local');assert.equal(document.getElementById('pause').textContent,'Resume indexing');
  await document.getElementById('rescan').onclick();assert.deepEqual(requests,['status','pause','rescan']);assert.equal(reports.at(-1),'Mailbox rescan started');
});

test('Typography preferences reject unknown values and map to CSS variables',()=>{
  assert.equal(normalizePreference('fontFamily','comic'),'system');assert.equal(normalizePreference('fontFamily','serif'),'serif');
  assert.equal(normalizePreference('fontSize','17'),17);assert.equal(normalizePreference('fontSize',99),15);assert.equal(normalizePreference('lineSpacing','airy'),'comfortable');
  const set={};applyTypography({style:{setProperty:(k,v)=>{set[k]=v;}}},{fontFamily:'serif',fontSize:17,lineSpacing:'relaxed'});
  assert.deepEqual(set,{'--reading-font':FONTS.serif.stack,'--reading-size':'17px','--reading-leading':'1.8'});
});
