import test from 'node:test';
import assert from 'node:assert/strict';
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={setProperty(){}};this.attributes={};this.classList={toggle(){}};this.clientHeight=800;this.scrollTop=0;}
  get childNodes(){return this.children;}
  get firstChild(){return this.children[0];}
  prepend(...nodes){for(const node of nodes){node.parent=this;this.children.unshift(node);}}
  set textContent(text){this.text=String(text);}
  get textContent(){return this.text||this.children.map(c=>c.textContent).join('');}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  insertBefore(node,reference){if(node.parent)node.parent.children=node.parent.children.filter(c=>c!==node);const index=reference?this.children.indexOf(reference):-1;node.parent=this;if(index<0)this.children.push(node);else this.children.splice(index,0,node);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(){}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  contains(node){return node===this || this.children.some(child=>child.contains(node));}
  focus(){}
  remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
  getBoundingClientRect(){return {height:100};}
}
const ids=new Map(['scroller','list','empty','pause','subject','summary','count','status','original','rescan','refresh','theme','order','loading','loading-bar','loading-label','address-menu','thread-group','remote-content','fold-long-threads','inline-attachments','font-family','font-size','line-spacing','settings','card-menu'].map(id=>[id,new Element('div')]));
globalThis.document={getElementById:id=>ids.get(id),createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),addEventListener(){},documentElement:new Element('html')};
globalThis.location={href:'moz-extension://threads/src/reader.html?tabId=9'};
globalThis.window={innerWidth:1000,innerHeight:800,addEventListener(){}};
globalThis.ResizeObserver=class{observe(){}unobserve(){}};
globalThis.requestAnimationFrame=()=>0;
const originalInterval=globalThis.setInterval;globalThis.setInterval=()=>0;
let copied;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{async writeText(text){copied=text;}}}});
let storageListener;let readerListener,threadGate=null,bodyGate=null;const requests=[],changes=[];
const messages=[1,2,3].map(i=>({messageId:`m${i}`,date:i,author:`Sender ${i} <sender${i}@example.com>`,recipients:['to@example.com'],size:100,subject:'Test'}));
globalThis.messenger={runtime:{onMessage:{addListener(fn){readerListener=fn;}},async sendMessage(msg){requests.push(msg);if(msg.type==='thread'){if(threadGate)await threadGate;return {messages,selected:'m1',viewKey:'root',status:{indexingEnabled:true},discoveryPending:!!threadGate};}if(msg.type==='addressBooks')return [{id:'personal',name:'Personal Address Book'}];if(msg.type==='addressAction')return {message:'Done'};if(msg.type==='bodies'){if(bodyGate)await bodyGate;return msg.ids.map(id=>({id,body:{messageId:id,size:100,parserVersion:7,text:'Email body',blocks:[{type:'text',text:'Email body'},{type:'code',text:'  const x = 1;\n\n\treturn x;',language:'js'}]}}));}return true;}},storage:{local:{async get(){return {};},async set(value){changes.push(value);}},onChanged:{addListener(fn){storageListener=fn;}}}};
ids.get('list').append(ids.get('thread-group'));
await import('../src/reader.js');const {HOVER_DELAY}=await import('../src/address-menu.js');globalThis.setInterval=originalInterval;
const settle=()=>new Promise(r=>setImmediate(r));await settle();
const messageRows=()=>ids.get('list').children.filter(r=>r.dataset.id);
const row=id=>ids.get('list').children.find(r=>r.dataset.id===id);
const meta=id=>row(id).children[0].children[0];
const find=(node,match)=>match(node)?node:node.children?.reduce((found,child)=>found || find(child,match),null);
const position=node=>ids.get('list').children.indexOf(node);
const body=id=>find(row(id),c=>c.className==='body');
test('Reader collapses old messages and fetches only the latest expanded body',()=>{
  assert.equal(row('m1').dataset.state,'collapsed');assert.equal(row('m2').dataset.state,'collapsed');assert.equal(row('m3').dataset.state,'ready');
  assert.deepEqual(requests.filter(r=>r.type==='bodies').flatMap(r=>r.ids),['m3']);
});
test('Header toggles older messages open and closed with accessible state',async()=>{
  meta('m1').onclick();await settle();assert.equal(row('m1').dataset.state,'ready');assert.equal(meta('m1').attributes['aria-expanded'],'true');
  meta('m1').onclick();await settle();assert.equal(row('m1').dataset.state,'collapsed');assert.equal(meta('m1').attributes['aria-expanded'],'false');
});
test('Actions are icons after the body and copy buttons use bare email addresses',async()=>{
  const latest=row('m3'),actions=latest.children.at(-1).children.at(-1);assert.equal(actions.className,'message-actions');
  assert.deepEqual(actions.children.map(b=>b.attributes['aria-label']),['Reply','Reply all','Forward']);
  await actions.children[1].onclick();assert.ok(requests.some(r=>r.type==='compose' && r.messageId==='m3' && r.action==='replyAll'));
  const addresses=find(latest,c=>c.tagName==='dl'),copy=find(addresses.children[1],c=>c.className==='copy-address');await copy.onclick();assert.equal(copied,'sender3@example.com');
});
test('Changing order reorders rows and preserves expansion; pitch black persists',()=>{
  ids.get('order').value='reverse';ids.get('order').onchange();assert.equal(row('m3').dataset.index,0);assert.equal(row('m1').dataset.index,2);assert.equal(row('m1').dataset.state,'collapsed');
  ids.get('theme').value='black';ids.get('theme').onchange();assert.equal(document.documentElement.dataset.theme,'black');assert.deepEqual(changes.at(-1),{theme:'black'});
});

