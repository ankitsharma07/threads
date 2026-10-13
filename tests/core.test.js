import test from 'node:test';
import assert from 'node:assert/strict';
import {ids,identity,metadata,component,Scheduler,LRU} from '../src/core.js';
import {parseBody,htmlText,chooseBody,listAttachments} from '../src/parser.js';
const header=(id,date=0)=>({id:date+1,headerMessageId:`<${id}>`,date:new Date(date),subject:'Re: Fwd: Planning',author:'Ada',size:100,folder:{id:'inbox'}});
test('RFC IDs preserve case, remove brackets, and deduplicate',()=>assert.deepEqual(ids(['<A@host> <B@host>','<A@host>']),['A@host','B@host']));
test('missing IDs are scoped to the runtime session',()=>assert.notEqual(identity({id:2},'a'),identity({id:2},'b')));
test('metadata uses explicit reply parent and normalizes subject',()=>{const m=metadata(header('C'),{references:['<A> <B>'],'in-reply-to':['<D>']},'session');assert.equal(m.parentId,'D');assert.equal(m.normalizedSubject,'planning');assert.deepEqual(m.linkIds,['D']);});
function graph(records,edges){return [async id=>records.get(id),async id=>edges.filter(e=>e[0]===id||e[1]===id).map(e=>({messageId:e[0]===id?e[1]:e[0]}))];}
test('missing ancestors remain traversable and branches are included',async()=>{const records=new Map([['A',{messageId:'A',date:1,linkIds:[]}],['C',{messageId:'C',date:3,linkIds:['B']}],['D',{messageId:'D',date:2,linkIds:['B']}]]);const [get,children]=graph(records,[['A','B'],['B','C'],['B','D']]);assert.deepEqual((await component('C',get,children)).messages.map(x=>x.messageId),['A','D','C']);});
test('cycles cannot trap graph traversal',async()=>{const records=new Map(['A','B'].map((id,i)=>[id,{messageId:id,date:i,linkIds:[]}])) ;const [get,children]=graph(records,[['A','B'],['B','A']]);assert.equal((await component('A',get,children)).messages.length,2);});
test('graph traversal limit is reported',async()=>{const records=new Map(['A','B'].map((id,i)=>[id,{messageId:id,date:i,linkIds:[]}]));const [get,children]=graph(records,[['A','B']]);assert.equal((await component('A',get,children,1)).truncated,true);});
test('body scheduling deduplicates active requests',async()=>{let calls=0,release;const s=new Scheduler(()=>{calls++;return new Promise(r=>release=r);},1);const a=s.schedule('a');assert.equal(a,s.schedule('a',0));await Promise.resolve();release('body');assert.equal(await a,'body');assert.equal(calls,1);});
test('scheduler bounds concurrent loads and prioritizes selection',async()=>{const started=[],releases=new Map();let active=0,max=0;const s=new Scheduler(id=>{started.push(id);active++;max=Math.max(max,active);return new Promise(r=>releases.set(id,()=>{active--;r(id);}));},2);const promises=[s.schedule('a'),s.schedule('b'),s.schedule('c',3),s.schedule('selected',0)];await new Promise(r=>setImmediate(r));assert.equal(started.length,2);releases.get('a')();await new Promise(r=>setImmediate(r));assert.equal(started[2],'selected');releases.get('b')();await new Promise(r=>setImmediate(r));releases.get('selected')();releases.get('c')();await Promise.all(promises);assert.equal(max,2);});
test('obsolete queued body work is cancelled',async()=>{let release;const s=new Scheduler(()=>new Promise(r=>release=r),1);const active=s.schedule('a');const queued=s.schedule('b');const rejected=assert.rejects(queued,/superseded/);s.retain(new Set(['a']));await rejected;await Promise.resolve();release();await active;});
test('LRU access protects hot entries and byte capacity is enforced',()=>{const cache=new LRU(2);cache.set('a',1);cache.set('b',2);cache.get('a');cache.set('c',3);assert.equal(cache.get('b'),undefined);assert.equal(cache.get('a'),1);const small=new LRU(100,20);small.set('x','x'.repeat(30));assert.equal(small.get('x'),undefined);});
test('plain text reply markers collapse history without dropping original',()=>{const parsed=parseBody({messageId:'a',size:42,text:'Looks good.\n\nOn Tue Ada wrote:\n> previous'});assert.equal(parsed.text,'Looks good.');assert.match(parsed.quote,/previous/);});
test('signature remains independently expandable',()=>{const parsed=parseBody({messageId:'a',text:'Hello\n-- \nAda\nOn Tue Bob wrote:\nOld'});assert.equal(parsed.text,'Hello');assert.match(parsed.signature,/Ada/);assert.match(parsed.quote,/Old/);});
test('HTML quote containers become collapsible text',()=>{const b=parseBody({messageId:'a',html:'<div>Hello &amp; goodbye</div><div class="gmail_quote">Prior reply</div>'});assert.equal(b.text,'Hello & goodbye');assert.match(b.quote,/Prior reply/);});
test('HTML converts to inert text with no executable markup',()=>{const text=htmlText('<script>alert(1)</script><style>p{}</style><p onclick="evil()">Safe</p><img src="https://tracker.test/x"><iframe>Bad</iframe>&lt;script&gt;');assert.equal(text,'Safe\n\n<script>');});
test('malformed numeric entities cannot crash parser',()=>assert.equal(htmlText('&#999999999; &#x1F600;'),'� 😀'));
test('MIME alternatives keep HTML formatting with plain text alongside and exclude attachments',()=>{const p={contentType:'multipart/mixed',parts:[{name:'readme.txt',contentType:'text/plain',body:'Attachment'},{contentType:'multipart/alternative',parts:[{contentType:'text/html',body:'<p>Hello</p>'},{contentType:'text/plain',body:'Hello'}]},{contentType:'message/rfc822',parts:[{contentType:'text/plain',body:'Forward'}]}]};assert.deepEqual(chooseBody(p),{html:'<p>Hello</p>',text:'Hello'});});
test('HTML-only message is readable',()=>assert.deepEqual(chooseBody({contentType:'text/html',body:'<p>Hello</p>'}),{html:'<p>Hello</p>'}));
test('MIME attachment disposition prevents treating file as body',()=>assert.deepEqual(chooseBody({contentType:'text/plain',body:'Attachment',headers:{'content-disposition':['attachment; filename=x']}}),{}));

