/* Native-pane adapter. Kept independent of privileged API setup for testing. */
var ThreadsPaneController = class {
  constructor({window, tabId, pageUrl, convertMessage, isMailHeader, onSelection, reportError}) {
    Object.assign(this,{window,tabId,pageUrl,convertMessage,isMailHeader,onSelection,reportError});
    this.pane=window.messagePane || window.document.getElementById('messagePane');
    this.enabled=true;this.detached=false;this.revision=0;this.current=null;this.bypassKey=null;
  }
  key(header){return `${header.folder.URI}#${header.messageKey}`;}
  attach() {
    if(!this.pane || typeof this.pane.displayMessage!=='function' || typeof this.pane.displayMessages!=='function' || typeof this.pane.displayWebPage!=='function')throw new Error('Unsupported Thunderbird message pane');
    this.originalSingle=this.pane.displayMessage;this.originalMultiple=this.pane.displayMessages;
    const controller=this;
    this.single=function(uri,...args){
      if(controller.detached)return controller.originalSingle.call(this,uri,...args);
      const headers=uri ? controller.window.gDBView?.getSelectedMsgHdrs() || [] : [];
      if(uri && headers[0] && headers[0].folder.getUriForMsg(headers[0])!==uri){controller.clearSelection();return controller.originalSingle.call(this,uri,...args);}
      return controller.route(headers,()=>controller.originalSingle.call(this,uri,...args));
    };
    this.multiple=function(headers=[],...args){
      if(controller.detached)return controller.originalMultiple.call(this,headers,...args);
      return controller.route(headers,()=>controller.originalMultiple.call(this,headers,...args));
    };
    this.pane.displayMessage=this.single;this.pane.displayMessages=this.multiple;
  }
  nativeThread(headers) {
    if(!headers.length || !headers.every(this.isMailHeader))return null;
    const view=this.window.gDBView;if(!view)return null;
    const threadFor=h=>view.getThreadContainingMsgHdr(h);
    const thread=threadFor(headers[0]);
    const root=t=>t.getRootHdr?.() || t.getChildHdrAt(0);
    const key=this.key(root(thread));
    if(headers.some(h=>this.key(root(threadFor(h)))!==key))return null;
    const members=[];for(let i=0;i<thread.numChildren;i++)members.push(thread.getChildHdrAt(i));
    return members.length ? members : headers;
  }
  clearSelection(){this.revision++;this.current=null;this.onSelection(this.tabId,null);}
  route(headers,fallback) {
    const selected=headers[0];
    if(!this.enabled || !selected || this.pane.classList.contains('collapsed-by-splitter')){this.clearSelection();return fallback();}
    if(this.bypassKey && this.bypassKey!==this.key(selected))this.bypassKey=null;
    if(this.bypassKey===this.key(selected)){this.clearSelection();return this.originalSingle.call(this.pane,selected.folder.getUriForMsg(selected));}
    try {
      const members=this.nativeThread(headers);
      if(!members){this.clearSelection();return fallback();}
      const revision=++this.revision;
      const promise=Promise.all(members.map(h=>this.convertMessage(h))).then(async messages=>({
        selected:await this.convertMessage(selected),messages,
      }));
      this.current={selected,members,promise};
      const browser=this.pane.webBrowser;
      if(browser?.currentURI?.spec!==this.pageUrl || browser.hidden) {
        this.pane.displayWebPage(this.pageUrl,this.loadParameters);
      } else {
        browser.docShellIsActive=this.window.tabOrWindow?.selected!==false;
      }
      this.pane.dispatchEvent(new this.window.CustomEvent('request-count-update',{bubbles:true}));
      promise.then(snapshot=>{if(!this.detached && revision===this.revision)this.onSelection(this.tabId,snapshot);})
        .catch(error=>{if(!this.detached && revision===this.revision){this.reportError(error);this.clearSelection();fallback();}});
    }catch(error){this.reportError(error);this.clearSelection();return fallback();}
  }
  async getSelection(){return this.current ? this.current.promise : null;}
  replay(){this.window.threadPane?._onSelect();}
  setEnabled(enabled){this.enabled=enabled;this.bypassKey=null;this.replay();return this.enabled;}
  showOriginal(){
    const selected=this.current?.selected;if(!selected)return;
    this.bypassKey=this.key(selected);this.clearSelection();
    return this.originalSingle.call(this.pane,selected.folder.getUriForMsg(selected));
  }
  detach({restore=true}={}) {
    if(this.detached)return;this.detached=true;this.revision++;
    if(this.pane.displayMessage===this.single)this.pane.displayMessage=this.originalSingle;
    if(this.pane.displayMessages===this.multiple)this.pane.displayMessages=this.originalMultiple;
    if(restore && !this.window.closed && this.pane.webBrowser?.currentURI?.spec===this.pageUrl){this.pane.clearWebPage();this.replay();}
    this.current=null;
  }
};