test('Code uses inert pre/code nodes with indentation and blank lines preserved',()=>{
  const pre=body('m3').children.find(c=>c.tagName==='pre');assert.equal(pre.children[0].tagName,'code');assert.equal(pre.children[0].textContent,'  const x = 1;\n\n\treturn x;');
});
test('Refresh shows progress immediately and stays active until thread discovery completes',async()=>{
  let release;threadGate=new Promise(resolve=>{release=resolve;});
  const refresh=ids.get('refresh').onclick();assert.equal(ids.get('loading').hidden,false);assert.equal(ids.get('loading-label').textContent,'Reading thread metadata…');
  release();await refresh;await settle();const request=requests.filter(r=>r.type==='thread').at(-1);
  assert.equal(ids.get('loading-label').textContent,'Finding sent replies…');
  readerListener({type:'threadDiscovery',tabId:9,requestId:request.requestId-1});assert.equal(ids.get('scroller').attributes['aria-busy'],'true');
  readerListener({type:'threadDiscovery',tabId:9,requestId:request.requestId});assert.equal(ids.get('scroller').attributes['aria-busy'],'false');threadGate=null;
  await new Promise(resolve=>setTimeout(resolve,270));assert.equal(ids.get('loading').hidden,true);
});
test('Opening an uncached body shows loading and parser stages until ready',async()=>{
  let release;bodyGate=new Promise(resolve=>{release=resolve;});meta('m2').onclick();assert.equal(ids.get('loading').hidden,false);assert.match(ids.get('loading-label').textContent,/Loading messages/);
  readerListener({type:'bodyStage',id:'m2',stage:'parsing'});assert.match(ids.get('loading-label').textContent,/Formatting messages/);
  release();bodyGate=null;await settle();assert.equal(row('m2').dataset.state,'ready');assert.equal(ids.get('scroller').attributes['aria-busy'],'false');
});

