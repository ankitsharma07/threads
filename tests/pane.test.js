import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const scope={};vm.runInNewContext(readFileSync(new URL('../experiment/pane-controller.js',import.meta.url),'utf8'),scope);
const Controller=scope.ThreadsPaneController;
function fixture(){
  const calls={single:[],multiple:[],pages:[],selections:[],errors:[],counts:0,clear:0};let selected,collapsed=false;
  const folder={URI:'imap://account/inbox',server:{type:'imap'},getUriForMsg:h=>`imap-message://account/inbox#${h.messageKey}`};
  const headers=Array.from({length:3},(_,i)=>({messageKey:i+1,folder,headerMessageId:`${i}@test`}));selected=[headers[0]];
  const thread={numChildren:3,getRootHdr:()=>headers[0],getChildHdrAt:i=>headers[i]};
  const pane={classList:{contains:()=>collapsed},webBrowser:{currentURI:{spec:'about:blank'},hidden:true},
    displayMessage(uri){calls.single.push(uri);this.webBrowser.hidden=true;this.webBrowser.currentURI.spec='about:blank';return 'native-single';},
    displayMessages(headers){calls.multiple.push(headers);return 'native-multiple';},
    displayWebPage(url){calls.pages.push(url);this.webBrowser.currentURI.spec=url;this.webBrowser.hidden=false;},
    clearWebPage(){calls.clear++;this.webBrowser.hidden=true;this.webBrowser.currentURI.spec='about:blank';},dispatchEvent(){calls.counts++;}
  };
  const originalSingle=pane.displayMessage,originalMultiple=pane.displayMessages;
  const window={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id),messagePane:pane,CustomEvent:class {constructor(type,options){this.type=type;this.options=options;}},tabOrWindow:{selected:true},gDBView:{getSelectedMsgHdrs:()=>selected,getThreadContainingMsgHdr:h=>h.thread||thread}};
  window.threadPane={_onSelect:()=>selected.length===1?pane.displayMessage(folder.getUriForMsg(selected[0])):pane.displayMessages(selected)};
  const controller=new Controller({window,tabId:7,pageUrl:'moz-extension://threads/src/reader.html?tabId=7',convertMessage:async h=>({id:h.messageKey,headerMessageId:h.headerMessageId}),isMailHeader:h=>h.folder.server.type!=='rss',onSelection:(id,value)=>calls.selections.push({id,value}),reportError:e=>calls.errors.push(e)});
  controller.attach();
  return {controller,pane,headers,calls,window,originalSingle,originalMultiple,select:h=>{selected=h;},collapse:v=>{collapsed=v;}};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('A normal click replaces the existing pane without displaying original MIME',async()=>{const f=fixture();f.window.threadPane._onSelect();await settle();assert.equal(f.calls.pages.length,1);assert.match(f.calls.pages[0],/tabId=7/);assert.equal(f.calls.single.length,0);assert.equal(f.calls.selections.at(-1).value.messages.length,3);assert.equal(f.calls.counts,1);});
