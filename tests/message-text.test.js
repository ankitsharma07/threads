import test from 'node:test';
import assert from 'node:assert/strict';
import {plainRuns,safeLink,appendMessageText} from '../src/message-text.js';
test('Bare links become clickable without swallowing sentence punctuation',()=>{
  const runs=plainRuns('See <https://example.com/plans?q=1&x=2> and https://example.com/wiki/Plan_(test).');
  assert.deepEqual(runs.filter(r=>r.href).map(r=>r.text),['https://example.com/plans?q=1&x=2','https://example.com/wiki/Plan_(test)']);assert.equal(runs.map(r=>r.text).join(''),'See <https://example.com/plans?q=1&x=2> and https://example.com/wiki/Plan_(test).');
});
test('Untrusted link payloads cannot create executable anchors',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,x','file:///etc/passwd','https://user:password@example.com','relative/path'])assert.equal(safeLink(url),null);
  const nodes=[],document={createElement:tag=>({tag,setAttribute(){}})};appendMessageText({append:node=>nodes.push(node)},{runs:[{text:'Label',href:'javascript:alert(1)'}]},document,()=>{},()=>{});assert.equal(nodes[0].tag,'span');assert.equal(nodes[0].textContent,'Label');
});
