export const PARSER_VERSION = 7;
export function ids(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '');
  const matches = text.match(/<[^<>\s]+>/g);
  return [...new Set((matches || text.split(/\s+/).filter(Boolean)).map(x => x.replace(/^<|>$/g, '')))];
}
export function identity(header, session="session") {
  return ids(header.headerMessageId)[0] || `local:${session}:${header.folder?.id || 'external'}:${header.id}`;
}
export function metadata(header, headers, session) {
  const messageId = identity(header,session);
  const references = ids(headers.references);
  const inReplyTo = ids(headers['in-reply-to']).at(-1) || null;
  const parentId = inReplyTo || references.at(-1) || null;
  return {messageId, thunderbirdId:header.id, session, folderId:header.folder?.id,
    accountId:header.folder?.accountId, subject:header.subject || '(no subject)',
    normalizedSubject:(header.subject || '').replace(/^(\s*(re|fw|fwd):\s*)+/ig,'').trim().toLowerCase(),
    author:header.author || '', recipients:header.recipients || [], ccList:header.ccList || headers.cc || [], bccList:header.bccList || headers.bcc || [], date:+new Date(header.date),
    size:header.size || 0, references, inReplyTo, parentId,
    linkIds:parentId && parentId!==messageId ? [parentId] : []};
}
export async function component(selectedId, get, children, limit=10000) {
  const seen = new Set(), records = new Map(), queue = [selectedId];
  for (let i=0; i<queue.length && seen.size<limit; i++) {
    const id=queue[i]; if(seen.has(id)) continue; seen.add(id);
    const [record, replies] = await Promise.all([get(id), children(id)]);
    if(record) {records.set(id,record); queue.push(...record.linkIds);}
    queue.push(...replies.map(x=>x.messageId));
  }
  return {messages:[...records.values()].sort((a,b)=>a.date-b.date || a.messageId.localeCompare(b.messageId)), truncated:seen.size>=limit};
}
export class Scheduler {
  constructor(load, concurrency=3) {this.load=load;this.concurrency=concurrency;this.active=0;this.jobs=new Map();this.queue=[];}
  schedule(id, priority=1) {
    const old=this.jobs.get(id); if(old){old.priority=Math.min(old.priority,priority);return old.promise;}
    let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});
    const job={id,priority,promise,resolve,reject};this.jobs.set(id,job);this.queue.push(job);this.pump();return promise;
  }
  pump() {
    while(this.active<this.concurrency && this.queue.length) {
      this.queue.sort((a,b)=>a.priority-b.priority);const job=this.queue.shift();this.active++;
      Promise.resolve().then(()=>this.load(job.id)).then(job.resolve,job.reject).finally(()=>{this.active--;this.jobs.delete(job.id);this.pump();});
    }
  }
  retain(wanted) {for(const job of [...this.queue]) if(!wanted.has(job.id)){this.queue.splice(this.queue.indexOf(job),1);this.jobs.delete(job.id);job.reject(new Error('Body request superseded'));}}
}
export class LRU {
  constructor(max=80, bytes=12*1024*1024){this.max=max;this.bytes=bytes;this.map=new Map();this.total=0;}
  has(id){return this.map.has(id);}
  delete(id){const prior=this.map.get(id);if(prior)this.total-=prior.size;return this.map.delete(id);}
  clear(){this.map.clear();this.total=0;}
  get(id){const item=this.map.get(id);if(item){this.map.delete(id);this.map.set(id,item);}return item?.value;}
  set(id,value){const prior=this.map.get(id);if(prior)this.total-=prior.size;this.map.delete(id);const size=JSON.stringify(value).length*2;this.map.set(id,{value,size});this.total+=size;while(this.map.size>this.max||this.total>this.bytes){const key=this.map.keys().next().value;this.total-=this.map.get(key).size;this.map.delete(key);}}
}