test('Address hover opens contextual actions and add-contact asks for a book',async()=>{
  const addresses=find(row('m3'),c=>c.tagName==='dl'),address=find(addresses.children[1],c=>c.className==='address-label');const menu=ids.get('address-menu');
  address.onmouseenter();assert.equal(menu.hidden,true,'hover waits for intent before opening');address.onmouseleave();await new Promise(resolve=>setTimeout(resolve,HOVER_DELAY+20));assert.equal(menu.hidden,true,'passing over an address does not open the menu');
  address.onmouseenter();await new Promise(resolve=>setTimeout(resolve,HOVER_DELAY+20));assert.equal(menu.hidden,false);
  assert.deepEqual(menu.children.slice(1).map(c=>c.textContent),['Filter messages in this folder','Create message filter…','Add contact to address book…','Send email…']);
  await menu.children[3].onclick();assert.equal(menu.children[1].textContent,'Personal Address Book');await menu.children[1].onclick();assert.ok(requests.some(r=>r.type==='addressAction' && r.action==='contact' && r.bookId==='personal' && r.email==='sender3@example.com'));
});
test('Canonical body size resolves a stale row rather than loading forever',()=>{
  readerListener({type:'bodyReady',id:'m2',body:{messageId:'m2',size:120,parserVersion:7,text:'Updated content'}});assert.equal(row('m2').dataset.state,'ready');
});
test('Body errors appear immediately with Retry and Original message fallback',async()=>{
  let release;bodyGate=new Promise(resolve=>{release=resolve;});messages.push({...messages[2],messageId:'m4',date:4});await ids.get('refresh').onclick();
  readerListener({type:'bodyError',id:'m4',error:'Message loading timed out'});assert.equal(row('m4').dataset.state,'error');
  const original=find(row('m4'),c=>c.tagName==='button' && c.textContent==='Original message');assert.ok(original);await original.onclick();assert.ok(requests.some(r=>r.type==='originalMessage' && r.messageId==='m4'));
  release();bodyGate=null;await settle();
});

test('Remote images load only after opting in and the preference persists',()=>{
  readerListener({type:'bodyReady',id:'m4',body:{messageId:'m4',size:100,parserVersion:7,text:'Photo',remoteImages:[{src:'https://example.com/photo.png',alt:'Photo'}]}});
  const remote=()=>body('m4').children.find(c=>c.className==='remote-content');
  assert.equal(remote().children[0].tagName,'button');remote().children[0].onclick();
  assert.equal(remote().children[0].tagName,'img');assert.equal(remote().children[0].attributes.referrerpolicy,'no-referrer');
  assert.deepEqual(changes.at(-1),{allowRemoteContent:true});
  ids.get('remote-content').checked=false;ids.get('remote-content').onchange();assert.equal(remote().children[0].tagName,'button');
});
test('Long conversations keep endpoints in either order with a middle count',async()=>{
  ids.get('scroller').clientHeight=5000;
  for(let i=5;i<=10;i++)messages.push({...messages[0],messageId:`m${i}`,date:i});
  await ids.get('refresh').onclick();await settle();assert.equal(ids.get('thread-group').hidden,true);
  messages.push({...messages[0],messageId:'m11',date:11});await ids.get('refresh').onclick();await settle();
  assert.equal(ids.get('thread-group').hidden,false);assert.match(ids.get('thread-group').textContent,/11 messages/);
  assert.deepEqual(messageRows().map(r=>r.dataset.id).sort(),['m1','m11']);
  assert.ok(position(row('m11'))<position(ids.get('thread-group')));
  assert.ok(position(ids.get('thread-group'))<position(row('m1')));
  const before=requests.filter(r=>r.type==='bodies').length;
  ids.get('thread-group').onclick();await settle();assert.equal(ids.get('thread-group').attributes['aria-expanded'],'true');
  assert.equal(messageRows().length,11);assert.ok(messageRows().filter(r=>!['m1','m11'].includes(r.dataset.id)).every(r=>r.dataset.state==='collapsed'));
  assert.equal(requests.filter(r=>r.type==='bodies').length,before);
  meta('m2').onclick();await settle();assert.equal(row('m2').dataset.state,'ready');
  ids.get('thread-group').onclick();assert.deepEqual(messageRows().map(r=>r.dataset.id).sort(),['m1','m11']);
  assert.ok(position(row('m11'))<position(ids.get('thread-group')));
  assert.ok(position(ids.get('thread-group'))<position(row('m1')));
});

