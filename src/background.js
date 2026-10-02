import {identity,metadata,Scheduler,LRU,PARSER_VERSION} from './core.js';
import * as db from './db.js';
import {withTimeout} from './async.js';
import {safeLink} from './message-text.js';
import {chooseBody,listAttachments} from './parser.js';
const session=crypto.randomUUID(), handles=new LRU(2048),knownHeaders=new LRU(2048),memory=new LRU();
const selections=new Map(),nativeThreads=new Map(),viewports=new Map(),metadataJobs=new Map();
function retainViewports(){scheduler.retain(new Set([...viewports.values()].flatMap(ids=>[...ids])));}
const worker=new Worker('worker.js',{type:'module'});let sequence=0;const jobs=new Map();
worker.onmessage=({data})=>{const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);clearTimeout(job.timer);data.error?job.reject(new Error(data.error)):job.resolve(data.result);};
worker.onerror=()=>{for(const j of jobs.values()){clearTimeout(j.timer);j.reject(new Error('Parser worker failed'));}jobs.clear();};
function parse(job){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{jobs.delete(id);reject(new Error('Parsing timed out'));},30000);jobs.set(id,{resolve,reject,timer});worker.postMessage({id,job});});}
function index(header){
  if(metadataJobs.has(header.id))return metadataJobs.get(header.id);
  const job=(async()=>{const id=identity(header,session);handles.set(id,header.id);knownHeaders.set(id,header);const headers=await withTimeout(messenger.messages.getHeaders(header.id),30000);const m=metadata(header,headers,session);await db.putMessage(m);return m;})();
  metadataJobs.set(header.id,job);job.finally(()=>metadataJobs.delete(header.id)).catch(()=>{});return job;
}
async function queryId(id){if(id.startsWith('local:'))throw new Error('This message has no stable Message-ID. Select it again in Thunderbird.');let page=await messenger.messages.query({headerMessageId:id,messagesPerPage:100,autoPaginationTimeout:100});
  try{while(true){for(const h of page.messages)if(identity(h,session)===id)return await index(h);if(!page.id)break;page=await messenger.messages.continueList(page.id);}throw Object.assign(new Error('Message is no longer available in Thunderbird.'),{code:'MESSAGE_UNAVAILABLE'});}
  finally{if(page?.id)await messenger.messages.abortList(page.id).catch(()=>{});}}