test('Thunderbird top-level RFC822 wrapper is traversed but forwarded attachments are excluded',()=>{const full={contentType:'message/rfc822',partName:'',parts:[{contentType:'multipart/mixed',parts:[{contentType:'text/plain',body:'Original body'},{contentType:'message/rfc822',parts:[{contentType:'text/plain',body:'Attached body'}]}]}]};assert.deepEqual(chooseBody(full),{text:'Original body'});assert.deepEqual(chooseBody(full.parts[0].parts[1],false),{});});

test('Recipient metadata preserves To, Cc and Bcc separately',()=>{const m=metadata({id:1,headerMessageId:'addresses@test',recipients:['to@test'],ccList:['cc@test'],bccList:['bcc@test']},{},'s');assert.deepEqual(m.recipients,['to@test']);assert.deepEqual(m.ccList,['cc@test']);assert.deepEqual(m.bccList,['bcc@test']);});

test('Fenced code preserves indentation, tabs, blank lines and quote-like operators',()=>{
  const code='function run() {\n\tconst x = 1;\n\n    > comparison\n    --counter;\n}';
  const body=parseBody({messageId:'code',text:'Example:\n```js\n'+code+'\n```\nOn Tuesday Ada wrote:\n> Old reply'});
  assert.deepEqual(body.blocks,[{type:'text',text:'Example:'},{type:'code',text:code,language:'js'}]);assert.match(body.quote,/Old reply/);
});
test('HTML pre/code preserves exact whitespace and encoded source without executable HTML',()=>{
  const body=parseBody({messageId:'html-code',html:'<p>Example</p><pre><code class="language-html">  &lt;script&gt;alert(1)&lt;/script&gt;\n\n\treturn &gt; 2;  </code></pre><p>Done</p>'});
  assert.deepEqual(body.blocks,[{type:'text',text:'Example'},{type:'code',text:'  <script>alert(1)</script>\n\n\treturn > 2;  ',language:'html'},{type:'text',text:'Done'}]);assert.equal(body.quote,'');
});
test('Multipart HTML code takes priority over an unformatted plain alternative',()=>{
  const selected=chooseBody({contentType:'multipart/alternative',parts:[{contentType:'text/plain',body:'Example flat code'},{contentType:'text/html',body:'<p>Example</p><pre>  indented\n\n    code</pre>'}]});
  assert.equal(parseBody({...selected}).blocks[1].text,'  indented\n\n    code');
});
test('Unclosed and tilde code fences remain readable without quote stripping',()=>{
  assert.equal(parseBody({text:'~~~sql\nSELECT *\n  FROM table;\n~~~'}).blocks[0].language,'sql');
  assert.equal(parseBody({text:'```\n> a code operator\n-- not a signature'}).quote,'');
});

