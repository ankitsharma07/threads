import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const controllerSource=readFileSync(new URL('../experiment/pane-controller.js',import.meta.url),'utf8');
const apiSource=readFileSync(new URL('../experiment/api.js',import.meta.url),'utf8');
function target(properties={}){return Object.assign({listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn);},removeEventListener(type){this.listeners.delete(type);}},properties);}
function setup(){
  let listener,cleared=0,nativeRenders=0;const notifications=[];
  const folder={URI:'imap://work/inbox',server:{type:'imap'},flags:0,getUriForMsg:h=>`imap-message://work/inbox#${h.messageKey}`};
  const header={messageKey:1,folder},thread={numChildren:1,getRootHdr:()=>header,getChildHdrAt:()=>header};
  const pane={classList:{contains:()=>false},webBrowser:{hidden:true,currentURI:{spec:'about:blank'}},async isReady(){},displayMessage(){nativeRenders++;},displayMessages(){},displayWebPage(url,params){assert.equal(params.triggeringPrincipal,'extension-principal');this.webBrowser.currentURI.spec=url;this.webBrowser.hidden=false;},clearWebPage(){cleared++;this.webBrowser.currentURI.spec='about:blank';},dispatchEvent(){}};
  const original=pane.displayMessage;
  const nativeWindow={document:{documentURI:'about:3pane',readyState:'complete'},messagePane:pane,gDBView:{getSelectedMsgHdrs:()=>[header],getThreadContainingMsgHdr:()=>thread},CustomEvent:class{},tabOrWindow:{selected:true}};
  nativeWindow.threadPane={_onSelect:()=>pane.displayMessage(folder.getUriForMsg(header))};
  const nativeTab={id:9,chromeBrowser:{contentWindow:nativeWindow,isConnected:true}};
  const tabmail=target({tabInfo:[nativeTab]});const top=target({document:{getElementById:()=>tabmail}});nativeWindow.top=top;
  const support={registerWindowListener(id,definition){listener=definition;},unregisterWindowListener(){listener=null;}};
  const context={extension:{id:'threads@test',principal:'extension-principal',rootURI:{resolve:p=>`jar:file:///test/threads.xpi!/${p}`},baseURI:{resolve:p=>`moz-extension://threads/${p}`},tabManager:{getWrapper:t=>({id:t.id}),get:()=>({nativeTab})},messageManager:{convert:h=>({id:h.messageKey,headerMessageId:'mail@test'})}}};
  const globals={console,ChromeUtils:{importESModule:()=>({ExtensionSupport:support})},Ci:{nsMsgFolderFlags:{Drafts:16,Templates:32}},Services:{wm:{getEnumerator:()=>[top]},scriptloader:{loadSubScript(url,scope){assert.match(url,/jar:file:/);vm.runInNewContext(controllerSource,scope);}}},ExtensionCommon:{ExtensionAPI:class{},EventManager:class{constructor(config){this.config=config;}api(){return {addListener:fn=>this.config.register({async:async(...args)=>{notifications.push(args);await fn(...args);}})};}}}};
  vm.runInNewContext(controllerSource+'\n'+apiSource,globals);const instance=new globals.threadsPane(),api=instance.getAPI(context).threadsPane;
  return {api,instance,pane,original,notifications,nativeWindow,nativeTab,tabmail,support,get listener(){return listener;},get cleared(){return cleared;},get nativeRenders(){return nativeRenders;}};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('Native startup uses extension URLs and attaches existing mail panes',async()=>{const f=setup();f.api.onSelection.addListener(()=>{});await f.api.start();await settle();assert.match(f.pane.webBrowser.currentURI.spec,/^moz-extension:\/\/threads\/src\/reader.html\?tabId=9$/);assert.equal(f.notifications[0][0],9);assert.equal((await f.api.getSelection(9)).selected.id,1);f.instance.onShutdown();});
test('Native adapter cleanup restores the display and unregisters all listeners',async()=>{const f=setup();await f.api.start();await settle();f.instance.onShutdown();assert.equal(f.pane.displayMessage,f.original);assert.equal(f.cleared,1);assert.equal(f.nativeRenders,1);assert.equal(f.tabmail.listeners.size,0);assert.equal(f.listener,null);});
test('Closing a native tab does not require converting a destroyed native tab',async()=>{const f=setup();await f.api.start();await settle();f.tabmail.listeners.get('TabClose')({detail:{tabInfo:f.nativeTab}});assert.equal(f.instance.controllers.size,0);assert.equal(f.pane.displayMessage,f.original);assert.equal(f.nativeRenders,0);f.instance.onShutdown();});

test('Toolbar explicitly shows the conversation after Original message',async()=>{const f=setup();await f.api.start();await settle();await f.api.showOriginal(9);await f.api.show(9);await settle();assert.equal((await f.api.getSelection(9)).messages.length,1);assert.match(f.pane.webBrowser.currentURI.spec,/moz-extension:/);f.instance.onShutdown();});
test('Attachment waits for Thunderbird asynchronous pane initialization',async()=>{const f=setup();let ready;f.nativeWindow.hasDOMContentLoaded={promise:new Promise(resolve=>{ready=resolve;})};await f.api.start();await settle();assert.equal(f.pane.displayMessage,f.original);ready();await settle();assert.notEqual(f.pane.displayMessage,f.original);f.instance.onShutdown();});

test('Explicit toolbar click expands a hidden message pane',async()=>{const f=setup();const splitter={isCollapsed:true};f.nativeWindow.paneLayout={messagePaneSplitter:splitter};f.pane.classList.contains=()=>splitter.isCollapsed;f.nativeWindow.threadPane._onSelect=()=>{if(!splitter.isCollapsed)f.pane.displayMessage('imap-message://work/inbox#1');};await f.api.start();await settle();assert.equal(await f.api.getSelection(9),null);await f.api.show(9);assert.equal(splitter.isCollapsed,false);assert.equal((await f.api.getSelection(9)).messages.length,1);f.instance.onShutdown();});

test('Privileged entry point does not load jar or file subscripts',()=>{assert.doesNotMatch(apiSource,/loadSubScript/);});

test('Message filter editor receives the address, folder and corresponding header',async()=>{const f=setup();let captured;f.nativeWindow.gFolder='inbox';f.nativeWindow.top.MsgFilters=(...args)=>{captured=args;};await f.api.start();await settle();await f.api.createFilter(9,'ada@example.com','to');assert.deepEqual(captured,['ada@example.com','inbox','to']);await assert.rejects(f.api.createFilter(9,'ada@example.com','subject'),/Unsupported/);f.instance.onShutdown();});