async function resolve(id,refresh=false){if(!refresh && handles.has(id))return handles.get(id);const m=await queryId(id);return m.thunderbirdId;}
// Thunderbird IDs are runtime handles; confirm one still points at a message before acting on it.
async function liveMessage(messageId){
  if(typeof messageId!=='string')throw new Error('Select a message first');
  let id=await resolve(messageId);try{return {id,header:await messenger.messages.get(id)};}catch{id=await resolve(messageId,true);return {id,header:await messenger.messages.get(id)};}
}
const fileName=(name,fallback)=>String(name || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]+/g,'_').replace(/^[.\s]+|[.\s]+$/g,'').slice(0,180) || fallback;
async function saveFile(file,name,saveAs=true){
  const url=URL.createObjectURL(file);
  try{await messenger.downloads.download({url,filename:fileName(name,'attachment'),saveAs,conflictAction:'uniquify'});return true;}
  catch(error){if(/cancel/i.test(error.message))return false;throw error;}
  // The download reads the URL asynchronously, so release it later; unref keeps Node tests from waiting on it.
  finally{setTimeout(()=>URL.revokeObjectURL(url),120000).unref?.();}
}
const MESSAGE_ACTIONS={
  forwardAttachment:({id})=>messenger.compose.beginForward(id,'forwardAsAttachment').then(()=>'Forward opened'),
  markRead:({id})=>messenger.messages.update(id,{read:true}).then(()=>'Marked as read'),
  markUnread:({id})=>messenger.messages.update(id,{read:false}).then(()=>'Marked as unread'),
  star:({id})=>messenger.messages.update(id,{flagged:true}).then(()=>'Starred'),
  unstar:({id})=>messenger.messages.update(id,{flagged:false}).then(()=>'Star removed'),
  openTab:({id})=>messenger.messageDisplay.open({messageId:id,location:'tab'}).then(()=>'Opened in a new tab'),
  openWindow:({id})=>messenger.messageDisplay.open({messageId:id,location:'window'}).then(()=>'Opened in a new window'),
  archive:({id})=>messenger.messages.archive([id]).then(()=>'Archived'),
  trash:({id})=>messenger.messages.delete([id],false).then(()=>'Moved to Trash'),
  saveAs:async({id,header})=>await saveFile(await messenger.messages.getRaw(id,{data_format:'File'}),`${header.subject || 'message'}.eml`)?'Message saved':'Save cancelled'
};
const scheduler=new Scheduler(async id=>{
  let m=await db.getMessage(id);const h=knownHeaders.get(id);if(!m || (h && m.size!==(h.size || 0))){m=h?await index(h).catch(()=>queryId(id)):await queryId(id);}
  const valid=b=>!m.deleted && b && b.parserVersion===PARSER_VERSION && b.size===m.size;
  let b=memory.get(id);if(valid(b))return b;b=await db.getBody(id);if(valid(b)){memory.set(id,b);db.putBody(b).catch(()=>{});return b;}
  messenger.runtime.sendMessage({type:'bodyStage',id,stage:'fetching'}).catch(()=>{});
  let full;try{full=await withTimeout(messenger.messages.getFull(await resolve(id)),30000);}catch(error){if(error.code==='TIMEOUT')throw error;full=await withTimeout(messenger.messages.getFull(await resolve(id,true)),30000);m=await db.getMessage(id);}
  messenger.runtime.sendMessage({type:'bodyStage',id,stage:'parsing'}).catch(()=>{});
  b=await parse({messageId:id,size:m.size,...chooseBody(full),attachments:listAttachments(full)});await db.putBody(b);memory.set(id,b);return b;
},3);
let indexing=false,status={phase:'Starting',indexed:0,error:null}, indexingEnabled=true;
function rememberSelection(tabId,selection){
  if(!selection){selections.delete(tabId);nativeThreads.delete(tabId);viewports.delete(tabId);retainViewports();return;}
  const id=identity(selection.selected,session);selections.set(tabId,id);nativeThreads.set(tabId,selection.messages);
  for(const h of selection.messages){const key=identity(h,session);handles.set(key,h.id);knownHeaders.set(key,h);}
  handles.set(id,selection.selected.id);knownHeaders.set(id,selection.selected);
}
async function selectionChanged(tabId,selection){
  rememberSelection(tabId,selection);viewports.delete(tabId);retainViewports();
  const selected=selections.get(tabId) || null;
  await messenger.runtime.sendMessage({type:'selection',tabId,selected}).catch(()=>{});
  if(selection){const h=selection.selected;const previous=await db.getMessage(selected);
    if(!previous?.rootId || previous.size!==(h.size||0))index(h).then(notifyIndex).catch(e=>{status.error=e.message;});}
}
messenger.threadsPane.onSelection.addListener(selectionChanged);
messenger.threadsPane.start().catch(e=>{status.error=e.message;});
messenger.browserAction.onClicked.addListener(async tab=>{
  try{await messenger.threadsPane.show(tab.id);await messenger.browserAction.setTitle({tabId:tab.id,title:'Threads'});await messenger.browserAction.setBadgeText({tabId:tab.id,text:''});}
  catch(e){status.error=e.message;await messenger.browserAction.setTitle({tabId:tab.id,title:`Threads: ${e.message}`});await messenger.browserAction.setBadgeText({tabId:tab.id,text:'!'});}
});
messenger.tabs.onRemoved.addListener(id=>{selections.delete(id);nativeThreads.delete(id);viewports.delete(id);retainViewports();});
async function discover(id){let changed=false;let m=await db.getMessage(id);if(!m)m=await queryId(id);let count=0;for(const ref of [...new Set([...m.references,...m.linkIds])]){if(count++>=100)break;if(!await db.getMessage(ref)){try{await queryId(ref);changed=true;}catch{/* Missing ancestors are valid. */}}}return changed;}
// Native Thunderbird threads are folder-local. Discover outgoing replies across
// folders using header-only candidates, then join strictly by RFC references.
const outgoingSearches=new LRU(100,1024*1024),outgoingJobs=new Map();
async function discoverOutgoing(id){
  const m=await db.getMessage(id);if(!m?.normalizedSubject)return;
  const key=m.normalizedSubject;
  if(Date.now()-(outgoingSearches.get(key)||0)<300000)return;
  if(outgoingJobs.has(key))return outgoingJobs.get(key);
  const job=(async()=>{
    const before=(await db.getThread(id)).messages.length;
    let page=await messenger.messages.query({subject:m.normalizedSubject,fromMe:true,messagesPerPage:100,autoPaginationTimeout:100});
    await eachMessage(page,async h=>{
      const existing=await db.getMessage(identity(h,session));
      if(!existing?.rootId || existing.size!==(h.size||0))await index(h);
      await yieldUI();
    });
    outgoingSearches.set(key,Date.now());
    if((await db.getThread(id)).messages.length!==before)await notifyIndex();
  })();
  outgoingJobs.set(key,job);try{await job;}finally{outgoingJobs.delete(key);}
}
messenger.runtime.onMessage.addListener(async msg=>{
  if(msg.type==='thread'){
    const tabId=msg.tabId;
    if(!selections.has(tabId)){const selection=await messenger.threadsPane.getSelection(tabId);rememberSelection(tabId,selection);}
    const id=selections.get(tabId);if(!id)return {messages:[],status:{...status,indexingEnabled}};
    const result=await db.getThread(id),records=new Map(result.messages.map(m=>[m.messageId,m]));
    const hints=nativeThreads.get(tabId)||[];
    // Native thread metadata provides an immediate skeleton even before indexing reaches this folder.
    for(const h of hints){const key=identity(h,session),existing=records.get(key);if(!existing)records.set(key,metadata(h,{},session));else records.set(key,{...existing,ccList:h.ccList ?? existing.ccList ?? [],bccList:h.bccList ?? existing.bccList ?? [],size:h.size ?? existing.size});}
    const messages=[...records.values()].sort((a,b)=>a.date-b.date || a.messageId.localeCompare(b.messageId));
    const viewKey=result.messages[0]?.rootId || identity(hints[0] || knownHeaders.get(id),session);
    const selectedHeader=knownHeaders.get(id);const indexed=await db.getMessage(id);
    const enrichment=indexed?Promise.resolve():index(selectedHeader).then(notifyIndex);
    withTimeout(enrichment.then(async()=>{const changed=await discover(id);if(changed)await notifyIndex();await discoverOutgoing(id);}),45000,'Thread discovery timed out. Refresh to try again.').then(()=>messenger.runtime.sendMessage({type:'threadDiscovery',tabId,requestId:msg.requestId})).catch(e=>{status.error=e.message;messenger.runtime.sendMessage({type:'threadDiscovery',tabId,requestId:msg.requestId,error:e.message}).catch(()=>{});});
    return {messages,selected:id,viewKey,discoveryPending:true,status:{...status,indexingEnabled}};
  }
  if(msg.type==='bodies'){const requested=msg.ids.slice(0,25);return Promise.all(requested.map(id=>scheduler.schedule(id,id===msg.selected?0:1).then(body=>{messenger.runtime.sendMessage({type:'bodyReady',id,body}).catch(()=>{});return {id,body};},error=>{messenger.runtime.sendMessage({type:'bodyError',id,error:error.message}).catch(()=>{});return {id,error:error.message};})));}
  if(msg.type==='viewport'){viewports.set(msg.tabId,new Set(msg.ids));retainViewports();return true;}
  if(msg.type==='addressBooks')return (await messenger.addressBooks.list()).filter(book=>!book.readOnly && !book.remote).map(({id,name})=>({id,name}));
  if(msg.type==='addressAction'){
    const email=msg.email;
    if(typeof email!=='string' || !/^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$/.test(email))throw new Error('Invalid email address');
    if(msg.action==='compose'){await messenger.compose.beginNew({to:[email]});return {message:`Compose opened for ${email}`};}
    if(msg.action==='filter'){await messenger.mailTabs.setQuickFilter(msg.tabId,{show:true,text:{text:email,author:true,recipients:true,subject:false,body:false}});return {message:`Filtering this folder for ${email}`};}
    if(msg.action==='createFilter'){await messenger.threadsPane.createFilter(msg.tabId,email,msg.header || 'from');return {message:'Message filter editor opened'};}
    if(msg.action==='contact'){
      const book=(await messenger.addressBooks.list()).find(b=>b.id===msg.bookId && !b.readOnly && !b.remote);
      if(!book)throw new Error('Choose a writable local address book');
      const existing=(await messenger.contacts.list(book.id)).find(c=>{
        const p=c.properties || {};const unfolded=(p.vCard || '').replace(/\r?\n[ \t]/g,'');
        return [p.PrimaryEmail,p.SecondEmail,...unfolded.split(/\r?\n/).filter(line=>/^EMAIL(?:;[^:]*)?:/i.test(line)).map(line=>line.slice(line.indexOf(':')+1))].some(value=>value?.toLowerCase()===email.toLowerCase());
      });
      if(existing)return {message:`${email} is already in ${book.name}`};
      const escaped=email.replace(/\\/g,'\\\\').replace(/,/g,'\\,');
      await messenger.contacts.create(book.id,{vCard:`BEGIN:VCARD\r\nVERSION:4.0\r\nFN:${escaped}\r\nEMAIL:${escaped}\r\nEND:VCARD\r\n`});
      return {message:`Added ${email} to ${book.name}`};
    }
    throw new Error('Unsupported address action');
  }
  if(msg.type==='compose'){
    if(!['reply','replyAll','forward'].includes(msg.action))throw new Error('Unsupported compose action');
    if(typeof msg.messageId!=='string')throw new Error('Select a message first');
    const open=async()=>{
      const id=await resolve(msg.messageId);
      return msg.action==='forward'?messenger.compose.beginForward(id,'forwardInline'):
        messenger.compose.beginReply(id,msg.action==='replyAll'?'replyToAll':'replyToSender');
    };
    // Validate the ephemeral handle before opening compose; never retry a successful compose.
    let id=await resolve(msg.messageId);
    try{await messenger.messages.get(id);}catch{await resolve(msg.messageId,true);}
    await open();return true;
  }
  if(msg.type==='originalMessage'){let id=await resolve(msg.messageId);try{await messenger.messages.get(id);}catch{id=await resolve(msg.messageId,true);}await messenger.mailTabs.setSelectedMessages(msg.tabId,[id]);await messenger.threadsPane.showOriginal(msg.tabId);return true;}
  if(msg.type==='messageState'){const {header}=await liveMessage(msg.messageId);return {read:!!header.read,flagged:!!header.flagged};}
  if(msg.type==='messageAction'){const action=MESSAGE_ACTIONS[msg.action];if(!action)throw new Error('Unsupported message action');return {message:await action(await liveMessage(msg.messageId))};}
  // The reader fetches previews itself with this handle, so file contents never pass through messaging.
  if(msg.type==='messageHandle')return (await liveMessage(msg.messageId)).id;
  if(msg.type==='attachment'){
    const {id}=await liveMessage(msg.messageId),parts=[].concat(msg.partName).filter(part=>typeof part==='string' && /^[\d.]+$/.test(part));
    if(!parts.length)throw new Error('Unknown attachment');
    if(msg.action==='open'){await messenger.messages.openAttachment(id,parts[0],msg.tabId);return {message:'Attachment opened'};}
    if(msg.action==='save'){
      // Saving several files at once goes straight to the download folder instead of one dialog per file.
      let saved=0;for(const part of parts){const file=await messenger.messages.getAttachmentFile(id,part);if(await saveFile(file,file.name,parts.length===1))saved++;}
      return {message:saved?`Saved ${saved===1?'attachment':`${saved} attachments`}`:'Save cancelled'};
    }
    throw new Error('Unsupported attachment action');
  }
  if(msg.type==='nativeView'){await messenger.threadsPane.showOriginal(msg.tabId);return true;}
  if(msg.type==='openLink'){const url=safeLink(msg.url);if(!url)throw new Error('Unsupported link');if(url.startsWith('mailto:')){await messenger.compose.beginNew({to:[decodeURIComponent(new URL(url).pathname)]});}else await messenger.windows.openDefaultBrowser(url);return true;}
  if(msg.type==='status')return {...status,indexingEnabled};
  if(msg.type==='rescan'){for(const days of [30,180,null])await db.setState(`complete:${days}`,false);await setIndexing(true);scan();return true;}
  if(msg.type==='pause'){await setIndexing(!indexingEnabled);return {enabled:indexingEnabled};}
});
const yieldUI=()=>new Promise(r=>setTimeout(r,15));
async function scan(){if(indexing)return;indexing=true;status.error=null;
  try{for(const days of [30,180,null]){if(!indexingEnabled)break;const key=`complete:${days}`;if(await db.getState(key))continue;status.phase=days?`Indexing last ${days} days`:'Indexing older mail';let page;
    try{page=await messenger.messages.query({...(days?{fromDate:new Date(Date.now()-days*86400000)}:{}),messagesPerPage:100,autoPaginationTimeout:100});
      while(true){for(let i=0;i<page.messages.length;i+=4){if(!indexingEnabled)break;await Promise.all(page.messages.slice(i,i+4).map(async h=>{const existing=await db.getMessage(identity(h,session));handles.set(identity(h,session),h.id);if(!existing?.rootId || existing.size!==(h.size||0)){await index(h);status.indexed++;}}));await yieldUI();}
        await notifyIndex();if(!indexingEnabled || !page.id)break;page=await messenger.messages.continueList(page.id);}
      if(indexingEnabled)await db.setState(key,true);
    }finally{if(page?.id)await messenger.messages.abortList(page.id).catch(()=>{});}}
    if(indexingEnabled){const recent=await messenger.messages.query({fromDate:new Date(Date.now()-2*86400000),messagesPerPage:100,autoPaginationTimeout:100});await eachMessage(recent,async h=>{const previous=await db.getMessage(identity(h,session));if(!previous?.rootId || previous.size!==(h.size||0)){await index(h);status.indexed++;}await yieldUI();});await notifyIndex();}
    status.phase=indexingEnabled?'Index ready':'Indexing paused';await db.pruneBodies();
  }catch(e){status.phase='Indexing interrupted';status.error=e.message;}finally{indexing=false;}}
