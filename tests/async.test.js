import test from 'node:test';
import assert from 'node:assert/strict';
import {withTimeout} from '../src/async.js';
test('Stalled work rejects with an actionable timeout instead of remaining pending',async()=>{await assert.rejects(withTimeout(new Promise(()=>{}),10),e=>e.code==='TIMEOUT' && /Retry/.test(e.message));});
test('Successful work and original failures survive timeout wrapping',async()=>{assert.equal(await withTimeout(Promise.resolve('ready'),100),'ready');await assert.rejects(withTimeout(Promise.reject(new Error('Unavailable')),100),/Unavailable/);});