test('Switching messages reuses the same embedded reader document',async()=>{const f=fixture();f.window.threadPane._onSelect();f.select([f.headers[2]]);f.window.threadPane._onSelect();await settle();assert.equal(f.calls.pages.length,1);assert.equal(f.calls.selections.at(-1).value.selected.id,3);});
test('Stale asynchronous selection conversion cannot overwrite a newer click',async()=>{const f=fixture();let release;f.controller.convertMessage=h=>h===f.headers[0]?new Promise(r=>release=()=>r({id:h.messageKey})):Promise.resolve({id:h.messageKey});f.window.threadPane._onSelect();f.controller.convertMessage=async h=>({id:h.messageKey});f.select([f.headers[2]]);f.window.threadPane._onSelect();await settle();release();await settle();assert.equal(f.calls.selections.filter(x=>x.value).length,1);assert.equal(f.calls.selections.at(-1).value.selected.id,3);});
test('Collapsed threads display all members without changing native selection',async()=>{const f=fixture();f.select(f.headers);f.window.threadPane._onSelect();await settle();assert.equal(f.calls.multiple.length,0);assert.equal(f.calls.selections.at(-1).value.messages.length,3);assert.equal(f.window.gDBView.getSelectedMsgHdrs().length,3);});
test('Selections spanning separate threads defer to Thunderbird',()=>{const f=fixture();const other={...f.headers[2],messageKey:10};other.thread={numChildren:1,getRootHdr:()=>other,getChildHdrAt:()=>other};f.select([f.headers[0],other]);assert.equal(f.window.threadPane._onSelect(),'native-multiple');assert.equal(f.calls.pages.length,0);});
test('RSS and empty selections keep native rendering',()=>{const f=fixture();f.headers[0].folder.server.type='rss';assert.equal(f.window.threadPane._onSelect(),'native-single');assert.equal(f.calls.pages.length,0);assert.equal(f.pane.displayMessage(), 'native-single');});
test('A hidden message pane stays hidden',()=>{const f=fixture();f.collapse(true);f.window.threadPane._onSelect();assert.equal(f.calls.pages.length,0);assert.equal(f.calls.single.length,1);});
test('Original message bypass lasts until a different message is selected',async()=>{const f=fixture();f.window.threadPane._onSelect();await settle();f.controller.showOriginal();assert.equal(f.calls.single.length,1);f.window.threadPane._onSelect();assert.equal(f.calls.pages.length,1);f.select([f.headers[1]]);f.window.threadPane._onSelect();await settle();assert.equal(f.calls.pages.length,2);});
test('Disabling and reenabling toggles the existing pane in place',async()=>{const f=fixture();f.window.threadPane._onSelect();await settle();assert.equal(f.controller.setEnabled(false),false);assert.equal(f.calls.single.length,1);assert.equal(f.controller.setEnabled(true),true);await settle();assert.equal(f.calls.pages.length,2);});
test('Shutdown restores methods and the original message view',async()=>{const f=fixture();f.window.threadPane._onSelect();await settle();f.controller.detach();assert.equal(f.pane.displayMessage,f.originalSingle);assert.equal(f.pane.displayMessages,f.originalMultiple);assert.equal(f.calls.clear,1);assert.equal(f.calls.single.length,1);});
test('Shutdown does not overwrite methods subsequently wrapped by another add-on',()=>{const f=fixture();const ours=f.pane.displayMessage;const other=function(...args){return ours.apply(this,args);};f.pane.displayMessage=other;f.controller.detach();assert.equal(f.pane.displayMessage,other);assert.equal(f.pane.displayMessage('test'),'native-single');});
test('API conversion failure returns to the original reader',async()=>{const f=fixture();f.controller.convertMessage=async()=>{throw new Error('API unavailable');};f.window.threadPane._onSelect();await settle();assert.equal(f.calls.errors.length,1);assert.equal(f.calls.single.length,1);});
test('Explicit display requests for an unselected message keep native behavior',()=>{const f=fixture();assert.equal(f.pane.displayMessage('imap-message://account/inbox#99'),'native-single');assert.equal(f.calls.pages.length,0);});
test('Closing a native tab detaches without reloading a closing window',async()=>{const f=fixture();f.window.threadPane._onSelect();await settle();f.controller.detach({restore:false});assert.equal(f.pane.displayMessage,f.originalSingle);assert.equal(f.calls.clear,0);assert.equal(f.calls.single.length,0);});
function reading(f,policy){const marked=[];f.controller.readPolicy=()=>policy;f.controller.markRead=h=>marked.push(...h);return marked;}
test('Showing a conversation marks its unread messages read',async()=>{const f=fixture();f.headers[1].isRead=true;const marked=reading(f,{auto:true,delay:0});f.window.threadPane._onSelect();await settle();assert.deepEqual(marked.map(h=>h.messageKey),[1,3]);});
test('Automatic marking follows Thunderbird preferences',async()=>{const f=fixture();const marked=reading(f,{auto:false,delay:0});f.window.threadPane._onSelect();await settle();assert.equal(marked.length,0);});
test('Delayed marking is cancelled when the selection moves on',async()=>{const f=fixture();const marked=reading(f,{auto:true,delay:20});f.window.threadPane._onSelect();await settle();f.collapse(true);f.window.threadPane._onSelect();await new Promise(r=>setTimeout(r,40));assert.equal(marked.length,0);
  f.collapse(false);f.window.threadPane._onSelect();await settle();assert.equal(marked.length,0);await new Promise(r=>setTimeout(r,40));assert.equal(marked.length,3);});
test('Detaching cancels a pending read mark',async()=>{const f=fixture();const marked=reading(f,{auto:true,delay:20});f.window.threadPane._onSelect();await settle();f.controller.detach({restore:false});await new Promise(r=>setTimeout(r,40));assert.equal(marked.length,0);});