async function eachMessage(list,callback){let page=list;try{while(page){for(const h of page.messages)await callback(h);if(!page.id)break;page=await messenger.messages.continueList(page.id);}}finally{if(page?.id)await messenger.messages.abortList(page.id).catch(()=>{});}}
async function notifyIndex(){await messenger.runtime.sendMessage({type:'indexUpdated'}).catch(()=>{});}
async function indexList(list){outgoingSearches.clear();await eachMessage(list,index);await notifyIndex();}
messenger.compose.onAfterSend?.addListener(async (_tab,info)=>{
  if(info.error || info.mode!=='sendNow')return;
  try{await indexList({messages:info.messages || []});}catch(e){status.error=e.message;}
});
messenger.messages.onNewMailReceived.addListener((folder,list)=>{indexList(list).catch(e=>{status.error=e.message;});},true);
messenger.messages.onMoved.addListener((oldList,newList)=>{eachMessage(oldList,h=>handles.delete(identity(h,session))).then(()=>indexList(newList)).catch(e=>{status.error=e.message;});});
messenger.messages.onCopied.addListener((oldList,newList)=>{indexList(newList).catch(()=>{});});
messenger.messages.onDeleted.addListener(list=>{eachMessage(list,async h=>{
  const id=identity(h,session);handles.delete(id);
  try{await queryId(id);}catch(error){if(error.code==='MESSAGE_UNAVAILABLE'||id.startsWith('local:'))await db.deleteMessage(id);else throw error;}
}).then(notifyIndex).catch(e=>{status.error=e.message;});});
async function setIndexing(value){const enabled=value!==false;indexingEnabled=enabled;await db.setState('indexingEnabled',enabled);await messenger.storage.local.set({indexingEnabled:enabled});if(indexingEnabled)scan();}
let indexingPreferenceChanged=false;
messenger.storage.onChanged.addListener((changes,area)=>{if(area!=='local' || !changes.indexingEnabled)return;indexingPreferenceChanged=true;const enabled=changes.indexingEnabled.newValue!==false;if(enabled===indexingEnabled)return;indexingEnabled=enabled;db.setState('indexingEnabled',enabled).catch(e=>{status.error=e.message;});if(enabled)scan();});
Promise.all([messenger.storage.local.get('indexingEnabled'),db.getState('indexingEnabled')]).then(async ([saved,legacy])=>{
  if(!indexingPreferenceChanged){indexingEnabled=typeof saved.indexingEnabled==='boolean'?saved.indexingEnabled:legacy!==false;if(saved.indexingEnabled===undefined)await messenger.storage.local.set({indexingEnabled});}
  return scan();
}).catch(e=>{status.error=e.message;});
setInterval(()=>{if(indexingEnabled)scan();db.pruneBodies().catch(()=>{});},300000);
