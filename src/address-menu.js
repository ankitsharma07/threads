export const HOVER_DELAY=300;
export function createAddressMenu({document,window,send,report}){
  const menu=document.getElementById('address-menu');let closeTimer,hoverTimer,revision=0,anchor=null,ignoreFocus=false;
  function hide(){clearTimeout(closeTimer);clearTimeout(hoverTimer);if(!menu.hidden)menu.hidden=true;revision++;anchor=null;}
  function scheduleClose(){clearTimeout(closeTimer);clearTimeout(hoverTimer);closeTimer=setTimeout(hide,220);}
  function button(label,action){const item=document.createElement('button');item.type='button';item.textContent=label;item.setAttribute('role','menuitem');item.onclick=action;return item;}
  async function run(action,email,header,bookId){
    hide();try{const result=await send({type:'addressAction',action,email,header,bookId});report(result.message);}catch(error){report(error.message);}
  }
  function open(target,email,header){
    if(ignoreFocus || target.isConnected===false)return;clearTimeout(closeTimer);clearTimeout(hoverTimer);revision++;anchor=target;menu.replaceChildren();menu.hidden=false;
    const heading=document.createElement('div');heading.className='address-menu-heading';heading.textContent=email;menu.append(heading);
    menu.append(button('Filter messages in this folder',()=>run('filter',email,header)),button('Create message filter…',()=>run('createFilter',email,header)));
    menu.append(button('Add contact to address book…',async()=>{
      const generation=++revision;menu.replaceChildren();const label=document.createElement('div');label.textContent='Choose an address book';label.className='address-menu-heading';menu.append(label);
      try{
        const books=await send({type:'addressBooks'});if(generation!==revision || menu.hidden)return;
        if(!books.length){label.textContent='No writable local address book';return;}
        for(const book of books)menu.append(button(book.name,()=>run('contact',email,header,book.id)));
        menu.children[1]?.focus();
      }catch(error){if(generation===revision)label.textContent=error.message;}
    }));
    menu.append(button('Send email…',()=>run('compose',email,header)));
    const rect=target.getBoundingClientRect(),width=menu.getBoundingClientRect().width || 260,height=menu.getBoundingClientRect().height || 220;
    menu.style.left=`${Math.max(8,Math.min(rect.left,window.innerWidth-width-8))}px`;
    menu.style.top=`${Math.max(8,Math.min(rect.bottom,window.innerHeight-height-8))}px`;
  }
  // Hover waits briefly so a pointer that merely passes over an address (for example while cards
  // expand or collapse under it) does not pop the menu open.
  function hoverOpen(target,email,header){clearTimeout(hoverTimer);if(anchor===target && !menu.hidden){clearTimeout(closeTimer);return;}hoverTimer=setTimeout(()=>open(target,email,header),HOVER_DELAY);}
  menu.onmouseenter=()=>clearTimeout(closeTimer);menu.onmouseleave=scheduleClose;
  menu.onkeydown=event=>{
    if(event.key==='Escape'){const target=anchor;hide();ignoreFocus=true;target?.focus();queueMicrotask(()=>{ignoreFocus=false;});event.preventDefault();}
    if(['ArrowDown','ArrowUp'].includes(event.key)){
      const buttons=[...menu.children].filter(node=>node.tagName.toLowerCase()==='button');let index=buttons.indexOf(document.activeElement);
      index=(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index]?.focus();event.preventDefault();
    }
  };
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target) && !anchor?.contains(event.target))hide();});
  window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
  return {open,hoverOpen,hide,scheduleClose,focusFirst:()=>menu.children[1]?.focus(),get anchor(){return anchor;}};
}
