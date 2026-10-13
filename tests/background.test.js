import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBody} from '../src/parser.js';

function event(){return {listeners:[],addListener(fn){this.listeners.push(fn);}};}
const count={full:0,parsed:0,headers:0,queryIds:[],active:0,max:0,started:[]},notifications=[],composeCalls=[],addressCalls=[],contacts=[];
const headers=Array.from({length:500},(_,i)=>({id:i+1,headerMessageId:`mail${i}@test`,date:new Date(i*60000),subject:'Corporate conversation',author:'Ada',folder:{id:'inbox',accountId:'work'},size:100}));
const events={sent:event(),native:event(),display:event(),move:event(),copy:event(),remove:event(),newMail:event()};
globalThis.Worker=class {
  postMessage(data){count.parsed++;queueMicrotask(()=>this.onmessage({data:{id:data.id,result:parseBody(data.job)}}));}
};
const sent={...headers[0],id:8001,headerMessageId:'sent@test',date:new Date(60000000),folder:{id:'sent',accountId:'work'}},unrelated={...sent,id:8002,headerMessageId:'unrelated@test'};
let runtimeListener;let createdTabs=0,toggles=0;
const nativeSelections=new Map([[1,{selected:headers[399],messages:headers}],[2,{selected:headers[99],messages:headers}]]);
const savedPreferences={},storageChanged=event(),openedLinks=[],messageCalls=[],downloads=[];
globalThis.messenger={
  storage:{local:{async get(){return {...savedPreferences};},async set(values){const changes={};for(const [key,value] of Object.entries(values)){changes[key]={oldValue:savedPreferences[key],newValue:value};savedPreferences[key]=value;}for(const listener of storageChanged.listeners)listener(changes,'local');}},onChanged:storageChanged},
  windows:{async openDefaultBrowser(url){openedLinks.push(url);}},
  threadsPane:{onSelection:events.native,async start(){},async getSelection(tabId){return nativeSelections.get(tabId)||null;},async show(){toggles++;return true;},async showOriginal(){},async createFilter(...args){addressCalls.push(['createFilter',...args]);}},
  compose:{onAfterSend:events.sent,async beginNew(details){addressCalls.push(['compose',details]);},async beginReply(id,type){composeCalls.push({id,type});},async beginForward(id,type){composeCalls.push({id,type});}},
  addressBooks:{async list(){return [{id:'personal',name:'Personal Address Book'},{id:'remote',name:'LDAP',remote:true},{id:'readOnly',name:'Locked',readOnly:true}];}},
  contacts:{async list(){return contacts;},async create(book,properties){contacts.push({properties});addressCalls.push(['contact',book,properties]);}},
  messages:{
    async get(id){if(id===999999)throw new Error('Stale handle');return headers[id-1];},
    async getHeaders(id){count.headers++;if(id===8001 || id===8003)return {'in-reply-to':['<mail399@test>']};if(id===8002)return {};return id>1?{references:[`<mail${id-2}@test>`]}:{};},
    async query(options){if(options.fromMe)return {messages:[sent,unrelated]};if(options.headerMessageId){count.queryIds.push(options.headerMessageId);return {messages:headers.filter(h=>h.headerMessageId===options.headerMessageId)};}return {messages:options.fromDate?[]:headers};},
    async getFull(id){count.full++;count.started.push(id);count.active++;count.max=Math.max(count.max,count.active);await new Promise(r=>setTimeout(r,id===400?1:3));count.active--;return {contentType:'message/rfc822',partName:'',parts:[{contentType:'text/plain',body:`Message ${id}\nOn Monday Ada wrote:\nHistory`}]};},
    async update(id,properties){messageCalls.push(['update',id,properties]);},async archive(ids){messageCalls.push(['archive',ids]);},async delete(ids,skipTrash){messageCalls.push(['delete',ids,skipTrash]);},
    async getRaw(id,options){messageCalls.push(['getRaw',id,options.data_format]);return new Blob(['raw']);},async openAttachment(...args){messageCalls.push(['openAttachment',...args]);},
    async getAttachmentFile(id,part){return new File(['x'],`report ${part}.pdf`);},
    async abortList(){},onNewMailReceived:events.newMail,onMoved:events.move,onCopied:events.copy,onDeleted:events.remove
  },
  runtime:{onMessage:{addListener(fn){runtimeListener=fn;}},async sendMessage(msg){notifications.push(msg);},getURL:path=>path},
  downloads:{async download(options){downloads.push(options);}},
  messageDisplay:{async open(options){messageCalls.push(['open',options]);},onMessageDisplayed:events.display,async getDisplayedMessage(){return headers[399];}},
  mailTabs:{async setQuickFilter(...args){addressCalls.push(['filter',...args]);},async getSelectedMessages(){return {messages:[]};}},
  browserAction:{onClicked:event(),async setTitle(){},async setBadgeText(){}},messageDisplayAction:{onClicked:event()},tabs:{onRemoved:event(),async create(){createdTabs++;throw new Error('Threads must never create a reader tab');},async update(){}}
};
const originalInterval=globalThis.setInterval;globalThis.setInterval=()=>0;
await import('../src/background.js?first');globalThis.setInterval=originalInterval;
async function ready(){for(let i=0;i<5000;i++){const s=await runtimeListener({type:'status'});if(s.error)throw new Error(s.error);if(s.phase==='Index ready')return;await new Promise(r=>setTimeout(r,2));}throw new Error('Indexer timed out');}
await ready();
test('Background keeps metadata and body retrieval separate',async t=>{
  await t.test('500-message indexing and thread opening make zero MIME calls',async()=>{const thread=await runtimeListener({type:'thread',tabId:1});assert.equal(thread.messages.length,500);assert.equal(count.full,0);assert.equal(count.parsed,0);});
  const visible=Array.from({length:20},(_,i)=>`mail${390+i}@test`);
  await t.test('Only viewport bodies load, selected first, with bounded concurrency',async()=>{const ids=['mail399@test',...visible.filter(id=>id!=='mail399@test')];const result=await runtimeListener({type:'bodies',ids,selected:'mail399@test'});assert.equal(result.length,20);assert.ok(result.every(r=>r.body));assert.equal(count.full,20);assert.equal(count.started[0],400);assert.equal(count.max,3);assert.equal(count.parsed,20);assert.equal(notifications.filter(m=>m.type==='bodyReady').length,20);});
  await t.test('Reopening cached bodies performs no MIME fetch or parse',async()=>{await runtimeListener({type:'bodies',ids:visible,selected:'mail399@test'});assert.equal(count.full,20);assert.equal(count.parsed,20);});
  await t.test('New session uses IndexedDB without refetching cached bodies',async()=>{globalThis.setInterval=()=>0;try{await import('../src/background.js?restart');}finally{globalThis.setInterval=originalInterval;}await ready();await runtimeListener({type:'bodies',ids:['mail399@test'],selected:'mail399@test'});assert.equal(count.full,20);assert.equal(count.parsed,20);});
  await t.test('Uncached body after restart resolves its RFC ID before fetching',async()=>{await runtimeListener({type:'bodies',ids:['mail450@test'],selected:'mail450@test'});assert.equal(count.full,21);assert.equal(count.parsed,21);assert.ok(count.queryIds.includes('mail450@test'));assert.equal(count.started.at(-1),451);});
  await t.test('Native mail tabs maintain independent selections',async()=>{const second=await runtimeListener({type:'thread',tabId:2});const first=await runtimeListener({type:'thread',tabId:1});assert.equal(second.selected,'mail99@test');assert.equal(first.selected,'mail399@test');});
  await t.test('Toolbar shows the native pane without opening a tab',async()=>{await messenger.browserAction.onClicked.listeners.at(-1)({id:1});assert.equal(toggles,1);assert.equal(createdTabs,0);});
  await t.test('The current native thread provides a skeleton before indexing',async()=>{const fresh=Array.from({length:5},(_,i)=>({...headers[0],id:1001+i,headerMessageId:`fresh${i}@test`,date:new Date(i)}));nativeSelections.set(3,{selected:fresh[0],messages:fresh});const result=await runtimeListener({type:'thread',tabId:3});assert.equal(result.messages.length,5);assert.equal(result.selected,'fresh0@test');assert.equal(count.full,21);});
  await t.test('An unindexed body takes its metadata from getFull without a separate header read',async()=>{
    const getHeaders=messenger.messages.getHeaders,read=[];messenger.messages.getHeaders=id=>{read.push(id);return getHeaders(id);};
    try{const [result]=await runtimeListener({type:'bodies',ids:['fresh3@test'],selected:'fresh3@test'});assert.ok(result.body);assert.ok(!read.includes(1004));}
    finally{messenger.messages.getHeaders=getHeaders;}
  });
  await t.test('Reply, reply all and forward use the intended native compose types without loading bodies',async()=>{
    const before=count.full;
    for(const action of ['reply','replyAll','forward'])await runtimeListener({type:'compose',messageId:'mail399@test',action});
    assert.deepEqual(composeCalls.slice(-3),[{id:400,type:'replyToSender'},{id:400,type:'replyToAll'},{id:400,type:'forwardInline'}]);
    assert.equal(count.full,before);
    await assert.rejects(runtimeListener({type:'compose',messageId:'mail399@test',action:'send'}),/Unsupported/);
  });
  await t.test('Compose resolves a moved message handle before opening one window',async()=>{
    await events.native.listeners.at(-1)(4,{selected:{...headers[399],id:999999},messages:[{...headers[399],id:999999}]});
    const before=composeCalls.length;
    await runtimeListener({type:'compose',messageId:'mail399@test',action:'replyAll'});
    assert.equal(composeCalls.length,before+1);assert.deepEqual(composeCalls.at(-1),{id:400,type:'replyToAll'});
  });
  await t.test('One pane does not cancel another pane’s queued bodies',async()=>{const ids=Array.from({length:6},(_,i)=>`mail${460+i}@test`);await runtimeListener({type:'viewport',tabId:1,ids});const pending=runtimeListener({type:'bodies',tabId:1,ids,selected:ids[0]});await runtimeListener({type:'viewport',tabId:2,ids:['mail470@test']});const results=await pending;assert.ok(results.every(r=>r.body));});
  await t.test('Outgoing messages outside the native folder join by references, never by subject alone',async()=>{
    for(let i=0;i<100;i++){
      const thread=await runtimeListener({type:'thread',tabId:1});
      if(thread.messages.some(m=>m.messageId==='sent@test')){
        assert.ok(!thread.messages.some(m=>m.messageId==='unrelated@test'));assert.equal(thread.messages.length,501);return;
      }
      await new Promise(r=>setTimeout(r,5));
    }
    assert.fail('Sent reply did not join the thread');
  });
  await t.test('Successful sending immediately indexes the saved sent copy without MIME parsing',async()=>{
    const before=count.full;
    await events.sent.listeners.at(-1)({}, {mode:'sendNow',messages:[{...sent,id:8003,headerMessageId:'new-sent@test'}]});
    assert.ok((await runtimeListener({type:'thread',tabId:1})).messages.some(m=>m.messageId==='new-sent@test'));assert.equal(count.full,before);
  });
  await t.test('Body caches refresh when Thunderbird metadata size changes',async()=>{
    await runtimeListener({type:'thread',tabId:2});const old=headers[399].size;headers[399].size=120;
    await events.native.listeners.at(-1)(1,{selected:headers[399],messages:headers});
    const body=(await runtimeListener({type:'bodies',ids:['mail399@test']}))[0].body;
    assert.equal(body.size,120);headers[399].size=old;
  });
  await t.test('Address actions filter, compose, and add a nonduplicate contact to a chosen local book',async()=>{
    const email='ada@example.com';assert.deepEqual(await runtimeListener({type:'addressBooks'}),[{id:'personal',name:'Personal Address Book'}]);
    for(const action of ['filter','createFilter','compose','contact','contact'])await runtimeListener({type:'addressAction',action,email,tabId:1,header:'from',bookId:'personal'});
    assert.ok(addressCalls.some(c=>c[0]==='compose' && c[1].to[0]===email));
    assert.ok(addressCalls.some(c=>c[0]==='filter' && c[2].text.author && c[2].text.recipients));
    assert.equal(addressCalls.filter(c=>c[0]==='contact').length,1);assert.match(contacts[0].properties.vCard,/EMAIL:ada@example.com/);
    await assert.rejects(runtimeListener({type:'addressAction',action:'contact',email,bookId:'readOnly'}),/writable/);
    await assert.rejects(runtimeListener({type:'addressAction',action:'compose',email:'ada@example.com\r\nBcc:bad@example.com'}),/Invalid/);
  });
});