test('Named links render as anchors and request the default browser on click',async()=>{
  if(row('m11').dataset.state==='collapsed')meta('m11').onclick();await settle();
  readerListener({type:'bodyReady',id:'m11',body:{messageId:'m11',size:100,parserVersion:7,blocks:[{type:'text',text:'Please find plans data attached.',runs:[{text:'Please find '},{text:'plans data',href:'https://docs.google.com/spreadsheets/d/example/edit'},{text:' attached.'}]}]}});
  const text=body('m11').children[0],link=text.children[1];
  assert.equal(link.tagName,'a');assert.equal(link.textContent,'plans data');
  link.onclick({preventDefault(){}});await settle();assert.ok(requests.some(r=>r.type==='openLink' && r.url===link.attributes.href));
});
test('Preferences received from add-on settings update live reader controls and grouping',()=>{
  storageListener({order:{newValue:'chronological'}},'local');
  assert.equal(row('m1').dataset.index,0);assert.equal(row('m11').dataset.index,1);
  assert.ok(position(row('m1'))<position(ids.get('thread-group')));
  assert.ok(position(ids.get('thread-group'))<position(row('m11')));
  storageListener({foldLongThreads:{newValue:false},theme:{newValue:'sepia'},allowRemoteContent:{newValue:true}},'local');
  assert.equal(ids.get('thread-group').hidden,true);assert.equal(messageRows().length,11);assert.equal(document.documentElement.dataset.theme,'sepia');assert.equal(ids.get('remote-content').checked,true);
});
test('Rapid open/close while bodies load settles on the last state without errors or duplicate rows',async()=>{
  let release;bodyGate=new Promise(resolve=>{release=resolve;});
  assert.equal(row('m7').dataset.state,'collapsed');
  for(let i=0;i<7;i++)meta('m7').onclick();
  assert.equal(row('m7').dataset.state,'loading');assert.equal(meta('m7').attributes['aria-expanded'],'true');
  release();bodyGate=null;await settle();await settle();
  const rendered=messageRows().map(r=>r.dataset.id);assert.equal(new Set(rendered).size,rendered.length);
  assert.equal(row('m7').dataset.state,'ready');assert.ok(!messageRows().some(r=>r.dataset.state==='error'));
  assert.equal(document.getElementById('scroller').attributes['aria-busy'],'false');
});
test('A superseded body is requested again on reopen without waiting for its old batch',async()=>{
  let release;bodyGate=new Promise(resolve=>{release=resolve;});
  const bodyRequests=()=>requests.filter(r=>r.type==='bodies' && r.ids.includes('m9')).length;
  meta('m9').onclick();assert.equal(bodyRequests(),1);
  meta('m9').onclick();readerListener({type:'bodyError',id:'m9',error:'Body request superseded'});
  meta('m9').onclick();assert.equal(bodyRequests(),2,'reopening issues a fresh request while the first batch is still pending');
  assert.equal(row('m9').dataset.state,'loading');
  release();bodyGate=null;await settle();await settle();assert.equal(row('m9').dataset.state,'ready');
});

test('Attachments list with open and save actions, and the card menu offers state-aware actions',async()=>{
  const attachments=[{partName:'1.2',name:'Plan.pdf',contentType:'application/pdf',size:120000},{partName:'1.3',name:'notes.txt',contentType:'text/plain',size:900}];
  readerListener({type:'bodyReady',id:'m9',body:{messageId:'m9',size:100,parserVersion:7,text:'See attached',attachments}});
  const section=find(row('m9'),c=>c.className==='attachments');assert.ok(section);
  assert.match(find(section,c=>c.className==='attachments-title').textContent,/2 attachments · 118 KB/);
  const names=find(section,c=>c.className==='attachment-list').children.map(li=>li.children[1].textContent);assert.deepEqual(names,['Plan.pdf','notes.txt']);
  find(section,c=>c.className==='attachment-save').onclick();await settle();
  assert.ok(requests.some(r=>r.type==='attachment' && r.action==='save' && r.partName==='1.2' && r.messageId==='m9'));
  find(section,c=>c.className==='link-button' && c.textContent==='Save all').onclick();await settle();
  assert.ok(requests.some(r=>r.type==='attachment' && Array.isArray(r.partName) && r.partName.length===2));
  const more=row('m9').children[0].children[1],menu=ids.get('card-menu');assert.equal(more.className,'card-more');
  more.onclick();assert.equal(menu.hidden,false);assert.equal(more.attributes['aria-expanded'],'true');
  const labels=()=>menu.children.filter(c=>c.tagName==='button').map(c=>c.textContent);
  assert.ok(labels().includes('Mark as unread'));assert.ok(labels().includes('Save all 2 attachments'));await settle();
  const trash=menu.children.find(c=>c.textContent==='Move to Trash');assert.equal(trash.className,'danger');trash.onclick();await settle();
  assert.equal(menu.hidden,true);assert.ok(requests.some(r=>r.type==='messageAction' && r.action==='trash' && r.messageId==='m9'));
});
