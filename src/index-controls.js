export function bindIndexControls({document,messenger,report}){
  const pause=document.getElementById('pause'),rescan=document.getElementById('rescan');
  let revision=0;
  function apply(enabled){pause.textContent=enabled?'Pause indexing':'Resume indexing';}
  async function action(type){pause.disabled=true;rescan.disabled=true;revision++;try{const result=await messenger.runtime.sendMessage({type});if(type==='pause')apply(result.enabled);else {apply(true);report('Mailbox rescan started');}}catch(e){report(e.message);}finally{pause.disabled=false;rescan.disabled=false;}}
  pause.onclick=()=>action('pause');rescan.onclick=()=>action('rescan');
  messenger.storage.onChanged.addListener((changes,area)=>{if(area==='local' && changes.indexingEnabled){revision++;apply(changes.indexingEnabled.newValue!==false);}});
  messenger.runtime.sendMessage({type:'status'}).then(status=>{if(revision===0)apply(status.indexingEnabled);}).catch(e=>report(e.message));
  return {apply};
}
