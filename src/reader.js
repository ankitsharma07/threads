import {bindIndexControls} from './index-controls.js';
import {bindPreferences,applyTypography} from './preferences.js';
import {appendBlocks} from './message-text.js';
import {withTimeout} from './async.js';
import {createAddressMenu} from './address-menu.js';
import {createCardMenu} from './card-menu.js';
import {LRU,PARSER_VERSION} from './core.js';
import {orderedMessages,latestId,parseAddresses,displayName,initials,hue,isExpanded,conversationView} from './view-model.js';
const $=id=>document.getElementById(id), scroller=$('scroller'),list=$('list'),group=$('thread-group');
// Rows are laid out in normal flow between two spacers, so measured or not, cards can never overlap.
// Heights are only used to size the spacers for unmounted rows and to pick the mounted range.
// Overscan is in pixels, not rows: three collapsed rows are only ~200px, which async scrolling outruns.
const GAP=12,GROUP_HEIGHT=44,MAX_ROWS=24,OVERSCAN_PX=600;
let messages=[],selected=null,heights=new Map(),offsets=[],total=0,epoch=0,lastRange='',refreshTimer,frame=0,needsRender=false,mountedRange='',groupState='',progressState='';
// inflight maps a message to the request that owns it, so a stale batch can never clear or fail a newer request.
const bodies=new LRU(80),liveBodies=new Map(),errors=new LRU(100),inflight=new Map(),openDetails=new Map();let requestSeq=0;
let visibleIds=new Set();
const bodyFor=id=>{const b=liveBodies.get(id)||bodies.get(id);return b && b.parserVersion===PARSER_VERSION && b.size===metadataById.get(id)?.size?b:undefined;};
let metadataById=new Map(),metadataLoading=false,discoveryLoading=false,progressTimer;const bodyStages=new Map();
const report=message=>{$('status').textContent=message;};
function updateProgress(){
  const active=messages.filter(m=>visibleIds.has(m.messageId) && expanded(m.messageId));
  const pending=active.filter(m=>!bodyFor(m.messageId) && !errors.has(m.messageId));
  const busy=metadataLoading || discoveryLoading || pending.length>0;
  const label=metadataLoading?'Reading thread metadata…':pending.length?`${pending.some(m=>bodyStages.get(m.messageId)==='parsing')?'Formatting':'Loading'} messages · ${active.length-pending.length} of ${active.length} ready`:discoveryLoading?'Finding sent replies…':'Conversation ready';
  // Runs on every render; unchanged progress must not touch the DOM.
  if(progressState===`${busy}|${label}`)return;progressState=`${busy}|${label}`;clearTimeout(progressTimer);
  scroller.setAttribute('aria-busy',String(busy));$('loading-label').textContent=label;$('loading-bar').setAttribute('aria-valuetext',label);
  if(busy){$('loading').hidden=false;}else{progressTimer=setTimeout(()=>{$('loading').hidden=true;},250);}
}

