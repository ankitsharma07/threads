export function safeLink(value){
  try{const url=new URL(value);return ['https:','http:','mailto:'].includes(url.protocol) && !url.username && !url.password?url.href:null;}catch{return null;}
}
export function plainRuns(text=''){
  const runs=[];let cursor=0;
  for(const match of text.matchAll(/(?:https?:\/\/|mailto:)[^\s<>"']+/gi)){
    let label=match[0].replace(/[.,;:!?]+$/,'');
    while(label.endsWith(')') && (label.match(/\)/g)||[]).length>(label.match(/\(/g)||[]).length)label=label.slice(0,-1);
    const href=safeLink(label);if(!href)continue;
    if(match.index>cursor)runs.push({text:text.slice(cursor,match.index)});
    runs.push({text:label,href});cursor=match.index+label.length;
  }
  if(cursor<text.length)runs.push({text:text.slice(cursor)});
  return runs.length?runs:[{text}];
}
const MARKS=[['code','code'],['u','u'],['i','em'],['b','strong']];
export function appendMessageText(parent,block,document,send,report){
  for(const run of block.runs || plainRuns(block.text)){
    const href=safeLink(run.href);let node=document.createElement(href?'a':'span');node.textContent=run.text;
    if(href){node.setAttribute('href',href);node.setAttribute('title',href);node.setAttribute('rel','noopener noreferrer');
      node.onclick=event=>{event.preventDefault();send({type:'openLink',url:href}).catch(e=>report(e.message));};
      node.onauxclick=event=>{if(event.button===1){event.preventDefault();send({type:'openLink',url:href}).catch(e=>report(e.message));}};
    }
    // Emphasis is rebuilt from flags as fresh elements; no sender markup or attributes reach the DOM.
    for(const [flag,tag] of MARKS)if(run[flag]){const wrapper=document.createElement(tag);wrapper.append(node);node=wrapper;}
    parent.append(node);
  }
}
export function appendBlocks(parent,blocks,document,send,report){
  // Quoted levels become nested containers so each level draws its own bar, like a conversation history.
  const stack=[parent];
  for(const block of blocks){
    const depth=Math.min(block.depth || 0,6);
    while(stack.length-1>depth)stack.pop();
    while(stack.length-1<depth){const level=document.createElement('div');level.className='quote-level';stack.at(-1).append(level);stack.push(level);}
    stack.at(-1).append(blockElement(block,document,send,report));
  }
}
function blockElement(block,document,send,report){
  if(block.type==='code'){
    const pre=document.createElement('pre'),code=document.createElement('code');pre.className='code-block';pre.tabIndex=0;code.textContent=block.text;pre.append(code);
    if(block.language)pre.setAttribute('aria-label',`${block.language} code`);return pre;
  }
  if(block.type==='list'){
    const list=document.createElement('ul');list.className='list-block';
    for(const item of block.items){
      const li=document.createElement('li'),marker=document.createElement('span'),content=document.createElement('span');
      li.style.setProperty('--depth',String(Math.min(item.depth,8)));marker.className='list-marker';marker.textContent=item.marker;marker.setAttribute('aria-hidden','true');
      content.className='list-text';appendMessageText(content,item,document,send,report);li.append(marker,content);list.append(li);
    }
    return list;
  }
  if(block.type==='attribution'){const line=document.createElement('div');line.className='quote-attribution';line.textContent=block.text;return line;}
  if(block.type==='headers'){
    const fields=document.createElement('dl');fields.className='quote-headers';
    for(const [label,value] of block.fields){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;fields.append(term,detail);}
    return fields;
  }
  const text=document.createElement('div');text.className='text-block';appendMessageText(text,block,document,send,report);return text;
}
