// A native-feeling popup menu. Items are {label, run, danger?}; null draws a separator.
export function createCardMenu({document,window}){
  const menu=document.getElementById('card-menu');let anchor=null;
  function hide({restoreFocus=false}={}){
    if(!menu.hidden)menu.hidden=true;
    const target=anchor;anchor=null;target?.setAttribute('aria-expanded','false');if(restoreFocus)target?.focus();
  }
  function render(items){
    menu.replaceChildren();
    for(const item of items){
      if(!item){const line=document.createElement('div');line.className='menu-separator';line.setAttribute('role','separator');menu.append(line);continue;}
      const button=document.createElement('button');button.type='button';button.textContent=item.label;button.setAttribute('role','menuitem');
      if(item.danger)button.className='danger';
      button.onclick=()=>{hide({restoreFocus:true});item.run();};menu.append(button);
    }
  }
  function open(target,items){
    anchor?.setAttribute('aria-expanded','false');anchor=target;target.setAttribute('aria-expanded','true');render(items);menu.hidden=false;
    // Align the menu's right edge with the button, flipping above it when there is no room below.
    const rect=target.getBoundingClientRect(),box=menu.getBoundingClientRect(),width=box.width || 240,height=box.height || 320;
    menu.style.left=`${Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8))}px`;
    menu.style.top=`${rect.bottom+4+height>window.innerHeight-8?Math.max(8,rect.top-height-4):rect.bottom+4}px`;
  }
  // Updates labels in place (for example once read/starred state arrives) without moving focus.
  function update(target,items){if(anchor===target && !menu.hidden){const index=[...menu.children].indexOf(document.activeElement);render(items);if(index>=0)menu.children[index]?.focus();}}
  const buttons=()=>[...menu.children].filter(node=>node.tagName.toLowerCase()==='button');
  menu.onkeydown=event=>{
    if(event.key==='Escape' || event.key==='Tab'){hide({restoreFocus:event.key==='Escape'});if(event.key==='Escape')event.preventDefault();return;}
    const list=buttons();let index=list.indexOf(document.activeElement);
    if(event.key==='ArrowDown')index=(index+1)%list.length;else if(event.key==='ArrowUp')index=(index-1+list.length)%list.length;
    else if(event.key==='Home')index=0;else if(event.key==='End')index=list.length-1;else return;
    list[index]?.focus();event.preventDefault();
  };
  document.addEventListener('pointerdown',event=>{if(anchor && !menu.contains(event.target) && !anchor.contains(event.target))hide();});
  window.addEventListener('scroll',event=>{if(anchor && !menu.contains(event.target))hide();},true);window.addEventListener('resize',()=>hide());
  return {open,update,hide,focusFirst:()=>buttons()[0]?.focus(),get anchor(){return anchor;}};
}