function receiveBody(id,body){if(body?.parserVersion!==PARSER_VERSION)return;if(metadataById.has(id) && body.size!==metadataById.get(id).size){metadataById.set(id,{...metadataById.get(id),size:body.size});}errors.delete(id);bodies.set(id,body);if(visibleIds.has(id))liveBodies.set(id,body);}
const tabId=Number(new URL(location.href).searchParams.get('tabId'));
const send=msg=>messenger.runtime.sendMessage({...msg,tabId});
const addressMenu=createAddressMenu({document,window,send,report}),cardMenu=createCardMenu({document,window});
let viewKey=null,order='chronological',latest=null,groupOpen=false,allowRemoteContent=false,foldLongThreads=true,inlineAttachments=true;
const contentKey=()=>`${allowRemoteContent}|${inlineAttachments}`;
let displayMessages=[];
function updateGroup(){
  const view=conversationView(messages,{fold:foldLongThreads,open:groupOpen});
  displayMessages=view.messages;
  const label=`${messages.length} messages · ${groupOpen?'Hide middle messages':`Show ${view.hidden} more messages`}`,state=`${view.grouped}|${groupOpen}|${label}`;
  if(state===groupState)return;groupState=state;
  group.hidden=!view.grouped;group.textContent=label;group.setAttribute('aria-expanded',String(groupOpen));
}
const expansion=new Map();
const expanded=id=>isExpanded(id,expansion,latest);
// Unmeasured rows are estimated from rows already measured, so spacers stay close to the real layout.
const measured={expanded:new Map(),expandedSum:0,collapsed:68};
const estimate=id=>expanded(id)?(measured.expanded.size?measured.expandedSum/measured.expanded.size:330):measured.collapsed;
function remember(row,height){
  if(row.dataset.state==='collapsed'){measured.collapsed=height;return;}
  if(row.dataset.state!=='ready')return;
  const id=row.dataset.id;measured.expandedSum+=height-(measured.expanded.get(id) || 0);measured.expanded.set(id,height);
}
// Motion is transform/opacity only, so it never changes measured heights or the mounted range.
const reducedMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),EASE='cubic-bezier(.22,1,.36,1)';
function animate(node,keyframes,options={}){if(!node?.animate || reducedMotion?.matches)return;node.animate(keyframes,{duration:220,easing:EASE,...options});}
const reveal=(node,options)=>animate(node,[{opacity:0,transform:'translateY(-6px)'},{opacity:1,transform:'none'}],options);
const mountedRows=()=>[...list.children].filter(node=>node.dataset.id!==undefined);
// FLIP: rows that a change displaced glide from their old position instead of jumping.
function glide(change,skip){
  const before=new Map([...mountedRows(),group].map(node=>[node.dataset.id ?? 'group',node.getBoundingClientRect?.().top]));
  change();
  for(const node of [...mountedRows(),group]){
    const key=node.dataset.id ?? 'group',from=before.get(key);if(key===skip || !Number.isFinite(from) || node.hidden)continue;
    const delta=from-node.getBoundingClientRect().top;
    if(Math.abs(delta)>0.5 && Math.abs(delta)<scroller.clientHeight*1.5)animate(node,[{transform:`translateY(${delta}px)`},{transform:'none'}],{duration:260});
  }
}
function scheduleRender(){needsRender=true;queueFrame();}
// Scrolling only re-renders when the mounted range changes; otherwise the browser just scrolls.
function queueFrame(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(needsRender || rangeFor(scroller.scrollTop).join()!==mountedRange)render();});}
function rowFor(id){return [...list.children].find(node=>node.dataset.id===id);}
function toggleMessage(id){
  // Keep the clicked header exactly where it was, so a quick second click lands on the same card.
  const header=rowFor(id)?.firstChild,viewTop=scroller.getBoundingClientRect().top,before=header?.getBoundingClientRect().top;
  glide(()=>{
    expansion.set(id,!expanded(id));heights.delete(id);lastRange='';render();
    const after=rowFor(id)?.firstChild?.getBoundingClientRect().top;
    // A sticky header of a long message may sit above its card's real top; then return to the card's start instead.
    const target=Number.isFinite(before)?Math.max(before,viewTop):NaN;
    if(Number.isFinite(after) && Number.isFinite(target) && Math.abs(after-target)>0.5)render(scroller.scrollTop+after-target);
  },id);
  const row=rowFor(id);
  if(expanded(id))reveal(row?.children[1]);else reveal(row?.querySelector?.('.snippet'),{duration:180});
}
function element(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
const paths={reply:'M10 5 3 12l7 7 M3 12h10c5 0 8 3 8 7',replyAll:'M7 5 0 12l7 7 M13 5 6 12l7 7 M6 12h8c5 0 8 3 8 7',forward:'m14 5 7 7-7 7 M21 12H10c-5 0-7 3-7 7',copy:'M8 8h12v13H8z M16 8V3H3v13h5',chevron:'m9 6 6 6-6 6',alert:'M12 8v5 M12 16.5v.5 M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',image:'M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15 9.5v.01',attach:'M20.5 11.5 12.4 19.6a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8',download:'M12 4v11 M7 10.5l5 5 5-5 M5 20h14',more:'M5.5 12h.01 M12 12h.01 M18.5 12h.01'};
function icon(name,weight=name==='more'?3:1.7){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','18');svg.setAttribute('height','18');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]);path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width',String(weight));path.setAttribute('stroke-linejoin','round');path.setAttribute('stroke-linecap','round');svg.append(path);return svg;
}
const topSpacer=element('div',undefined,'spacer'),bottomSpacer=element('div',undefined,'spacer');topSpacer.setAttribute('aria-hidden','true');bottomSpacer.setAttribute('aria-hidden','true');
function layout(){
  let y=0;updateGroup();
  offsets=displayMessages.map((m,i)=>{if(i===1 && !group.hidden)y+=GROUP_HEIGHT+GAP;const top=y;y+=(heights.get(m.messageId)||estimate(m.messageId))+GAP;return top;});
  total=y;
}
function lowerBound(y){let lo=0,hi=offsets.length;while(lo<hi){const mid=(lo+hi)>>1;if(offsets[mid]<y)lo=mid+1;else hi=mid;}return Math.max(0,lo-1);}
function rangeFor(scrollTop){
  const top=scrollTop-(list.offsetTop || 0),bottom=top+scroller.clientHeight,first=lowerBound(top),last=lowerBound(bottom);
  let start=lowerBound(Math.max(0,top-OVERSCAN_PX)),end=Math.min(displayMessages.length,lowerBound(bottom+OVERSCAN_PX)+1);
  // Visible rows always mount; overscan is trimmed evenly when the cap is reached.
  if(end-start>MAX_ROWS){const room=Math.max(0,MAX_ROWS-(last+1-first));start=first-Math.min(first-start,room>>1);end=Math.min(end,Math.max(last+1,start+MAX_ROWS));}
  return [start,end];
}
const observer=new ResizeObserver(entries=>{
  let changed=false;
  for(const {target} of entries){if(!target.isConnected)continue;const id=target.dataset.id,height=target.getBoundingClientRect().height;if(height>0)remember(target,height);if(height>0 && Math.abs(height-(heights.get(id)||estimate(id)))>1){heights.set(id,height);changed=true;}}
  // Mounted rows reflow on their own; only the spacers and mounted range depend on these measurements.
  if(changed)scheduleRender();
});
function shortDate(value){
  const date=new Date(value),now=new Date();
  if(date.toDateString()===now.toDateString())return date.toLocaleTimeString(undefined,{timeStyle:'short'});
  return date.toLocaleDateString(undefined,date.getFullYear()===now.getFullYear()?{month:'short',day:'numeric'}:{dateStyle:'medium'});
}
function longDate(value){
  // Expanded cards show the time too; recent days read naturally.
  const date=new Date(value),now=new Date(),time=date.toLocaleTimeString(undefined,{timeStyle:'short'}),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  if(date.toDateString()===now.toDateString())return `Today, ${time}`;
  if(date.toDateString()===yesterday.toDateString())return `Yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined,date.getFullYear()===now.getFullYear()?{month:'short',day:'numeric'}:{dateStyle:'medium'})}, ${time}`;
}
// A disclosure whose open state survives the card being rebuilt or scrolled out and back.
function disclosure(id,key,className){
  const details=element('details',undefined,className);details.open=!!openDetails.get(id)?.has(key);
  // Restoring the open state on a rebuilt card fires one toggle event; only reader clicks animate.
  let restoring=details.open;
  details.ontoggle=()=>{
    const set=openDetails.get(id) || new Set();if(details.open)set.add(key);else set.delete(key);openDetails.set(id,set);
    if(!restoring && details.open)reveal(details.lastChild,{duration:200});restoring=false;
  };
  return details;
}
function toggleLabels(closed,opened){const box=element('span',undefined,'toggle-labels');box.append(element('span',closed,'when-closed'),element('span',opened,'when-open'));return box;}
function avatar(author){const a=element('span',initials(author),'avatar');a.style.setProperty('--hue',String(hue(parseAddresses(author)[0]?.email || author)));a.setAttribute('aria-hidden','true');return a;}
function addressList(label,value){
  const entries=parseAddresses(value),dd=element('dd');
  if(!entries.length){dd.append(element('span','—','address-none'));return dd;}
  for(const {name,email,text} of entries){
    const entry=element('span',undefined,'address-entry');
    if(!email){entry.append(element('span',text,'address-name'));dd.append(entry);continue;}
    const address=element('button',name || email,'address-label');address.type='button';address.title=email;address.setAttribute('aria-haspopup','menu');
    const open=()=>addressMenu.open(address,email,label.toLowerCase());
    address.onmouseenter=()=>addressMenu.hoverOpen(address,email,label.toLowerCase());address.onfocus=open;address.onclick=open;
    address.onkeydown=event=>{if(event.key==='ArrowDown'){open();addressMenu.focusFirst();event.preventDefault();}};
    address.oncontextmenu=event=>{event.preventDefault();open();};address.onmouseleave=()=>addressMenu.scheduleClose();entry.append(address);
    if(name)entry.append(element('span',email,'address-email'));
    const copy=element('button',undefined,'copy-address');copy.type='button';copy.title=`Copy ${email}`;copy.setAttribute('aria-label',`Copy ${email}`);copy.append(icon('copy'));
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(email);report(`Copied ${email}`);}catch(e){report(`Could not copy address: ${e.message}`);}};
    entry.append(copy);dd.append(entry);
  }
  return dd;
}
function formatSize(bytes){
  if(bytes<1024)return `${bytes} B`;const units=['KB','MB','GB'];let value=bytes/1024,unit=0;
  while(value>=1024 && unit<units.length-1){value/=1024;unit++;}
  return `${value<10?value.toFixed(1):Math.round(value)} ${units[unit]}`;
}
function fileKind(item){
  const type=item.contentType,name=item.name.toLowerCase();
  if(type.startsWith('image/'))return 'image';if(type==='application/pdf' || name.endsWith('.pdf'))return 'pdf';
  if(/zip|compressed|tar|rar|7z/.test(type) || /\.(zip|rar|7z|tar|gz)$/.test(name))return 'archive';
  if(/sheet|excel|csv/.test(type) || /\.(xlsx?|csv|ods)$/.test(name))return 'sheet';
  if(/word|document|text|rtf/.test(type) || /\.(docx?|odt|txt|rtf|md)$/.test(name))return 'doc';
  if(type==='message/rfc822' || name.endsWith('.eml'))return 'mail';
  return 'file';
}
const fileBadge=item=>(item.name.match(/\.([a-z0-9]{1,4})$/i)?.[1] || {image:'IMG',pdf:'PDF',mail:'EML'}[fileKind(item)] || 'FILE').toUpperCase();
function attachmentAction(id,partName,action){send({type:'attachment',messageId:id,partName,action}).then(result=>report(result.message)).catch(e=>report(e.message));}
// Inline previews read the file directly from Thunderbird and are cached as object URLs, so
// scrolling a card out and back in never refetches it.
const PREVIEW_LIMIT=15*1024*1024,previews=new Map();
const previewable=item=>item.contentType.startsWith('image/') && (!item.size || item.size<=PREVIEW_LIMIT);
function previewUrl(id,item){
  const key=`${id}|${item.partName}`;let entry=previews.get(key);
  if(entry){previews.delete(key);previews.set(key,entry);return entry;}
  entry=send({type:'messageHandle',messageId:id}).then(handle=>messenger.messages.getAttachmentFile(handle,item.partName)).then(file=>URL.createObjectURL(file));
  previews.set(key,entry);entry.catch(()=>previews.delete(key));
  while(previews.size>40){const [oldest,old]=previews.entries().next().value;previews.delete(oldest);old.then(url=>URL.revokeObjectURL(url),()=>{});}
  return entry;
}
function attachmentsFor(id,b){
  const items=b.attachments || [];if(!items.length)return null;
  const section=element('section',undefined,'attachments');section.setAttribute('aria-label','Attachments');
  const total=items.reduce((sum,item)=>sum+(item.size || 0),0),head=element('div',undefined,'attachments-head');
  head.append(icon('attach'),element('span',`${items.length} ${items.length===1?'attachment':'attachments'}${total?` · ${formatSize(total)}`:''}`,'attachments-title'));
  if(items.length>1){const all=element('button','Save all','link-button');all.type='button';all.onclick=()=>attachmentAction(id,items.map(item=>item.partName),'save');head.append(all);}
  section.append(head);
  const images=inlineAttachments?items.filter(previewable):[];
  if(images.length){
    const grid=element('div',undefined,'attachment-previews');
    for(const item of images){
      const tile=element('button',undefined,'attachment-preview');tile.type='button';tile.title=`Open ${item.name}`;tile.setAttribute('aria-label',`Open ${item.name}`);tile.onclick=()=>attachmentAction(id,item.partName,'open');
      const img=element('img',undefined,'fade-image');img.setAttribute('alt',item.name);img.onload=()=>img.classList.toggle('loaded',true);tile.append(img);grid.append(tile);
      previewUrl(id,item).then(url=>img.setAttribute('src',url)).catch(()=>{tile.className+=' failed';});
    }
    section.append(grid);
  }
  const files=element('ul',undefined,'attachment-list');
  for(const item of items){
    const entry=element('li',undefined,'attachment'),badge=element('span',fileBadge(item),`attachment-badge ${fileKind(item)}`);badge.setAttribute('aria-hidden','true');
    const name=element('button',item.name,'attachment-name');name.type='button';name.title=`Open ${item.name}`;name.onclick=()=>attachmentAction(id,item.partName,'open');
    const save=element('button',undefined,'attachment-save');save.type='button';save.title=`Save ${item.name}`;save.setAttribute('aria-label',`Save ${item.name}`);save.append(icon('download'));save.onclick=()=>attachmentAction(id,item.partName,'save');
    entry.append(badge,name,element('span',item.size?formatSize(item.size):'','attachment-size'),save);files.append(entry);
  }
  section.append(files);return section;
}
async function copyText(text,message){try{await navigator.clipboard.writeText(text);report(message);}catch(e){report(`Could not copy: ${e.message}`);}}
function menuItems(id,state){
  const act=action=>()=>send({type:'messageAction',messageId:id,action}).then(result=>report(result.message)).catch(e=>report(e.message));
  const compose=action=>()=>send({type:'compose',messageId:id,action}).catch(e=>report(e.message));
  const b=bodyFor(id),attachments=b?.attachments || [];
  return [
    {label:'Reply',run:compose('reply')},{label:'Reply all',run:compose('replyAll')},{label:'Forward',run:compose('forward')},{label:'Forward as attachment',run:act('forwardAttachment')},null,
    state?.read===false?{label:'Mark as read',run:act('markRead')}:{label:'Mark as unread',run:act('markUnread')},
    state?.flagged?{label:'Remove star',run:act('unstar')}:{label:'Star',run:act('star')},null,
    {label:'Open in new tab',run:act('openTab')},{label:'Open in new window',run:act('openWindow')},{label:'Show original message',run:()=>send({type:'originalMessage',messageId:id}).catch(e=>report(e.message))},null,
    ...(b?.text?[{label:'Copy message text',run:()=>copyText(b.text,'Message text copied')}]:[]),
    ...(id.startsWith('local:')?[]:[{label:'Copy Message-ID',run:()=>copyText(`<${id}>`,'Message-ID copied')}]),
    {label:'Save as .eml…',run:act('saveAs')},
    ...(attachments.length?[{label:attachments.length===1?'Save attachment':`Save all ${attachments.length} attachments`,run:()=>attachmentAction(id,attachments.map(item=>item.partName),'save')}]:[]),null,
    {label:'Archive',run:act('archive')},{label:'Move to Trash',run:act('trash'),danger:true}
  ];
}
function moreButton(m){
  const id=m.messageId,button=element('button',undefined,'card-more');button.type='button';button.title='More actions';
  button.setAttribute('aria-label',`More actions for message from ${displayName(m.author)}`);button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.append(icon('more'));
  // Open with best-guess labels, then correct read/starred state once Thunderbird answers.
  const open=()=>{if(cardMenu.anchor===button){cardMenu.hide();return false;}cardMenu.open(button,menuItems(id,null));send({type:'messageState',messageId:id}).then(state=>cardMenu.update(button,menuItems(id,state))).catch(()=>{});return true;};
  button.onclick=open;button.onkeydown=event=>{if(event.key==='ArrowDown' || event.key==='Enter' || event.key===' '){if(cardMenu.anchor!==button)open();cardMenu.focusFirst();event.preventDefault();}};
  return button;
}
function preview(b){return (b?.text || '').replace(/\s+/g,' ').trim().slice(0,220);}
function buildRow(m,i,state,b,error){
  const id=m.messageId,open=expanded(id);
  const row=element('article',undefined,`row ${open?'expanded':'collapsed'}`);row.dataset.id=id;row.dataset.index=i;row.dataset.state=state;row.bodyPayload=b;
  const meta=element('button',undefined,'meta');meta.type='button';meta.setAttribute('aria-expanded',String(open));meta.setAttribute('aria-label',`${open?'Collapse':'Expand'} message from ${m.author}`);meta.onclick=()=>toggleMessage(id);
  const who=element('span',undefined,'meta-text'),line=element('span',undefined,'meta-line'),[sender]=parseAddresses(m.author);
  line.append(element('span',displayName(m.author),'author'));if(sender?.name && sender.email)line.append(element('span',sender.email,'author-email'));
  who.append(line);
  // Expanded cards list recipients in their own disclosure below the header, so the header stays short.
  const sub=open?'':preview(b);
  if(sub)who.append(element('span',sub,'snippet'));
  const date=element('time',open?longDate(m.date):shortDate(m.date),'date');date.setAttribute('datetime',new Date(m.date).toISOString());date.title=new Date(m.date).toLocaleString(undefined,{dateStyle:'full',timeStyle:'short'});
  const side=element('span',undefined,'meta-side');
  if(b?.attachments?.length){const clip=element('span',undefined,'meta-attach');clip.title=`${b.attachments.length} ${b.attachments.length===1?'attachment':'attachments'}`;clip.append(icon('attach'));side.append(clip);}
  side.append(date);
  const chevron=element('span',undefined,'chevron');chevron.append(icon('chevron'));meta.append(avatar(m.author),who,side,chevron);
  // The menu button sits beside the header button; interactive controls cannot nest inside a button.
  const header=element('div',undefined,'row-header');header.append(meta,moreButton(m));row.append(header);
  if(!open)return row;
  const content=element('div',undefined,'row-content');
  const addresses=element('dl',undefined,'addresses');
  for(const [label,value] of [['From',m.author],['To',m.recipients],['Cc',m.ccList],['Bcc',m.bccList]]){
    if(label!=='From' && label!=='To' && !parseAddresses(value).length)continue;
    addresses.append(element('dt',label),addressList(label,value));
  }
  const people=disclosure(id,'Recipients','recipients');
  const names=value=>parseAddresses(value).map(r=>r.name || r.email),to=names(m.recipients),cc=names(m.ccList),bcc=names(m.bccList);
  const summary=element('summary',undefined,'recipients-summary'),recipientsLine=[to.length?`to ${to.join(', ')}`:'to undisclosed recipients',cc.length?`cc ${cc.join(', ')}`:'',bcc.length?`bcc ${bcc.join(', ')}`:''].filter(Boolean).join(' · ');
  summary.append(element('span',recipientsLine,'recipients-line'),toggleLabels('Details','Hide details'));summary.title=recipientsLine;
  people.append(summary,addresses);content.append(people);
  const bodyElement=element('div',undefined,'body'+(!b?(error?' failed':' loading'):''));
  if(b){bodyElement.tabIndex=0;appendBlocks(bodyElement,b.blocks?.length?b.blocks:[{type:'text',text:b.text || '(No text body)'}],document,send,report);
    if(b.remoteImages?.length){
      const remote=element('div',undefined,'remote-content');
      if(allowRemoteContent){for(const item of b.remoteImages){const img=element('img',undefined,'fade-image');img.onload=img.onerror=()=>img.classList.toggle('loaded',true);img.setAttribute('referrerpolicy','no-referrer');img.setAttribute('loading','lazy');img.setAttribute('alt',item.alt || 'Remote image');img.setAttribute('src',item.src);remote.append(img);}}
      else {const button=element('button',`Allow remote content (${b.remoteImages.length} images)`,'button notice');button.type='button';button.prepend(icon('image'));button.onclick=()=>setRemoteContent(true);remote.append(button);}
      bodyElement.append(remote);
    }
  }else if(error){bodyElement.append(icon('alert'),element('span',error));}
  else {bodyElement.setAttribute('aria-label','Loading message');for(const width of [92,78,85,40])bodyElement.append(Object.assign(element('span',undefined,'skeleton'),{style:`width:${width}%`}));}
  content.append(bodyElement);
  if(error){
    const recovery=element('div',undefined,'recovery');
    const retry=element('button','Retry','button');retry.type='button';retry.onclick=()=>{errors.delete(id);lastRange='';render();};
    const original=element('button','Original message','button');original.type='button';original.onclick=()=>send({type:'originalMessage',messageId:id}).catch(e=>report(e.message));
    recovery.append(retry,original);content.append(recovery);
  }
  const attachments=b && attachmentsFor(id,b);if(attachments)content.append(attachments);
  if(b?.signature){
    // The collapsed signature previews its first lines, so a name and title are readable without opening it.
    const details=disclosure(id,'Signature','extra signature'),summary=element('summary',undefined,'extra-summary'),body=element('div',undefined,'extra-body');
    const lines=b.signature.split('\n').map(line=>line.trim()).filter(line=>line && !/^[-—–_=*~]+$/.test(line));
    summary.title='Signature';summary.append(element('span','—','signature-dash'),element('span',lines.slice(0,3).join(' · ') || 'Signature','extra-preview when-closed'),element('span','Hide signature','when-open'));
    appendBlocks(body,b.signatureBlocks || [{type:'text',text:b.signature}],document,send,report);details.append(summary,body);content.append(details);
  }
  if(b?.quote){
    const details=disclosure(id,'Quoted history','extra quote'),summary=element('summary',undefined,'extra-summary'),body=element('div',undefined,'extra-body');
    const attribution=b.quoteBlocks?.find(block=>block.type==='attribution')?.text;
    const dots=element('span',undefined,'quote-dots');dots.append(icon('more'));
    summary.append(dots,toggleLabels('Show quoted text','Hide quoted text'));if(attribution)summary.append(element('span',attribution,'extra-preview when-closed'));
    appendBlocks(body,b.quoteBlocks || [{type:'text',text:b.quote}],document,send,report);details.append(summary,body);content.append(details);
  }
  const actions=element('div',undefined,'message-actions');
  for(const [label,action] of [['Reply','reply'],['Reply all','replyAll'],['Forward','forward']]){
    const button=element('button',undefined,'action-icon');button.type='button';button.title=label;button.setAttribute('aria-label',label);button.append(icon(action),element('span',label,'action-label'));
    button.onclick=async()=>{button.disabled=true;try{await send({type:'compose',messageId:id,action});}catch(e){report(e.message);}finally{button.disabled=false;}};
    actions.append(button);
  }
  content.append(actions);row.append(content);
  return row;
}
function render(scrollTo){
  if(frame){globalThis.cancelAnimationFrame?.(frame);frame=0;}
  needsRender=false;layout();
  const scrollTop=Math.max(0,scrollTo ?? scroller.scrollTop),[start,end]=rangeFor(scrollTop);mountedRange=`${start},${end}`;
  const wanted=new Set(displayMessages.slice(start,end).map(m=>m.messageId));visibleIds=wanted;
  for(const id of liveBodies.keys())if(!wanted.has(id))liveBodies.delete(id);
  for(const node of [...list.children])if(node.dataset.id!==undefined && !wanted.has(node.dataset.id)){observer.unobserve(node);node.remove();}
  const existing=new Map([...list.children].filter(node=>node.dataset.id!==undefined).map(x=>[x.dataset.id,x]));
  const ordered=[topSpacer];let refocus=null;
  for(let i=start;i<end;i++){
    const m=displayMessages[i],b=bodyFor(m.messageId),error=errors.get(m.messageId),state=!expanded(m.messageId)?'collapsed':b?'ready':error?'error':'loading',metadataKey=JSON.stringify([m.author,m.recipients,m.ccList,m.bccList,m.date]);
    let row=existing.get(m.messageId);
    if(!row || row.dataset.state!==state || row.dataset.metadata!==metadataKey || row.dataset.content!==contentKey() || row.bodyPayload!==b){
      const arriving=(row?.dataset.state==='loading' || row?.dataset.state==='error') && state==='ready';
      const focused=row?.contains(document.activeElement) && document.activeElement?.classList?.contains('meta');
      if(row){if(addressMenu.anchor && row.contains(addressMenu.anchor))addressMenu.hide();if(cardMenu.anchor && row.contains(cardMenu.anchor))cardMenu.hide();observer.unobserve(row);row.remove();}
      row=buildRow(m,i,state,b,error);row.dataset.metadata=metadataKey;row.dataset.content=contentKey();
      list.append(row);observer.observe(row);
      if(focused)refocus=row.firstChild.firstChild;
      // The skeleton dissolves into the message rather than being swapped out.
      if(arriving)animate(row.children[1]?.querySelector?.('.body'),[{opacity:0},{opacity:1}],{duration:280});
    }
    row.classList.toggle('selected',m.messageId===selected);if(row.dataset.index!==String(i))row.dataset.index=i;ordered.push(row);
    if(i===0)ordered.push(group);
  }
  if(start>0)ordered.splice(1,0,group);
  group.classList.toggle('offscreen',start>0);
  ordered.push(bottomSpacer);
  const setHeight=(node,px)=>{if(node.style.height!==`${px}px`)node.style.height=`${px}px`;};
  setHeight(topSpacer,offsets[start] || 0);
  setHeight(bottomSpacer,Math.max(0,total-(end<offsets.length?offsets[end]:total)));
  for(let i=0;i<ordered.length;i++)if(list.children[i]!==ordered[i])list.insertBefore(ordered[i],list.children[i] || null);
  // Rebuilt cards replace the focused header; restore focus once the card is in its final position (moving a node blurs it).
  refocus?.focus({preventScroll:true});
  // When content above the fold shrinks (a card near the end collapses), the browser would clamp the
  // scroll position and pull every card downwards. Pad the end instead; the padding lies below the
  // viewport and disappears naturally as the reader scrolls back up.
  const deficit=scrollTop+scroller.clientHeight-scroller.scrollHeight;
  if(deficit>0)setHeight(bottomSpacer,parseFloat(bottomSpacer.style.height)+deficit);
  if(deficit>0 || scrollTo!==undefined)scroller.scrollTop=scrollTop;
  const visible=displayMessages.slice(start,end).filter(m=>expanded(m.messageId)),range=visible.map(m=>m.messageId).join('|');
  if(range!==lastRange){lastRange=range;send({type:'viewport',ids:visible.map(m=>m.messageId)}).catch(()=>{});}
  const missing=visible.filter(m=>!bodyFor(m.messageId)&&!errors.has(m.messageId)&&!inflight.has(m.messageId));
  if(missing.length){const ids=missing.map(m=>m.messageId).sort((a,b)=>(a===selected?-1:b===selected?1:0)),token=++requestSeq,owned=id=>inflight.get(id)===token;ids.forEach(id=>inflight.set(id,token));
    updateProgress();withTimeout(send({type:'bodies',ids,selected}),45000).then(results=>{for(const r of results){if(r.body)receiveBody(r.id,r.body);else if(owned(r.id) && r.error!=='Body request superseded')errors.set(r.id,r.error);}})
      // A batch outlasting the timeout is usually bodies still queued behind slow IMAP reads. The background reports
      // each one as it settles, so a timeout only releases them to be re-requested; the scheduler deduplicates.
      .catch(e=>{if(e.code!=='TIMEOUT')for(const id of ids)if(owned(id) && !bodyFor(id))errors.set(id,e.message);}).finally(()=>{ids.forEach(id=>{if(owned(id))inflight.delete(id);});render();});}
  updateProgress();
}
function scrollToMessage(id){
  render();const row=rowFor(id);
  if(row && Number.isFinite(row.offsetTop))scroller.scrollTop=row.offsetTop-(list.offsetTop || 0);
  else scroller.scrollTop=offsets[Math.max(0,displayMessages.findIndex(m=>m.messageId===id))] || 0;
}
async function refresh(id,scroll=false){const generation=++epoch;metadataLoading=true;discoveryLoading=false;updateProgress();performance.mark('thread-open');try{const result=await withTimeout(send({type:'thread',selected:id,requestId:generation}),30000,'Conversation loading timed out. Refresh to try again.');if(generation!==epoch)return;metadataLoading=false;discoveryLoading=!!result.discoveryPending;const switching=viewKey!==null && viewKey!==result.viewKey;$('pause').textContent=result.status.indexingEnabled?'Pause indexing':'Resume indexing';const previous=selected;selected=result.selected;if(!metadataById.has(result.selected)){heights.clear();errors.clear();liveBodies.clear();expansion.clear();openDetails.clear();groupOpen=false;addressMenu.hide();}if(viewKey!==result.viewKey){groupOpen=false;}viewKey=result.viewKey;messages=orderedMessages(result.messages,order);const previousLatest=latest;latest=latestId(messages);if(previousLatest!==latest){heights.delete(previousLatest);heights.delete(latest);}
  metadataById=new Map(messages.map(m=>[m.messageId,m]));performance.mark('metadata-ready');
  const participants=new Set(messages.map(m=>parseAddresses(m.author)[0]?.email || m.author)).size;
  $('empty').hidden=messages.length>0;$('subject').textContent=messages.find(m=>m.messageId===selected)?.subject || 'A little more context.';$('summary').textContent=messages.length?`${messages.length} ${messages.length===1?'message':'messages'} · ${participants} ${participants===1?'participant':'participants'}`:'Select a message or a thread in the message list.';
  $('count').textContent=result.truncated?'Partial conversation':'';
  if(scroll||previous!==selected){if(foldLongThreads && messages.length>10 && !groupOpen){scroller.scrollTop=0;lastRange='';render();}else {lastRange='';scrollToMessage(latest);}}
  else {lastRange='';render();}
  // A different conversation settles in softly; refreshes of the same one stay still.
  if(switching){const settle=[{opacity:.4,transform:'translateY(4px)'},{opacity:1,transform:'none'}];animate(list,settle,{duration:200});animate(document.querySelector?.('.heading'),settle,{duration:200});}
  requestAnimationFrame(()=>performance.mark('first-paint'));
}catch(e){if(generation!==epoch)return;metadataLoading=false;discoveryLoading=false;$('loading').hidden=true;scroller.setAttribute('aria-busy','false');progressState='';report(e.message);}}
scroller.addEventListener('scroll',queueFrame,{passive:true});
window.addEventListener('resize',scheduleRender);
$('original').onclick=()=>send({type:'nativeView'}).catch(e=>report(e.message));
window.addEventListener('pagehide',()=>send({type:'viewport',ids:[]}).catch(()=>{}));
bindIndexControls({document,messenger,report});
$('refresh').onclick=()=>refresh(selected);
messenger.runtime.onMessage.addListener(msg=>{if(msg.type==='threadDiscovery' && msg.tabId===tabId && msg.requestId===epoch){discoveryLoading=false;if(msg.error)report(msg.error);updateProgress();}if(msg.type==='bodyStage'){bodyStages.set(msg.id,msg.stage);updateProgress();}if(msg.type==='bodyError' && metadataById.has(msg.id)){bodyStages.delete(msg.id);inflight.delete(msg.id);if(msg.error!=='Body request superseded')errors.set(msg.id,msg.error);render();}if(msg.type==='bodyReady'){bodyStages.delete(msg.id);inflight.delete(msg.id);receiveBody(msg.id,msg.body);if(metadataById.has(msg.id))render();if(msg.id===selected)performance.mark('selected-body-ready');}if(msg.type==='selection' && msg.tabId===tabId)refresh(msg.selected,true);if(msg.type==='indexUpdated'){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh(selected),500);}});
async function pollStatus(){try{const s=await send({type:'status'});report(s.error || `${s.phase} · ${s.indexed} added`);$('pause').textContent=s.indexingEnabled?'Pause indexing':'Resume indexing';}catch{}}
setInterval(pollStatus,2500);
if(Number.isInteger(tabId) && tabId>0){refresh(null,true);pollStatus();}else report('Threads runs inside Thunderbird’s message pane.');

