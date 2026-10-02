// Development preview: mounts the real reader with a mocked Thunderbird API.
// Serve the project root and open /tests/preview.html (add ?n=40 for a long thread, ?slow for slow bodies).
import {Scheduler,PARSER_VERSION} from '../src/core.js';
import {parseBody} from '../src/parser.js';
const params=new URLSearchParams(location.search),count=Number(params.get('n'))||6,slow=params.has('slow');
const people=['Ada Lovelace <ada@example.com>','"Grace Hopper" <grace@navy.example>','Linus T <linus@kernel.example>','Margaret Hamilton <margaret@apollo.example>'];
const paragraphs=['Thanks for sending this over. I went through the numbers this morning and the overall direction looks right to me.','One thing I would like to double-check is the migration order — if we flip the flag before the backfill finishes, readers will see partial threads for a few minutes.','Here is the snippet I used to reproduce it locally:','Let me know if you want to pair on this tomorrow. I am free after 2pm.','See the plans data for the full breakdown.'];
const messages=Array.from({length:count},(_,i)=>({messageId:`m${i}`,date:Date.UTC(2026,8,1+i,9+i%8,i*7%60),author:people[i%people.length],recipients:[people[(i+1)%people.length],people[(i+2)%people.length]],ccList:i%3?[]:[people[3]],bccList:[],size:1000+i,subject:'Re: Migration plan for the conversation index'}));
// Every third message runs real HTML through the parser, to preview lists and emphasis.
const richHtml=`<div>Hi team,</div><div><br></div><div>Quick summary of <b>where we are</b> on the migration:</div>
<ul><li><b>Backfill</b> is done for <i>all</i> accounts
  <ul><li>Two retries on <code>imap-7</code></li><li>See <a href="https://example.com/runbook"><b>the runbook</b></a></li></ul></li>
<li>Flag flip scheduled for <u>Thursday</u></li></ul>
<ol><li>Freeze writes</li><li>Flip the flag</li><li>Watch dashboards</li></ol>
<div>Thanks,</div><div class="gmail_quote">On Mon, Ada wrote:<blockquote><ul><li>old bullet</li></ul></blockquote></div>`;
function body(id){
  const i=Number(id.slice(1));
  const attachments=i%2?[]:[{partName:'1.2',name:'Q3 migration plan.pdf',contentType:'application/pdf',size:248000},{partName:'1.3',name:'backfill-stats.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:41200},{partName:'1.4',name:'dashboard.png',contentType:'image/png',size:88000}];
  if(i%3===0)return parseBody({messageId:id,size:messages[i].size,html:richHtml,attachments});
  // Plain-text mail with a signature and two levels of quoted history, parsed for real.
  const text=[paragraphs[0],paragraphs[(i%3)+1],...(i%2===0?['```js\nfor (const id of queue) {\n  await db.putMessage(await load(id));\n}\n```']:[]),...(i%4===1?paragraphs.slice(0,4):[]),'See https://example.com/plans for the full breakdown.',
    '-- \nAda Lovelace\nStaff Engineer, Analytical Engines\n+1 555 0100',
    i?`On Mon, Sep 1, 2026 at 9:00 AM Grace Hopper <grace@navy.example> wrote:\n> ${paragraphs[1]}\n>\n> - backfill first\n> - then flip the flag\n>\n> On Sun, Aug 31, 2026 Linus T <linus@kernel.example> wrote:\n> > ${paragraphs[3]}`:''].join('\n\n');
  return parseBody({messageId:id,size:messages[i].size,text,attachments});
}
const listeners=[],broadcast=msg=>setTimeout(()=>listeners.forEach(fn=>fn(msg)),0),viewports=new Map();
const wait=()=>new Promise(r=>setTimeout(r,(slow?600:80)+Math.random()*(slow?1500:400)));
const scheduler=new Scheduler(async id=>{broadcast({type:'bodyStage',id,stage:'fetching'});await wait();broadcast({type:'bodyStage',id,stage:'parsing'});await wait();return body(id);},3);
const storage={},storageListeners=[];
// A locally drawn image stands in for attachment files.
async function sampleImage(){const canvas=new OffscreenCanvas(480,270),g=canvas.getContext('2d');g.fillStyle='#e8f0ec';g.fillRect(0,0,480,270);g.fillStyle='#3f7a62';for(let x=0;x<12;x++)g.fillRect(30+x*36,240-(40+((x*53)%170)),24,40+((x*53)%170));return canvas.convertToBlob();}
globalThis.messenger={
  messages:{async getAttachmentFile(){await wait();return sampleImage();}},
  runtime:{
    onMessage:{addListener:fn=>listeners.push(fn)},
    openOptionsPage:async()=>window.open('../src/options.html'),
    async sendMessage(msg){
      if(msg.type==='thread'){await wait();setTimeout(()=>broadcast({type:'threadDiscovery',tabId:msg.tabId,requestId:msg.requestId}),700);return {messages,selected:msg.selected||messages.at(-1).messageId,viewKey:'root',status:{indexingEnabled:true},discoveryPending:true};}
      if(msg.type==='bodies')return Promise.all(msg.ids.map(id=>scheduler.schedule(id,id===msg.selected?0:1).then(b=>{broadcast({type:'bodyReady',id,body:b});return {id,body:b};},e=>{broadcast({type:'bodyError',id,error:e.message});return {id,error:e.message};})));
      if(msg.type==='viewport'){viewports.set(msg.tabId,new Set(msg.ids));scheduler.retain(new Set([...viewports.values()].flatMap(s=>[...s])));return true;}
      if(msg.type==='status')return {phase:'Indexed',indexed:1284,indexingEnabled:true};
      if(msg.type==='addressBooks')return [{id:'p',name:'Personal Address Book'}];
      if(msg.type==='addressAction')return {message:`${msg.action} ${msg.email}`};
      if(msg.type==='pause')return {enabled:false};
      if(msg.type==='messageHandle')return 1;
      if(msg.type==='messageState')return {read:true,flagged:false};
      if(msg.type==='messageAction' || msg.type==='attachment')return {message:`${msg.action} (preview)`};
      console.log('[preview]',msg);return true;
    }
  },
  storage:{local:{async get(){return {...storage};},async set(v){Object.assign(storage,v);storageListeners.forEach(fn=>fn(Object.fromEntries(Object.entries(v).map(([k,newValue])=>[k,{newValue}])),'local'));}},onChanged:{addListener:fn=>storageListeners.push(fn)}}
};
const html=await (await fetch('../src/reader.html')).text(),doc=new DOMParser().parseFromString(html,'text/html');
for(const link of doc.querySelectorAll('link[rel=stylesheet]')){const l=document.createElement('link');l.rel='stylesheet';l.href=new URL(link.getAttribute('href'),new URL('../src/',location.href)).href;document.head.append(l);}
document.body.replaceChildren(...[...doc.body.children].filter(n=>n.tagName!=='SCRIPT'));
for(const img of document.querySelectorAll('img[src]'))img.src=new URL(img.getAttribute('src'),new URL('../src/',location.href)).href;
params.set('tabId','1');history.replaceState(null,'',`?${params}`);
await import('../src/reader.js');
