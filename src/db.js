let pending;
export function database() {
  return pending ||= new Promise((resolve,reject)=>{
    const r=indexedDB.open('threads',3);
    r.onupgradeneeded=()=>{const db=r.result;
      if(!db.objectStoreNames.contains('messages')) {
        const m=db.createObjectStore('messages',{keyPath:'messageId'});
        m.createIndex('linkIds','linkIds',{multiEntry:true});m.createIndex('folderId','folderId');m.createIndex('date','date');m.createIndex('normalizedSubject','normalizedSubject');
        const b=db.createObjectStore('bodies',{keyPath:'messageId'});b.createIndex('accessed','accessed');db.createObjectStore('state');
      }
      if(!db.objectStoreNames.contains('edges')) {
        const edges=db.createObjectStore('edges',{keyPath:['from','to']});edges.createIndex('from','from');edges.createIndex('to','to');
        // Existing development installs can resume indexing to populate new edges.
        r.transaction.objectStore('state').clear();
      }
      const messages=r.transaction.objectStore('messages');
      if(!messages.indexNames.contains('rootId'))messages.createIndex('rootId','rootId');
      if(!db.objectStoreNames.contains('nodes')) {
        db.createObjectStore('nodes',{keyPath:'id'});
        r.transaction.objectStore('state').clear();
      }
      let bytes=0;const bodyCursor=r.transaction.objectStore('bodies').openCursor();
      bodyCursor.onsuccess=()=>{const cursor=bodyCursor.result;if(cursor){bytes+=cursor.value.bytes||0;cursor.continue();}else r.transaction.objectStore('state').put(bytes,'bodyBytes');};
    };
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
}
export async function run(store,mode,operation) {
  const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode),req=operation(tx.objectStore(store));let result;
    if(req)req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
export const getMessage=id=>run('messages','readonly',s=>s.get(id));
export async function children(id) {
  const [outgoing,incoming]=await Promise.all([
    run('edges','readonly',s=>s.index('from').getAll(id)),
    run('edges','readonly',s=>s.index('to').getAll(id))]);
  return [...new Set([...outgoing.map(e=>e.to),...incoming.map(e=>e.from)])].map(messageId=>({messageId}));
}
const result=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
export async function putMessage(m) {
  const handle=await database();return new Promise((resolve,reject)=>{
    const tx=handle.transaction(['messages','edges','nodes'],'readwrite');
    const messages=tx.objectStore('messages'),edges=tx.objectStore('edges'),nodes=tx.objectStore('nodes'),cache=new Map();
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('Index transaction aborted'));
    async function ensure(id){if(cache.has(id))return cache.get(id);let node=await result(nodes.get(id));if(!node){node={id,parent:id,size:1};nodes.put(node);}cache.set(id,node);return node;}
    async function root(id){let node=await ensure(id),path=[];while(node.parent!==node.id){path.push(node);node=await ensure(node.parent);}for(const entry of path){entry.parent=node.id;nodes.put(entry);}return node;}
    async function join(a,b){let left=await root(a),right=await root(b);if(left.id===right.id)return;
      if(left.size<right.size)[left,right]=[right,left];
      right.parent=left.id;left.size+=right.size;nodes.put(right);nodes.put(left);
      // Only the smaller component needs new indexed root values.
      const members=await result(messages.index('rootId').getAll(right.id));
      for(const member of members)messages.put({...member,rootId:left.id});
    }
    (async()=>{await ensure(m.messageId);const chain=[...m.references,m.messageId];
      for(let i=1;i<chain.length;i++)if(chain[i-1]!==chain[i]){edges.put({from:chain[i-1],to:chain[i]});await join(chain[i-1],chain[i]);}
      if(m.parentId && m.parentId!==m.messageId){edges.put({from:m.parentId,to:m.messageId});await join(m.parentId,m.messageId);}
      const node=await root(m.messageId);messages.put({...m,rootId:node.id});
    })().catch(error=>{reject(error);tx.abort();});
  });
}
export async function getThread(id) {
  const handle=await database();const tx=handle.transaction(['nodes','messages'],'readonly');
  const nodes=tx.objectStore('nodes');let node=await result(nodes.get(id));
  if(!node)return {messages:[],truncated:false};
  const seen=new Set();while(node.parent!==node.id){if(seen.has(node.id))throw new Error('Invalid thread topology');seen.add(node.id);node=await result(nodes.get(node.parent));if(!node)return {messages:[],truncated:false};}
  const records=await result(tx.objectStore('messages').index('rootId').getAll(node.id));
  return {messages:records.sort((a,b)=>a.date-b.date || a.messageId.localeCompare(b.messageId)),truncated:false};
}
export const getBody=id=>run('bodies','readonly',s=>s.get(id));
export async function putBody(b) {
  const handle=await database();return new Promise((resolve,reject)=>{
    const tx=handle.transaction(['bodies','state'],'readwrite');const bodies=tx.objectStore('bodies'),state=tx.objectStore('state');
    const previous=bodies.get(b.messageId),counter=state.get('bodyBytes');
    let ready=0;function update(){if(++ready!==2)return;bodies.put({...b,accessed:Date.now()});state.put((counter.result||0)-(previous.result?.bytes||0)+(b.bytes||0),'bodyBytes');}
    previous.onsuccess=update;counter.onsuccess=update;tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export async function deleteMessage(id) {
  const handle=await database();return new Promise((resolve,reject)=>{
    const tx=handle.transaction(['messages','bodies','state'],'readwrite'),bodies=tx.objectStore('bodies'),state=tx.objectStore('state');
    tx.objectStore('messages').delete(id);const previous=bodies.get(id),counter=state.get('bodyBytes');let ready=0;
    function update(){if(++ready!==2)return;bodies.delete(id);state.put(Math.max(0,(counter.result||0)-(previous.result?.bytes||0)),'bodyBytes');}
    previous.onsuccess=update;counter.onsuccess=update;tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
export const getState=id=>run('state','readonly',s=>s.get(id));
export const setState=(id,value)=>run('state','readwrite',s=>s.put(value,id));
export async function pruneBodies(maxBytes=100*1024*1024) {
  const handle=await database();return new Promise((resolve,reject)=>{
    const tx=handle.transaction(['bodies','state'],'readwrite'),state=tx.objectStore('state');const counter=state.get('bodyBytes');
    counter.onsuccess=()=>{let total=counter.result||0;if(total<=maxBytes)return;
      const req=tx.objectStore('bodies').index('accessed').openCursor();req.onsuccess=()=>{
        const cursor=req.result;if(!cursor || total<=maxBytes){state.put(Math.max(0,total),'bodyBytes');return;}
        total-=cursor.value.bytes||0;cursor.delete();cursor.continue();};};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
