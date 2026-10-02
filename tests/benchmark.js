import 'fake-indexeddb/auto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import * as db from '../src/db.js';
import {metadata} from '../src/core.js';
import {parseBody,chooseBody} from '../src/parser.js';
const results={environment:'Node + fake-indexeddb (not Thunderbird timings)',threads:[],parser:[]};
for(const count of [10,100,500,2000]){
  for(let i=0;i<count;i++){
    const m=metadata({id:i+1,headerMessageId:`${count}-${i}@bench`,date:new Date(i),subject:'Benchmark',size:100},{references:i?[`<${count}-${i-1}@bench>`]:[]},'bench');await db.putMessage(m);
  }
  const start=performance.now();const thread=await db.getThread(`${count}-${count-1}@bench`);const ms=performance.now()-start;
  assert.equal(thread.messages.length,count);assert.ok(thread.messages.every(m=>!('text' in m)));
  results.threads.push({messages:count,metadataLookupMs:+ms.toFixed(3),mimeLoads:0,parserCalls:0});
}
const fixtures={
  outlook:{html:'<div>Current reply</div><hr><div>From: Ada<br>Sent: Monday<br>To: Bob<br>Subject: Plan</div>'+('<div>Quoted Outlook history</div>'.repeat(10000))},
  gmail:{html:'<div>Current reply</div><div class="gmail_quote">'+('History<br>'.repeat(10000))+'</div>'},
  giantQuoted:{text:'Current reply\nOn Monday Ada wrote:\n'+('> Quoted history\n'.repeat(100000))},
  newsletter:{html:'<p>Newsletter</p>'+('<div><img src="https://example.test/tracking">Newsletter content &amp; more</div>'.repeat(20000))},
  attachmentHeavy:chooseBody({contentType:'multipart/mixed',parts:[{contentType:'text/plain',body:'Current reply'},...Array.from({length:1000},()=>({name:'large-file.txt',contentType:'text/plain',body:'Attachment'.repeat(1000)}))]})
};
for(const [name,input] of Object.entries(fixtures)){const start=performance.now();const result=parseBody({messageId:name,size:0,...input});const ms=performance.now()-start;assert.ok(result.text);if(['gmail','outlook','giantQuoted'].includes(name))assert.ok(result.quote);results.parser.push({fixture:name,inputCharacters:(input.text||input.html).length,parseMs:+ms.toFixed(3)});}
console.log(JSON.stringify(results,null,2));
