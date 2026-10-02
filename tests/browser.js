import * as db from '../src/db.js';
import {metadata,PARSER_VERSION} from '../src/core.js';
const output=document.getElementById('results'),lines=[];
function check(condition,label){if(!condition)throw new Error(label);lines.push(`PASS ${label}`);output.textContent=lines.join('\n');}
const prefix=`fixture:${crypto.randomUUID()}:`;
function message(id,references=[],date=0){return metadata({id:date+1,headerMessageId:`<${prefix}${id}>`,date:new Date(date),subject:'Integration test',author:'Ada',folder:{id:'test'},size:100},{references:references.map(id=>`<${prefix}${id}>`)},'test');}
try{
  await db.putMessage(message('C',['A','B'],3));await db.putMessage(message('A',[],1));await db.putMessage(message('D',['A','B'],4));
  let thread=await db.getThread(prefix+'C');check(thread.messages.length===3,'Sparse references join branches through missing ancestors');
  await db.putMessage(message('B',['A'],2));thread=await db.getThread(prefix+'D');check(thread.messages.map(x=>x.messageId.slice(prefix.length)).join(',')==='A,B,C,D','Late ancestor joins the existing thread in date order');
  await db.putMessage(message('X',[],5));await db.putMessage(message('Y',['X'],6));await db.putMessage(message('Z',['B','Y'],7));
  thread=await db.getThread(prefix+'X');check(thread.messages.length===7,'Merging two existing components updates every root index');
  await db.putMessage(message('A',['C'],1));check((await db.getThread(prefix+'B')).messages.length===7,'Cyclic reference input cannot trap root lookup');
  const parsed={messageId:prefix+'C',parserVersion:PARSER_VERSION,size:100,text:'Cached body',bytes:500};
  const initial=(await db.getState('bodyBytes'))||0;await db.putBody(parsed);await db.putBody({...parsed,text:'Updated'});
  check((await db.getState('bodyBytes'))===initial+500,'Replacing body does not inflate cache byte accounting');
  check((await db.getBody(prefix+'C')).text==='Updated','Body persists independently of metadata');
  await db.deleteMessage(prefix+'C');check(!(await db.getMessage(prefix+'C')) && !(await db.getBody(prefix+'C')),'Permanent deletion removes metadata and cached body');
  check((await db.getThread(prefix+'A')).messages.length===6,'Deleting a member preserves topology through a placeholder');
  await db.putBody({...parsed,messageId:prefix+'B'});await db.pruneBodies(initial);
  check((await db.getState('bodyBytes'))<=initial,'Disk budget evicts bodies through a cursor');
  const worker=new Worker(new URL('../src/worker.js',import.meta.url),{type:'module'});
  const response=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Worker timeout')),5000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.onerror=reject;worker.postMessage({id:1,job:{messageId:prefix+'worker',html:'<p>Hello</p><blockquote>History</blockquote>'}});});worker.terminate();
  check(response.result?.text==='Hello' && response.result?.quote.includes('History'),'Real module worker normalizes HTML and extracts quoted history');
  for(const size of [10,100,500,2000]){
    const base=`${prefix}${size}:`;for(let i=0;i<size;i++){const m=message(base+i,i?[base+(i-1)]:[],i);await db.putMessage(m);}
    const id=prefix+base+(size-1);const start=performance.now();const thread=await db.getThread(id);const elapsed=performance.now()-start;
    check(thread.messages.length===size,`${size} message fixture stays complete`);lines.push(`BENCH ${size} message IndexedDB lookup: ${elapsed.toFixed(1)} ms`);output.textContent=lines.join('\n');
    for(const m of thread.messages)await db.deleteMessage(m.messageId);
  }
  const last=await db.getThread(prefix+'A');for(const m of last.messages)await db.deleteMessage(m.messageId);
  lines.push('DONE — all browser integration checks passed.');output.textContent=lines.join('\n');document.title='PASS — Threads checks';
}catch(error){lines.push(`FAIL ${error.stack}`);output.textContent=lines.join('\n');document.title='FAIL — Threads checks';}
