export const THEMES=['system','light','dark','grey','black','sepia','navy','forest','plum'];
export function orderedMessages(messages,order='chronological'){
  const sorted=[...messages].sort((a,b)=>a.date-b.date || a.messageId.localeCompare(b.messageId));
  return order==='reverse'?sorted.reverse():sorted;
}
export function latestId(messages){return orderedMessages(messages).at(-1)?.messageId || null;}
export function emailAddresses(value){
  const text=Array.isArray(value)?value.join(', '):String(value || '');
  return [...new Set(text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/ig)||[])];
}
export function isExpanded(id,overrides,latest){return overrides.has(id)?overrides.get(id):id===latest;}

export function conversationView(messages,{fold=true,open=false}={}){
  const grouped=fold && messages.length>10;
  return {grouped,messages:grouped && !open?[messages[0],messages.at(-1)]:messages,hidden:grouped?messages.length-2:0};
}
// Splits an address header into {name,email} entries, respecting quoted commas and <...> groups.
export function parseAddresses(value){
  const entries=[],text=Array.isArray(value)?value.join(', '):String(value || '');let current='',quoted=false,angle=false;
  for(const char of text){
    if(char==='"')quoted=!quoted;else if(char==='<' && !quoted)angle=true;else if(char==='>' && !quoted)angle=false;
    if(char===',' && !quoted && !angle){entries.push(current);current='';}else current+=char;
  }
  entries.push(current);
  return entries.map(entry=>entry.trim()).filter(Boolean).map(entry=>{
    const email=emailAddresses(entry)[0] || '';
    const name=entry.replace(/<[^>]*>/g,'').replace(email,'').replace(/^[\s"']+|[\s"']+$/g,'').replace(/\\"/g,'"').trim();
    return {name,email,text:entry};
  });
}
export function displayName(author){const [first]=parseAddresses(author);return first?.name || first?.email.split('@')[0] || String(author || '').trim() || 'Unknown sender';}
export function initials(author){
  if(!String(author || '').trim())return '?';
  const words=displayName(author).replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '?')+(words.length>1?words.at(-1)[0]:'')).toUpperCase();
}
export function hue(text){let hash=0;for(const char of String(text || ''))hash=(hash*31+char.codePointAt(0))>>>0;return hash%360;}