test('Remote images retain only HTTP image URLs and inert alternative text',()=>{
  const html='<img src="https://example.com/a?x=1&amp;y=2" alt="Photo" onerror="evil()"><img src="javascript:evil()"><img src="data:image/png;base64,x"><img src="https://example.com/a?x=1&amp;y=2"><script><img src="https://example.com/hidden"></script>';
  const body=parseBody({messageId:'remote',html,size:1});
  assert.deepEqual(body.remoteImages,[{src:'https://example.com/a?x=1&y=2',alt:'Photo'}]);
  const alternative=chooseBody({contentType:'multipart/alternative',parts:[{contentType:'text/plain',body:'Plain'},{contentType:'text/html',body:html}]});
  assert.equal(alternative.text,'Plain');assert.equal(alternative.html,html);
});

test('Named HTML links retain labels instead of expanded plain-text destinations',()=>{
  const url='https://docs.google.com/spreadsheets/d/1K21DI2oWKfTfa026LPILUSYb_7gRpiAlu6vn7_Wt17Y/edit?usp=sharing';
  const parts=chooseBody({contentType:'multipart/alternative',parts:[{contentType:'text/plain',body:`Please find plans data <${url}> attached herewith.`},{contentType:'text/html',body:`<p>Please find <a href="${url}"><b>plans data</b></a> attached herewith.</p>`}]});
  const parsed=parseBody(parts);assert.equal(parsed.text,'Please find plans data attached herewith.');
  assert.deepEqual(parsed.blocks[0].runs,[{text:'Please find '},{text:'plans data',href:url,b:true},{text:' attached herewith.'}]);
});
test('Links in signatures and quoted history keep their labels and destinations',()=>{
  const parsed=parseBody({html:'<p>Hello</p><p>-- </p><p><a href="https://example.com/team">Team</a></p><blockquote><a href="https://example.com/old">Previous plan</a></blockquote>'});
  assert.equal(parsed.text,'Hello');const runs=blocks=>blocks.flatMap(b=>b.runs || []);
  assert.ok(runs(parsed.signatureBlocks).some(run=>run.text==='Team' && run.href==='https://example.com/team'));assert.ok(runs(parsed.quoteBlocks).some(run=>run.text==='Previous plan' && run.href==='https://example.com/old'));
});
test('Unsafe HTML link destinations stay inert and code never gains link markup',()=>{
  const parsed=parseBody({html:'<p><a href="javascript:evil()">Safe label</a><a href="data:text/html,x">Data</a></p><pre>&lt;a href="https://example.com"&gt;Code&lt;/a&gt;</pre>'});
  assert.equal(parsed.blocks[0].text,'Safe labelData');assert.equal(parsed.blocks[0].runs,undefined);assert.equal(parsed.blocks[1].text,'<a href="https://example.com">Code</a>');assert.equal(parsed.blocks[1].runs,undefined);
});

test('HTML lists keep nesting, numbering and emphasis',()=>{
  const body=parseBody({html:'<p>Plan:</p><ul><li><b>First</b> step<ul><li>Sub <i>point</i></li></ul></li><li>Second</li></ul><ol start="3"><li>Third</li><li>Fourth</li></ol><p>Done</p>'});
  assert.deepEqual(body.blocks.map(b=>b.type),['text','list','list','text']);
  assert.deepEqual(body.blocks[1].items.map(i=>[i.depth,i.marker,i.text]),[[0,'•','First step'],[1,'◦','Sub point'],[0,'•','Second']]);
  assert.deepEqual(body.blocks[1].items[0].runs,[{text:'First',b:true},{text:' step'}]);
  assert.deepEqual(body.blocks[1].items[1].runs,[{text:'Sub '},{text:'point',i:true}]);
  assert.deepEqual(body.blocks[2].items.map(i=>i.marker),['3.','4.']);assert.equal(body.blocks[3].text,'Done');
});
test('HTML source line breaks collapse; tags decide visible breaks',()=>{
  const body=parseBody({html:'<p>One sentence\n   wrapped in source</p><div>Line<br>break</div><span style="font-weight:700">Docs bold</span>'});
  assert.equal(body.text,'One sentence wrapped in source\n\nLine\nbreak\nDocs bold');assert.ok(body.blocks[0].runs.some(r=>r.text==='Docs bold' && r.b));
});
test('Plain-text bullets nest by indentation and *emphasis* becomes bold',()=>{
  const body=parseBody({text:'Notes:\n- one *important* item\n   - nested\n     wrapped line\n- two\n1. numbered\n\nAfter 2 * 3 * 4'});
  const list=body.blocks.find(b=>b.type==='list');
  assert.deepEqual(list.items.map(i=>[i.depth,i.marker,i.text]),[[0,'•','one important item'],[1,'◦','nested\nwrapped line'],[0,'•','two'],[0,'1.','numbered']]);
  assert.ok(list.items[0].runs.some(r=>r.text==='important' && r.b));assert.equal(body.blocks.at(-1).text,'After 2 * 3 * 4');
});
test('Mail content cannot forge formatting sentinels',()=>{
  const body=parseBody({html:'<p>&#xE000;fake&#xE001; \uE010'+'0|x\uE011 item</p>'});
  assert.equal(body.blocks.length,1);assert.equal(body.blocks[0].type,'text');assert.equal(body.blocks[0].runs,undefined);
});

