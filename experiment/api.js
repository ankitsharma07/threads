/* global ExtensionCommon, Services, ChromeUtils, Ci, ThreadsPaneController */
// build.py bundles the controller into this privileged entry point.
var threadsPane = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    this.context=context;this.controllers=new Map();this.nativeTabs=new Map();this.windows=new Map();this.listeners=new Set();this.started=false;this.stopped=false;this.attachments=new Map();
    this.Controller=ThreadsPaneController;
    this.support=ChromeUtils.importESModule('resource:///modules/ExtensionSupport.sys.mjs').ExtensionSupport;
    this.listenerId=`threads-pane:${context.extension.id}`;
    const emit=(tabId,selection)=>{for(const fire of this.listeners)fire.async(tabId,selection).catch(error=>console.error('Threads selection listener:',error));};
    const attachTab=async nativeTab=>{
      const browser=nativeTab.chromeBrowser;
      if(!browser || nativeTab.closed)return;
      if(nativeTab.mode && nativeTab.mode.name!=='mail3PaneTab')return;
      const tabId=context.extension.tabManager.getWrapper(nativeTab).id;
      if(this.controllers.has(tabId))return this.controllers.get(tabId);
      if(this.attachments.has(tabId))return this.attachments.get(tabId);
      const job=(async()=>{
        if(browser.contentWindow?.document?.documentURI!=='about:3pane' || browser.contentWindow.document.readyState!=='complete'){
          await new Promise(resolve=>browser.addEventListener('load',resolve,{once:true,capture:true}));
        }
        const window=browser.contentWindow;
        await window.hasDOMContentLoaded?.promise;
        if(window.document.documentURI!=='about:3pane' || !window.messagePane)throw new Error('Thunderbird mail pane is not ready');
        await window.messagePane.isReady?.();
        if(this.stopped || nativeTab.closed || !browser.isConnected)return;
        this.nativeTabs.set(nativeTab,tabId);
        const controller=new this.Controller({window,tabId,
          pageUrl:context.extension.baseURI.resolve(`src/reader.html?tabId=${tabId}`),
          convertMessage:header=>context.extension.messageManager.convert(header),
          isMailHeader:header=>{
            const type=header.folder?.server?.type;
            const excluded=Ci.nsMsgFolderFlags.Drafts | Ci.nsMsgFolderFlags.Templates;
            return type!=='rss' && type!=='nntp' && !(header.folder.flags & excluded);
          },onSelection:emit,reportError:error=>console.error('Threads pane:',error),
          readPolicy:()=>({
            auto:Services.prefs.getBoolPref('mailnews.mark_message_read.auto',true),
            delay:Services.prefs.getBoolPref('mailnews.mark_message_read.delay',false)?Services.prefs.getIntPref('mailnews.mark_message_read.delay.interval',5)*1000:0,
          }),
          markRead:headers=>{
            const byFolder=new Map();for(const h of headers){if(!byFolder.has(h.folder))byFolder.set(h.folder,[]);byFolder.get(h.folder).push(h);}
            for(const [folder,list] of byFolder)folder.markMessagesRead(list,true);
          }});
        controller.loadParameters={triggeringPrincipal:context.extension.principal};
        controller.attach();this.controllers.set(tabId,controller);controller.replay();
        return controller;
      })();
      this.attachments.set(tabId,job);
      try{return await job;}finally{this.attachments.delete(tabId);}
    };
    const attachWindow=window=>{
      if(this.windows.has(window))return;
      const tabmail=window.document.getElementById('tabmail');if(!tabmail)return;
      const scan=()=>{for(const tab of tabmail.tabInfo)attachTab(tab).catch(console.error);};
      const close=event=>{
        const nativeTab=event.detail?.tabInfo;if(!nativeTab)return;
        const tabId=this.nativeTabs.get(nativeTab);
        this.controllers.get(tabId)?.detach({restore:false});this.controllers.delete(tabId);this.nativeTabs.delete(nativeTab);
      };
      tabmail.addEventListener('TabOpen',scan);tabmail.addEventListener('TabClose',close);
      window.addEventListener('load',scan,true);
      this.windows.set(window,{tabmail,scan,close});scan();
    };
    const detachWindow=window=>{
      const state=this.windows.get(window);if(!state)return;
      state.tabmail.removeEventListener('TabOpen',state.scan);state.tabmail.removeEventListener('TabClose',state.close);
      window.removeEventListener('load',state.scan,true);this.windows.delete(window);
      for(const [id,controller] of this.controllers)if(controller?.window.top===window){controller.detach({restore:false});this.controllers.delete(id);}
    };
    return {threadsPane:{
      start:async()=>{
        if(this.started)return;this.started=true;
        this.support.registerWindowListener(this.listenerId,{chromeURLs:['chrome://messenger/content/messenger.xhtml'],onLoadWindow:attachWindow,onUnloadWindow:detachWindow});
        for(const window of Services.wm.getEnumerator('mail:3pane'))attachWindow(window);
      },
      getSelection:async tabId=>this.controllers.get(tabId)?.getSelection() || null,
      createFilter:async (tabId,email,header)=>{
        const c=this.controllers.get(tabId);if(!c)throw new Error('Open a conversation in a mail folder first');
        if(!['from','to','cc','bcc'].includes(header))throw new Error('Unsupported address header');
        if(/[\r\n]/.test(email))throw new Error('Invalid address');
        c.window.top.MsgFilters(email,c.window.gFolder,header);
      },
      showOriginal:async tabId=>{this.controllers.get(tabId)?.showOriginal();},
      show:async tabId=>{
        const nativeTab=context.extension.tabManager.get(tabId).nativeTab;
        const c=await attachTab(nativeTab);
        if(!c)throw new Error('Select a thread in a mail folder tab to show Threads');
        const splitter=c.window.paneLayout?.messagePaneSplitter;
        if(splitter?.isCollapsed)splitter.isCollapsed=false;
        c.setEnabled(true);
        return true;
      },
      onSelection:new ExtensionCommon.EventManager({context,name:'threadsPane.onSelection',register:fire=>{this.listeners.add(fire);return()=>this.listeners.delete(fire);}}).api(),
    }};
  }
  onShutdown() {
    this.stopped=true;
    if(this.started)this.support.unregisterWindowListener(this.listenerId);
    for(const [window,{tabmail,scan,close}] of this.windows || []){
      tabmail.removeEventListener('TabOpen',scan);tabmail.removeEventListener('TabClose',close);window.removeEventListener('load',scan,true);
    }
    for(const controller of this.controllers?.values() || [])controller?.detach();
    this.controllers?.clear();this.nativeTabs?.clear();this.windows?.clear();this.listeners?.clear();
  }
};
