import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/db.js';
import {metadata,PARSER_VERSION} from '../src/core.js';
const prefix='fixture:';
function message(id,references=[],date=0){return metadata({id:date+1,headerMessageId:`<${prefix}${id}>`,date:new Date(date),subject:'Integration test',author:'Ada',folder:{id:'test'},size:100},{references:references.map(id=>`<${prefix}${id}>`)},'test');}

test('Persistent thread index and independent body cache', async t=>{
  await t.test('Sparse references connect through missing ancestors',async()=>{await db.putMessage(message('C',['A','B'],3));await db.putMessage(message('A',[],1));await db.putMessage(message('D',['A','B'],4));const thread=await db.getThread(prefix+'C');assert.equal(thread.messages.length,3);});
  await t.test('Late ancestor uses existing indexed root',async()=>{await db.putMessage(message('B',['A'],2));const thread=await db.getThread(prefix+'D');assert.deepEqual(thread.messages.map(x=>x.messageId),['A','B','C','D'].map(id=>prefix+id));});
  await t.test('Component merges update all persisted message roots',async()=>{await db.putMessage(message('X',[],5));await db.putMessage(message('Y',['X'],6));await db.putMessage(message('Z',['B','Y'],7));const thread=await db.getThread(prefix+'X');assert.equal(thread.messages.length,7);assert.equal(new Set(thread.messages.map(m=>m.rootId)).size,1);});
  await t.test('Reference cycles cannot create union-find cycles',async()=>{await db.putMessage(message('A',['C'],1));assert.equal((await db.getThread(prefix+'B')).messages.length,7);});
  await t.test('Bodies replace atomically without double-counting bytes',async()=>{const body={messageId:prefix+'C',parserVersion:PARSER_VERSION,size:100,text:'Cached body',bytes:500};await db.putBody(body);await db.putBody({...body,text:'Updated'});assert.equal(await db.getState('bodyBytes'),500);assert.equal((await db.getBody(prefix+'C')).text,'Updated');assert.equal((await db.getMessage(prefix+'C')).subject,'Integration test');});
  await t.test('Deletion removes body but retains missing-ancestor topology',async()=>{await db.deleteMessage(prefix+'C');assert.equal(await db.getMessage(prefix+'C'),undefined);assert.equal(await db.getBody(prefix+'C'),undefined);assert.equal(await db.getState('bodyBytes'),0);assert.equal((await db.getThread(prefix+'A')).messages.length,6);});
  await t.test('Cursor eviction keeps newest bodies and accurate bytes',async()=>{for(let i=0;i<3;i++)await db.putBody({messageId:prefix+'cache'+i,text:'Body',bytes:500});await db.pruneBodies(600);assert.equal(await db.getState('bodyBytes'),500);assert.equal(await db.getBody(prefix+'cache0'),undefined);assert.ok(await db.getBody(prefix+'cache2'));});
  await t.test('Concurrent inserts serialize topology and root indexes',async()=>{await Promise.all(Array.from({length:30},(_,i)=>db.putMessage(message('concurrent'+i,i?['concurrent'+(i-1)]:[],i))));assert.equal((await db.getThread(prefix+'concurrent29')).messages.length,30);});
  await t.test('Repeated indexing is idempotent and metadata stays separate',async()=>{const m=message('concurrent29',['concurrent28'],29);await db.putMessage(m);await db.putMessage(m);const thread=await db.getThread(prefix+'concurrent0');assert.equal(thread.messages.length,30);assert.ok(thread.messages.every(m=>!('text' in m)));});
  await t.test('Unknown messages return an empty view',async()=>assert.deepEqual(await db.getThread('missing'),{messages:[],truncated:false}));
});