test('Attachments are listed from the MIME tree, including inline images and forwarded mail, but not body text',()=>{
  const full={contentType:'message/rfc822',parts:[{contentType:'multipart/mixed',partName:'1',parts:[
    {contentType:'multipart/related',partName:'1.1',parts:[{contentType:'text/html',partName:'1.1.1',body:'<img src="cid:logo@x">'},{contentType:'image/png',partName:'1.1.2',size:2048,headers:{'content-id':['<logo@x>']}}]},
    {contentType:'application/pdf',partName:'1.2',name:'Plan.pdf',size:120000,headers:{'content-disposition':['attachment; filename=Plan.pdf']}},
    {contentType:'message/rfc822',partName:'1.3',parts:[{contentType:'text/plain',partName:'1.3.1',name:'inner.txt'}]}]}]};
  assert.deepEqual(listAttachments(full),[
    {partName:'1.1.2',name:'Untitled attachment',contentType:'image/png',size:2048,contentId:'logo@x'},
    {partName:'1.2',name:'Plan.pdf',contentType:'application/pdf',size:120000},
    {partName:'1.3',name:'Forwarded message.eml',contentType:'message/rfc822',size:0}]);
  assert.equal(parseBody({text:'Hi',attachments:listAttachments(full)}).attachments.length,3);
});
test('HTML line breaks follow browser block layout',()=>{
  const cases={
    'Line one<div>Line two</div>Line three':'Line one\nLine two\nLine three',
    '<div>a</div><div><br></div><div>b</div><div>c<br></div><div>d</div>':'a\n\nb\nc\nd',
    '<p class=MsoNormal>Hi<o:p></o:p></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>Body</p>':'Hi\n\nBody',
    '<div><div><div>x</div></div></div><div>y</div>':'x\ny',
    '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td></tr></table>after':'A B\nC\nafter',
    'intro<h2>Title</h2>para':'intro\nTitle\npara',
    // Paragraph margins collapse into one blank line; a trailing <br> or whitespace adds nothing.
    '<p>One\n  wrapped</p>\n  <p>Two <br>\n</p><p><br>\n  Sign-off</p>':'One wrapped\n\nTwo\n\nSign-off',
    '<p style="margin:0">a</p><p style="margin:0">b</p>':'a\nb'
  };
  for(const [html,expected] of Object.entries(cases))assert.equal(htmlText(html),expected,html);
  // A paragraph inside a list item stays part of that item.
  assert.deepEqual(parseBody({html:'<ul><li><p>item</p></li><li>next</li></ul>'}).blocks[0].items.map(i=>i.text),['item','next']);
});

test('Quoted history keeps nesting, attributions and forwarded headers as structure',()=>{
  const plain=parseBody({text:'Sounds good.\n\nOn Mon, Ada wrote:\n> First level\n> > second level\n> - quoted bullet'});
  assert.deepEqual(plain.quoteBlocks.map(b=>[b.type,b.depth || 0,b.text]),[['attribution',0,'On Mon, Ada wrote:'],['text',1,'First level'],['text',2,'second level'],['list',1,'• quoted bullet']]);
  const gmail=parseBody({html:'<div>Reply</div><div class="gmail_quote"><div class="gmail_attr">On Mon, Ada wrote:<br></div><blockquote class="gmail_quote">One<blockquote>Two</blockquote>Back</blockquote></div>'});
  assert.equal(gmail.text,'Reply');assert.deepEqual(gmail.quoteBlocks.map(b=>[b.type,b.depth || 0]),[['attribution',0],['text',1],['text',2],['text',1]]);
  const outlook=parseBody({html:'<p>Reply</p><div id="divRplyFwdMsg"><hr><p><b>From:</b> Ada<br><b>Sent:</b> Monday<br><b>To:</b> Bob<br><b>Subject:</b> Plan</p></div><p>Old body</p>'});
  assert.deepEqual(outlook.quoteBlocks[0].fields,[['From','Ada'],['Sent','Monday'],['To','Bob'],['Subject','Plan']]);assert.equal(outlook.quoteBlocks[1].text,'Old body');
  assert.equal(parseBody({text:'To: everyone\nThanks'}).blocks[0].type,'text','header-like lines outside quotes stay text');
});