function applyTheme(theme){document.documentElement.dataset.theme=theme;}
function applyOrder(value){order=value;messages=orderedMessages(messages,order);heights.clear();scroller.scrollTop=0;lastRange='';render();}
function applyRemoteContent(value){allowRemoteContent=value;heights.clear();lastRange='';render();}
// Typography changes every card's height, so measurements restart.
function applyType(change){applyTypography(document.documentElement,change);heights.clear();lastRange='';render();}
function applyInlineAttachments(value){inlineAttachments=value;heights.clear();lastRange='';render();}
function applyFold(value){foldLongThreads=value;heights.clear();scroller.scrollTop=0;lastRange='';render();}
const preferences=bindPreferences({document,messenger,onChange:{theme:applyTheme,order:applyOrder,allowRemoteContent:applyRemoteContent,foldLongThreads:applyFold,inlineAttachments:applyInlineAttachments,fontFamily:fontFamily=>applyType({fontFamily}),fontSize:fontSize=>applyType({fontSize}),lineSpacing:lineSpacing=>applyType({lineSpacing})},report});
function setRemoteContent(value){preferences.set('allowRemoteContent',value);}
group.onclick=()=>{
  groupOpen=!groupOpen;for(const m of messages.slice(1,-1))expansion.set(m.messageId,false);heights.clear();scroller.scrollTop=0;lastRange='';
  const shown=new Set(mountedRows().map(node=>node.dataset.id));render();
  // Unfolded messages cascade in, a few at a time, from just under the fold button.
  mountedRows().filter(node=>!shown.has(node.dataset.id)).forEach((node,i)=>reveal(node,{duration:240,delay:Math.min(i,8)*22,fill:'backwards'}));
};
$('settings').onclick=()=>messenger.runtime.openOptionsPage().catch(e=>report(e.message));
// Popovers close on outside click and Escape, like native menus.
document.addEventListener('pointerdown',event=>{for(const menu of document.querySelectorAll?.('details.popover[open]') || [])if(!menu.contains(event.target))menu.open=false;});
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;for(const menu of document.querySelectorAll?.('details.popover[open]') || []){menu.open=false;menu.querySelector('summary')?.focus();}});
