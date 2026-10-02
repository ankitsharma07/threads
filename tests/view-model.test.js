import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedMessages,latestId,isExpanded,emailAddresses,parseAddresses,displayName,initials,THEMES} from '../src/view-model.js';
const messages=[{messageId:'b',date:2},{messageId:'a',date:1},{messageId:'c',date:3}];
test('Both display orders preserve the same latest message and do not mutate metadata',()=>{
  assert.deepEqual(orderedMessages(messages).map(m=>m.messageId),['a','b','c']);
  assert.deepEqual(orderedMessages(messages,'reverse').map(m=>m.messageId),['c','b','a']);
  assert.equal(latestId(orderedMessages(messages,'reverse')),'c');assert.equal(messages[0].messageId,'b');
});
test('Only the latest message expands by default and manual toggles override it',()=>{
  const overrides=new Map();assert.equal(isExpanded('c',overrides,'c'),true);assert.equal(isExpanded('a',overrides,'c'),false);
  overrides.set('c',false);overrides.set('a',true);assert.equal(isExpanded('c',overrides,'c'),false);assert.equal(isExpanded('a',overrides,'c'),true);
});
test('Address copy targets exclude display names and handle multiple recipients',()=>{
  assert.deepEqual(emailAddresses(['"Ada, Lovelace" <ada+mail@test.example>','Bob <bob@test.example>','ada+mail@test.example']),['ada+mail@test.example','bob@test.example']);
  assert.deepEqual(emailAddresses(undefined),[]);
});
test('Themes include pitch black and additional dark palettes',()=>{for(const theme of ['black','navy','forest','plum'])assert.ok(THEMES.includes(theme));});
test('Address headers split into names and emails without breaking quoted commas',()=>{
  assert.deepEqual(parseAddresses(['"Ada, Lovelace" <ada@test.example>','bob@test.example']).map(({name,email})=>[name,email]),[['Ada, Lovelace','ada@test.example'],['','bob@test.example']]);
  assert.deepEqual(parseAddresses('Grace <g@test.example>, "Q, R" <q@test.example>').map(a=>a.email),['g@test.example','q@test.example']);
  assert.deepEqual(parseAddresses(undefined),[]);
});
test('Sender names and initials come from display names, falling back to the mailbox',()=>{
  assert.equal(displayName('"Grace Hopper" <grace@navy.example>'),'Grace Hopper');assert.equal(initials('"Grace Hopper" <grace@navy.example>'),'GH');
  assert.equal(displayName('linus@kernel.example'),'linus');assert.equal(initials(''),'?');
});
