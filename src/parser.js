import {safeLink,plainRuns} from './message-text.js';
import {PARSER_VERSION} from './core.js';
// Formatting travels through the line-based quote/signature detection as private-use sentinels.
// They are stripped from every input (including decoded entities), so mail content can never forge one.
const B=['\uE000','\uE001'],I=['\uE002','\uE003'],U=['\uE004','\uE005'],C=['\uE006','\uE007'];
const LINK_OPEN='\uE008',LINK_MID='\uE009',LINK_CLOSE='\uE00A',ITEM='\uE010',ITEM_END='\uE011',LIST_END='\uE012',BLOCK='\uE013',QUOTE='\uE014',QUOTE_START='\uE015';
const RESERVED=/[\uE000-\uE015]/g,SENTINELS=/\uE008\d*\uE009|\uE010\d+\|[^\uE011]*\uE011|[\uE012\uE014]\d*[\uE012\uE014]|[\uE000-\uE015]/g;
const plain=value=>value.replace(SENTINELS,'');
const BULLETS=['•','◦','▪'];
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,x)=>{
    const known={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'};
    if(x[0]!=='#')return known[x.toLowerCase()];const n=x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):parseInt(x.slice(1),10);
    return n>0 && n<=0x10ffff && !(n>=0xE000 && n<=0xE015)?String.fromCodePoint(n):'�';
  });
}
const inert=html=>html.replace(RESERVED,'').replace(/<(script|style|head|iframe|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
// Converts HTML to text plus sentinels. Tags are walked in order so lists know their depth and numbering,
// and closing tags know which marks they end. No markup survives; the reader builds its own elements.
function markup(html,links=[]) {
  const lists=[],spans=[],anchors=[];let quoteDepth=0;
  return decode(inert(html).replace(/<[!?][^>]*>/g,'')
    // Source line breaks inside HTML are not visible line breaks; only tags are.
    .replace(/\s+/g,' ')
    .replace(/<(\/?)([a-z][a-z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi,(_,close,name,attributes)=>{
      name=name.toLowerCase();
      // Quote nesting travels as depth markers; a client's quote container marks where history begins.
      if(name==='blockquote'){quoteDepth=Math.max(0,quoteDepth+(close?-1:1));return `\n${QUOTE}${quoteDepth}${QUOTE}\n`;}
      if(!close && name==='div' && /\bclass\s*=\s*["'][^"']*(?:gmail_quote|gmail_attr|yahoo_quoted|protonmail_quote|moz-cite-prefix|OutlookMessageHeader|divRplyFwdMsg)/i.test(attributes))return `\n${QUOTE_START}\n`;
      if(name==='ul' || name==='ol'){
        if(!close){lists.push({ordered:name==='ol',n:Number(attributes.match(/\bstart\s*=\s*["']?(\d+)/i)?.[1] || 1)-1});return '\n';}
        return lists.pop()?`\n${LIST_END}${lists.length}${LIST_END}\n`:'\n';
      }
      if(name==='li'){
        if(close)return '\n';
        const list=lists.at(-1),depth=Math.max(0,lists.length-1);
        return `\n${ITEM}${depth}|${list?.ordered?`${++list.n}.`:BULLETS[depth%BULLETS.length]}${ITEM_END}`;
      }
      const mark={b:B,strong:B,i:I,em:I,u:U,ins:U,code:C,tt:C,kbd:C}[name];
      if(mark)return mark[close?1:0];
      if(/^h[1-6]$/.test(name))return close?B[1]+BLOCK:BLOCK+B[0];
      if(name==='span' || name==='font'){
        // Google Docs and Outlook express emphasis through inline styles.
        if(close)return spans.pop() || '';
        const style=attributes.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(x=>x!==undefined) || '';
        const bold=/font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style),italic=/font-style\s*:\s*italic/i.test(style),underline=/text-decoration[^;]*underline/i.test(style);
        spans.push((underline?U[1]:'')+(italic?I[1]:'')+(bold?B[1]:''));return (bold?B[0]:'')+(italic?I[0]:'')+(underline?U[0]:'');
      }
      if(name==='a'){
        if(close)return anchors.pop() || '';
        const match=attributes.match(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        const href=safeLink(decode(match?.[1] ?? match?.[2] ?? match?.[3] ?? ''));
        anchors.push(href?LINK_CLOSE:'');if(!href)return '';
        links.push(href);return `${LINK_OPEN}${links.length-1}${LINK_MID}`;
      }
      if(name==='br')return '\n';
      // Block elements break the line where they start and where they end, like a browser lays them out.
      if(/^(?:p|div|tr|table|tbody|thead|tfoot|dl|dd|dt|address|section|article|header|footer|main|nav|aside|center|figure|figcaption|form|fieldset|hr)$/.test(name))return BLOCK;
      if(close && (name==='td' || name==='th'))return ' ';
      return '';
    }))
    // Adjacent block edges make one break, and a <br> ending a block does not add another;
    // an empty block holding only <br> still leaves its blank line.
    .replace(/[ \t]*\uE013(?:[ \t]*\uE013)*[ \t]*/g,BLOCK).replace(/\n\uE013/g,'\n').replace(/\uE013/g,'\n')
    .replace(/\r/g,'').replace(/[ \t ]+\n/g,'\n').replace(/\n[ \t ]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function htmlText(html) {
  // Text-only output is rendered with textContent; no original HTML enters the DOM.
  return plain(markup(html)).replace(/\n{3,}/g,'\n\n').trim();
}
export function remoteImages(html='') {
  const images=[],seen=new Set();
  // Only image URLs survive parsing. Original markup and event handlers stay inert.
  for(const tag of inert(html).match(/<img\b[^>]*>/gi) || []){
    const attrs=new Map();
    for(const match of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs.set(match[1].toLowerCase(),decode(match[2] ?? match[3] ?? match[4]));
    try{const url=new URL(attrs.get('src'));if(!['https:','http:'].includes(url.protocol) || url.username || url.password || seen.has(url.href))continue;seen.add(url.href);images.push({src:url.href,alt:attrs.get('alt') || ''});}catch{}
  }
  return images;
}
const sameMarks=(a,b)=>a.href===b.href && a.b===b.b && a.i===b.i && a.u===b.u && a.code===b.code;
// Turns sentinel text into runs: {text, href?, b?, i?, u?, code?}. Marks carry across lines of a section.
function runsFor(value,state,links){
  const runs=[];let cursor=0;
  const push=text=>{
    if(!text)return;
    const marks={};for(const key of ['b','i','u','code'])if(state[key])marks[key]=true;
    const href=state.links.at(-1);
    for(const piece of href?[{text,href}]:plainRuns(text)){
      const run={...piece,...marks},last=runs.at(-1);
      if(last && sameMarks(last,run))last.text+=run.text;else runs.push(run);
    }
  };
  const toggles={[B[0]]:['b',1],[B[1]]:['b',-1],[I[0]]:['i',1],[I[1]]:['i',-1],[U[0]]:['u',1],[U[1]]:['u',-1],[C[0]]:['code',1],[C[1]]:['code',-1]};
  for(const match of value.matchAll(/\uE008(\d+)\uE009|[\uE000-\uE00A]/g)){
    push(value.slice(cursor,match.index));cursor=match.index+match[0].length;
    if(match[1]!==undefined)state.links.push(links[Number(match[1])]);
    else if(match[0]===LINK_CLOSE)state.links.pop();
    else {const [key,step]=toggles[match[0]];state[key]=Math.max(0,state[key]+step);}
  }
  push(value.slice(cursor));
  if(runs.length){runs[0].text=runs[0].text.trimStart();runs.at(-1).text=runs.at(-1).text.trimEnd();}
  return runs.filter(run=>run.text);
}
function textBlock(raw,state,links){
  const runs=runsFor(raw,state,links),text=runs.map(run=>run.text).join('');
  if(!text.trim())return null;
  const block={type:'text',text};if(runs.some(run=>run.href || run.b || run.i || run.u || run.code))block.runs=runs;return block;
}
export function parseBody({messageId,text,html,size,attachments=[]}) {
  // Protect code before quote/signature detection, including lines beginning
  // with > or -- inside code. Serialized blocks remain inert strings.
  const protectedCode=new Map(),links=[];let prefix='THREADSCODE';
  while((text || '').includes(prefix) || (html || '').includes(prefix))prefix+='X';
  const protect=(code,language='')=>{const token=`${prefix}${protectedCode.size}END`;protectedCode.set(token,{type:'code',text:code,language});return token;};
  // HTML carries the sender's lists and emphasis, so it wins whenever it has readable content.
  let source=html?markup(html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi,(_match,content)=>{
    const language=content.match(/class=["'][^"']*language-([\w+-]+)/i)?.[1] || '';
    const code=decode(content.replace(/<br\s*\/?\s*>|<\/(?:div|p|li)\s*>/gi,'\n').replace(/<[^>]*>/g,'')).replace(RESERVED,'');
    return `<br>${protect(code,language)}<br>`;
  }),links):'';
  const fromHtml=!!plain(source).trim() || !text;
  if(!fromHtml){source=(text || '').replace(RESERVED,'');links.length=0;protectedCode.clear();}

  const originalLines=source.replace(/\r\n?/g,'\n').split('\n'),lines=[];
  for(let i=0;i<originalLines.length;i++){
    const opening=originalLines[i].match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/);
    if(!opening){
      // Plain-text *emphasis*, as written by mail clients for their text alternative.
      lines.push(fromHtml?originalLines[i]:originalLines[i].replace(/(^|[\s(\[])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s).,;:!?\]])/g,`$1${B[0]}$2${B[1]}`));
      continue;
    }
    const marker=opening[1],code=[];
    while(++i<originalLines.length){
      const ending=originalLines[i].match(/^ {0,3}(`+|~+)\s*$/);
      if(ending && ending[1][0]===marker[0] && ending[1].length>=marker.length){break;}
      code.push(originalLines[i]);
    }
    // Unclosed fences still preserve the remainder as code.
    lines.push(protect(plain(code.join('\n')),opening[2].trim().split(/\s/)[0]));
  }
  let boundary=lines.length,signature=lines.length;
  for(let i=0;i<lines.length;i++) {
    if(protectedCode.has(lines[i].trim()))continue;
    if(/^(?:\uE015|\uE014[1-9]\d*\uE014)$/.test(lines[i].trim())){boundary=i;break;}
    const line=plain(lines[i]);
    if(/^\s*>/.test(line) || /^On .{1,500}wrote:\s*$/i.test(line) || /^-{2,}\s*(Original|Forwarded) Message\s*-*/i.test(line) || (/^From:\s*\S/i.test(line) && lines.slice(i+1,i+6).some(x=>/^(Sent|Date|To|Subject):/i.test(plain(x))))){boundary=i;break;}
    if(/^--\s*$/.test(line))signature=Math.min(signature,i);
  }
  signature=Math.min(signature,boundary);
  function blocksFor(section,quoted=false){
    const blocks=[],state={b:0,i:0,u:0,code:0,links:[]};let paragraph=[],list=null,item=null,indents=[],headers=null,htmlDepth=0,depth=0;
    // Blocks inside quoted history carry their nesting level; the reader draws one bar per level.
    const push=block=>{if(depth)block.depth=depth;blocks.push(block);};
    const flushHeaders=()=>{if(headers){headers.text=headers.fields.map(([label,value])=>`${label}: ${value}`).join('\n');push(headers);headers=null;}};
    const flushParagraph=()=>{const block=textBlock(paragraph.join('\n'),state,links);if(block)push(block);paragraph=[];};
    const closeItem=()=>{
      if(!item)return;const runs=runsFor(item.lines.join('\n'),state,links),entry={depth:item.depth,marker:item.marker,text:runs.map(run=>run.text).join('')};
      if(runs.some(run=>run.href || run.b || run.i || run.u || run.code))entry.runs=runs;
      list.items.push(entry);item=null;
    };
    const flushList=()=>{closeItem();if(list?.items.length){list.text=list.items.map(entry=>`${'  '.repeat(entry.depth)}${entry.marker} ${entry.text}`).join('\n');push(list);}list=null;indents=[];};
    const startItem=(depth,marker,rest,indent=0)=>{flushParagraph();closeItem();list??={type:'list',items:[]};item={depth,marker,indent,lines:[rest]};};
    for(let index=0;index<section.length;index++){
      let line=section[index];
      const marker=line.trim().match(/^\uE014(\d+)\uE014$/);
      if(marker){htmlDepth=Number(marker[1]);continue;}
      if(line.trim()===QUOTE_START)continue;
      // Plain-text quotes nest by their run of > prefixes, which are not content.
      let lineDepth=htmlDepth;
      if(!fromHtml){const prefix=line.match(/^((?:[ \t]*>)+)[ \t]?/);lineDepth=prefix?prefix[1].split('>').length-1:0;if(prefix)line=line.slice(prefix[0].length);}
      if(lineDepth!==depth){flushHeaders();flushParagraph();flushList();depth=lineDepth;}
      const code=protectedCode.get(line.trim()),visible=plain(line);
      if(code){flushHeaders();flushParagraph();flushList();push({...code});continue;}
      if(quoted){
        // Attribution lines and forwarded-header blocks get their own compact styling.
        const attribution=visible.trim().match(/^(?:On .{1,500}wrote:|-{2,}\s*(?:Original|Forwarded) Message\s*-*)$/i);
        if(attribution){flushHeaders();flushParagraph();flushList();push({type:'attribution',text:visible.trim().replace(/^-+\s*|\s*-+$/g,'')});continue;}
        const field=visible.trim().match(/^(From|Sent|Date|To|Cc|Subject):\s*(.*)$/i);
        if(field && (headers || section.slice(index+1,index+6).some(other=>/^\s*(?:>[ \t]*)*(?:Sent|Date|To|Subject):/i.test(plain(other))))){
          flushParagraph();flushList();headers??={type:'headers',fields:[]};headers.fields.push([field[1][0].toUpperCase()+field[1].slice(1).toLowerCase(),field[2].trim()]);continue;
        }
        flushHeaders();
      }
      const end=line.trim().match(/^\uE012(\d+)\uE012$/);
      if(end){closeItem();if(end[1]==='0')flushList();continue;}
      const htmlItem=line.match(/^\s*\uE010(\d+)\|([^\uE011]*)\uE011(.*)$/);
      if(htmlItem){startItem(Number(htmlItem[1]),htmlItem[2],htmlItem[3]);continue;}
      const textItem=fromHtml?null:line.match(/^([ \t]*)([-*•◦▪‣]|\d{1,3}[.)])[ \t]+(\S.*)$/);
      if(textItem){
        // Nesting follows indentation relative to the enclosing items.
        const indent=textItem[1].replace(/\t/g,'    ').length;
        if(!list)indents=[indent];else if(indent>indents.at(-1))indents.push(indent);else while(indents.length>1 && indent<indents.at(-1))indents.pop();
        startItem(indents.length-1,/^\d/.test(textItem[2])?textItem[2]:BULLETS[(indents.length-1)%BULLETS.length],textItem[3],indent);continue;
      }
      if(!visible.trim()){closeItem();if(paragraph.length)paragraph.push(line);continue;}
      // Wrapped lines continue an item: any line inside an HTML item, indented lines in plain text.
      if(item && (fromHtml || /^[ \t]+/.test(line) && line.match(/^[ \t]*/)[0].replace(/\t/g,'    ').length>item.indent)){item.lines.push(line.trim());continue;}
      flushList();paragraph.push(line);
    }
    flushParagraph();flushList();flushHeaders();return blocks;
  }
  const blocks=blocksFor(lines.slice(0,signature)),signatureBlocks=blocksFor(lines.slice(signature,boundary)),quoteBlocks=blocksFor(lines.slice(boundary),true);
  const flatten=section=>section.map(b=>b.text).join('\n\n');
  const result={messageId,parserVersion:PARSER_VERSION,size,remoteImages:remoteImages(html),blocks,text:flatten(blocks),
    signature:flatten(signatureBlocks),quote:flatten(quoteBlocks),signatureBlocks,quoteBlocks,attachments,sourceLength:source.length};
  result.bytes=JSON.stringify(result).length*2;return result;
}
export function chooseBody(part, isRoot=true) {
  // getFull wraps the original MIME body in a top-level RFC822 container.
  // Nested RFC822 containers are attached/forwarded mail and must stay excluded.
  if(part.contentType==='message/rfc822'){
    if(isRoot && part.parts?.length)return chooseBody(part.parts[0],false);
    return {};
  }
  if(part.contentType?.startsWith('multipart/')){
    const parts=(part.parts || []).filter(p=>!p.name && !p.headers?.['content-disposition']?.some(v=>/^attachment/i.test(v)));
    if(part.contentType==='multipart/alternative'){
      // HTML keeps lists, emphasis and named links; the plain part stays alongside as a fallback.
      const options=parts.map(p=>chooseBody(p,false));const plain=options.find(x=>x.text),rich=options.find(x=>x.html);return {...rich,...plain};
    }
    // A mixed container's first body is the message; attached/forwarded mail stays cold.
    for(const p of parts){const result=chooseBody(p,false);if(result.text||result.html)return result;}return {};
  }
  if(part.name || part.headers?.['content-disposition']?.some(v=>/^attachment/i.test(v)))return {};
  if(part.contentType==='text/plain')return {text:part.body || ''};
  if(part.contentType==='text/html')return {html:part.body || ''};
  return {};
}
// Attachment metadata comes from the MIME tree getFull already returned; file contents are fetched only on demand.
export function listAttachments(part,isRoot=true,found=[]) {
  if(part.contentType==='message/rfc822' && isRoot){for(const child of part.parts || [])listAttachments(child,false,found);return found;}
  const type=(part.contentType || 'application/octet-stream').toLowerCase(),disposition=part.headers?.['content-disposition']?.[0] || '';
  const contentId=part.headers?.['content-id']?.[0]?.trim().replace(/^<|>$/g,'');
  if(type==='message/rfc822' || part.name || /^attachment/i.test(disposition) || (contentId && type.startsWith('image/'))){
    if(part.partName)found.push({partName:part.partName,name:String(part.name || (type==='message/rfc822'?'Forwarded message.eml':'Untitled attachment')),contentType:type,size:Number(part.size) || 0,...(contentId?{contentId}:{})});
    return found;
  }
  for(const child of part.parts || [])listAttachments(child,false,found);
  return found;
}
