import {parseBody} from './parser.js';
self.onmessage=async ({data})=>{
  try {
    const result=parseBody(data.job);
    const source=new TextEncoder().encode(`${data.job.text || ''}\u0000${data.job.html || ''}`);
    const digest=await crypto.subtle.digest('SHA-256',source);
    result.contentHash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    result.bytes=JSON.stringify(result).length*2;
    self.postMessage({id:data.id,result});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