test('Links open in the default browser and unsafe protocols are rejected',async()=>{
  await runtimeListener({type:'openLink',url:'https://docs.google.com/spreadsheets/d/example/edit'});assert.equal(openedLinks.at(-1),'https://docs.google.com/spreadsheets/d/example/edit');
  await assert.rejects(runtimeListener({type:'openLink',url:'javascript:alert(1)'}),/Unsupported link/);
});
test('Index controls and storage stay synchronized in both directions',async()=>{
  const result=await runtimeListener({type:'pause'});assert.equal(savedPreferences.indexingEnabled,result.enabled);
  await messenger.storage.local.set({indexingEnabled:false});assert.equal((await runtimeListener({type:'status'})).indexingEnabled,false);
  await runtimeListener({type:'rescan'});assert.equal(savedPreferences.indexingEnabled,true);assert.equal((await runtimeListener({type:'status'})).indexingEnabled,true);
});

test('Card menu actions resolve the live handle and call the matching Thunderbird API',async()=>{
  assert.deepEqual(await runtimeListener({type:'messageState',messageId:'mail399@test'}),{read:false,flagged:false});
  for(const action of ['markUnread','star','openTab','archive','trash','forwardAttachment'])await runtimeListener({type:'messageAction',messageId:'mail399@test',action});
  assert.deepEqual(messageCalls.slice(0,5),[['update',400,{read:false}],['update',400,{flagged:true}],['open',{messageId:400,location:'tab'}],['archive',[400]],['delete',[400],false]]);
  assert.deepEqual(composeCalls.at(-1),{id:400,type:'forwardAsAttachment'});
  const saved=await runtimeListener({type:'messageAction',messageId:'mail399@test',action:'saveAs'});assert.equal(saved.message,'Message saved');
  assert.equal(downloads.at(-1).filename,'Corporate conversation.eml');assert.equal(downloads.at(-1).saveAs,true);
  await assert.rejects(runtimeListener({type:'messageAction',messageId:'mail399@test',action:'eval'}),/Unsupported/);
});
test('Attachments open natively, save singly with a dialog, and save in bulk without one',async()=>{
  await runtimeListener({type:'attachment',messageId:'mail399@test',partName:'1.2',action:'open',tabId:1});
  assert.deepEqual(messageCalls.at(-1),['openAttachment',400,'1.2',1]);
  await runtimeListener({type:'attachment',messageId:'mail399@test',partName:'1.2',action:'save'});assert.equal(downloads.at(-1).saveAs,true);assert.equal(downloads.at(-1).filename,'report 1.2.pdf');
  const before=downloads.length,result=await runtimeListener({type:'attachment',messageId:'mail399@test',partName:['1.2','1.3'],action:'save'});
  assert.equal(downloads.length,before+2);assert.ok(downloads.slice(-2).every(d=>d.saveAs===false));assert.equal(result.message,'Saved 2 attachments');
  await assert.rejects(runtimeListener({type:'attachment',messageId:'mail399@test',partName:'../x',action:'save'}),/Unknown attachment/);
});
