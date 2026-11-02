<template>
  <div class="fixed inset-0 flex flex-col items-center justify-center z-[1] bg-background">
    <div v-if="loading" class="flex flex-col items-center gap-4">
      <div class="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-foreground" />
      <p class="text-sm text-muted-foreground">{{ t('connection.loading') }}</p>
    </div>

    <div v-else-if="errorText" class="flex flex-col items-center gap-4 text-center max-w-[300px]">
      <p class="text-sm text-muted-foreground leading-relaxed">{{ errorText }}</p>
      <div class="flex gap-2">
        <Button @click="retry">{{ t('common.retry') }}</Button>
        <Button variant="outline" @click="goHome">{{ t('common.back') }}</Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { InAppBrowser, ToolBarType, BackgroundColor } from '@capgo/capacitor-inappbrowser'
import type { DownloadCompletedEvent, DownloadFailedEvent } from '@capgo/capacitor-inappbrowser'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { useServerStore } from '@/stores/serverStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { registerBackButton, unregisterBackButton } from '@/services/platform/backButton'
import { buildAppUrl, buildPairUrl } from '@/services/t3code/pairing'
import { loadDeviceIntegrationSettings } from '@/services/platform/deviceIntegration'
import { EXTERNAL_LINK_MESSAGE_TYPE, parseExternalLinkUrl } from '@/services/platform/externalLinks'
import {
  approveNativeNotificationsFromPrompt,
  denyNativeNotificationsFromPrompt,
  emitNativeNotificationFromWebMessage,
  getNativeNotificationDecision,
  WEB_NOTIFICATION_MESSAGE_TYPE,
} from '@/services/platform/nativeNotifications'
import { useI18n } from '@/i18n'

/** Hosted T3 Code web app, used by the "T3 Connect" entry point. */
const HOSTED_WEB_APP_URL = 'https://app.t3.codes'
const APP_FALLBACK_TITLE = 'T3 Code'

const route = useRoute()
const router = useRouter()
const serverStore = useServerStore()
const connectionStore = useConnectionStore()
const { t } = useI18n()

const loading = ref(true)
const errorText = ref('')

const serverId = computed(() => route.params.id as string)
const isHosted = computed(() => route.name === 'connect-hosted' || serverId.value === 'hosted')
const profile = computed(() => serverStore.profiles.find(p => p.id === serverId.value))

let browserClosedHandle: any = null
let pageLoadedHandle: any = null
let messageFromWebviewHandle: any = null
let appStateHandle: any = null
let downloadCompletedHandle: any = null
let downloadFailedHandle: any = null
let notificationPromptResolver: ((value: boolean) => void) | null = null
let notificationPromptPromise: Promise<boolean> | null = null

function removeWebviewListeners(): void {
  if (browserClosedHandle) void browserClosedHandle.remove()
  if (pageLoadedHandle) void pageLoadedHandle.remove()
  if (messageFromWebviewHandle) void messageFromWebviewHandle.remove()
  if (appStateHandle) void appStateHandle.remove()
  if (downloadCompletedHandle) void downloadCompletedHandle.remove()
  if (downloadFailedHandle) void downloadFailedHandle.remove()
  browserClosedHandle = null
  pageLoadedHandle = null
  messageFromWebviewHandle = null
  appStateHandle = null
  downloadCompletedHandle = null
  downloadFailedHandle = null
}

const WEB_NOTIFICATION_PROMPT_RESPONSE_MESSAGE_TYPE = 't3code:web-notification-prompt-response'

function buildNotificationBridgeScript(): string {
  return `(function(){
    if(window.__t3_nativeNotificationBridge)return;
    window.__t3_nativeNotificationBridge=true;
    function post(payload,attempt){
      var app=window.mobileApp;
      if(app&&typeof app.postMessage==='function'){
        app.postMessage({detail:payload});
        return;
      }
      if(attempt<20)setTimeout(function(){post(payload,attempt+1);},50);
    }
    function send(title,options){
      try{
        options=options||{};
        post({
          type:'${WEB_NOTIFICATION_MESSAGE_TYPE}',
          title:String(title||'${APP_FALLBACK_TITLE}'),
          body:options.body?String(options.body):'',
          tag:options.tag?String(options.tag):'',
          icon:options.icon?String(options.icon):'',
          silent:Boolean(options.silent)
        },0);
      }catch(e){}
    }
    function MobileNotification(title,options){
      this.title=String(title||'${APP_FALLBACK_TITLE}');
      this.body=options&&options.body?String(options.body):'';
      this.tag=options&&options.tag?String(options.tag):'';
      this.icon=options&&options.icon?String(options.icon):'';
      this.onclick=null;this.onerror=null;this.onclose=null;this.onshow=null;
      send(title,options);
      var self=this;
      setTimeout(function(){if(typeof self.onshow==='function')self.onshow(new Event('show'));},0);
    }
    MobileNotification.permission='granted';
    MobileNotification.requestPermission=function(callback){
      var promise=Promise.resolve('granted');
      if(typeof callback==='function')promise.then(callback);
      return promise;
    };
    MobileNotification.prototype.close=function(){
      if(typeof this.onclose==='function')this.onclose(new Event('close'));
    };
    MobileNotification.prototype.addEventListener=function(type,listener){
      if(type&&typeof listener==='function')this['on'+type]=listener;
    };
    MobileNotification.prototype.removeEventListener=function(type,listener){
      if(type&&this['on'+type]===listener)this['on'+type]=null;
    };
    MobileNotification.prototype.dispatchEvent=function(event){
      var handler=event&&event.type?this['on'+event.type]:null;
      if(typeof handler==='function')handler.call(this,event);
      return true;
    };
    try{Object.defineProperty(MobileNotification,'name',{value:'Notification'});}catch(e){}
    try{Object.defineProperty(window,'Notification',{configurable:true,writable:true,value:MobileNotification});}
    catch(e){window.Notification=MobileNotification;}
  })();`
}

function jsStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function buildExternalLinkScript(): string {
  return `(function(){
    if(window.__t3_externalLinks)return;
    window.__t3_externalLinks=true;
    var origin=null;
    try{origin=window.location.origin;}catch(e){}
    function externalUrl(href){
      var url;
      try{url=new URL(href,window.location.href);}catch(e){return null;}
      if(url.protocol!=='http:'&&url.protocol!=='https:')return null;
      if(origin&&url.origin===origin)return null;
      return url.href;
    }
    document.addEventListener('click',function(event){
      if(event.defaultPrevented)return;
      if(event.button&&event.button!==0)return;
      var node=event.target;
      if(!node||typeof node.closest!=='function')return;
      var anchor=node.closest('a[href]');
      if(!anchor||anchor.hasAttribute('download'))return;
      var url=externalUrl(anchor.getAttribute('href')||'');
      if(!url)return;
      event.preventDefault();
      event.stopPropagation();
      try{window.mobileApp.postMessage({detail:{type:'${EXTERNAL_LINK_MESSAGE_TYPE}',url:url}});}catch(e){}
    },true);
  })();`
}

function buildDeviceClipboardScript(): string {
  return `(function(){
    if(window.__t3_deviceClipboard)return;
    window.__t3_deviceClipboard=true;
    function fallback(text){
      try{
        var area=document.createElement('textarea');
        area.value=text==null?'':String(text);
        area.setAttribute('readonly','');
        area.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;';
        document.body.appendChild(area);
        var selection=document.getSelection();
        var previous=selection&&selection.rangeCount>0?selection.getRangeAt(0):null;
        area.select();
        area.setSelectionRange(0,area.value.length);
        var copied=false;
        try{copied=document.execCommand('copy');}catch(e){copied=false;}
        document.body.removeChild(area);
        if(previous){selection.removeAllRanges();selection.addRange(previous);}
        return copied;
      }catch(e){return false;}
    }
    var nativeWrite=null;
    try{
      if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
        nativeWrite=navigator.clipboard.writeText.bind(navigator.clipboard);
      }
    }catch(e){}
    var api=navigator.clipboard||{};
    api.writeText=function(text){
      if(nativeWrite){
        try{
          return Promise.resolve(nativeWrite(text)).catch(function(){
            if(fallback(text))return;
            throw new Error('clipboard write failed');
          });
        }catch(e){}
      }
      return fallback(text)?Promise.resolve():Promise.reject(new Error('clipboard write failed'));
    };
    try{Object.defineProperty(navigator,'clipboard',{configurable:true,get:function(){return api;}});}
    catch(e){try{navigator.clipboard=api;}catch(_){}}
  })();`
}

function buildDownloadToastScript(message: string, isError: boolean): string {
  const messageLiteral = jsStringLiteral(message)
  const background = isError ? 'rgba(120,24,24,.96)' : 'rgba(28,28,30,.96)'
  return `(function(){
    var id='t3-device-toast';
    var old=document.getElementById(id);
    if(old)old.remove();
    var style=document.getElementById('t3-device-toast-style');
    if(!style){
      style=document.createElement('style');
      style.id='t3-device-toast-style';
      style.textContent='#t3-device-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;max-width:82vw;padding:9px 14px;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;line-height:1.35;color:#fff;background:${background};box-shadow:0 8px 28px rgba(0,0,0,.45);transition:opacity .4s ease;word-break:break-word;}';
      document.head.appendChild(style);
    }
    var toast=document.createElement('div');
    toast.id=id;
    toast.textContent=${messageLiteral};
    document.body.appendChild(toast);
    setTimeout(function(){toast.style.opacity='0';},2600);
    setTimeout(function(){if(toast.parentNode)toast.parentNode.removeChild(toast);},3200);
  })();`
}

async function showDownloadToast(message: string, isError: boolean): Promise<void> {
  try {
    await InAppBrowser.executeScript({ code: buildDownloadToastScript(message, isError) })
  } catch {
    // The web view may already be closing; there is nothing useful to do here.
  }
}

/**
 * Injects the pull-down tab and its options panel into the host page. This is
 * deliberately page-agnostic: it only wraps a page-level status chip around
 * whatever the server renders below it.
 */
function buildToolbarScript(status: string, displayUrl: string): string {
  const dotColor =
    status === 'connected' ? '#30d158' :
    status === 'checking' || status === 'reconnecting' ? '#ffd60a' :
    status === 'disconnected' || status === 'unreachable' || status === 'wrong_credentials' || status === 'frame_blocked' ? '#ff453a' :
    '#8e8e8e'

  const statusLabel =
    status === 'connected' ? t('status.connected') :
    status === 'checking' ? t('status.checking') :
    status === 'reconnecting' ? t('status.reconnecting') :
    status === 'disconnected' ? t('status.disconnected') :
    status === 'auth_required' ? t('status.authRequired') :
    status === 'wrong_credentials' ? t('status.wrongCredentials') :
    status === 'unreachable' ? t('status.unreachable') :
    status === 'frame_blocked' ? t('status.blocked') :
    status

  const statusLabelLiteral = jsStringLiteral(statusLabel)
  const displayUrlLiteral = jsStringLiteral(displayUrl)

  return `(function(){
    if(document.getElementById('t3-tab'))return;
    var s=document.createElement('style');
    s.textContent='#t3-tab{position:fixed;top:0;left:50%;--t3-pull-y:0px;transform:translate3d(-50%,var(--t3-pull-y),0);z-index:2147483647;cursor:pointer;background:#121212;color:rgba(255,255,255,.9);font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;padding:3px 10px 2px;display:flex;align-items:center;gap:5px;user-select:none;white-space:nowrap;border:1px solid rgba(255,255,255,.7);border-top:none;border-radius:0 0 12px 12px;touch-action:none;will-change:transform}#t3-tab:before{content:"";position:absolute;left:-1px;right:-1px;bottom:calc(100% - 1px);height:140px;background:#121212;border-left:1px solid rgba(255,255,255,.7);border-right:1px solid rgba(255,255,255,.7);pointer-events:none}#t3-tab.t3-releasing{transition:transform .52s cubic-bezier(.16,1,.3,1)}#t3-tab.t3-hiding{transition:transform .9s cubic-bezier(.16,1,.3,1)}#t3-tab-label{position:relative;z-index:1}.t3-tab-spinner{position:absolute;left:50%;bottom:calc(100% + 5px);width:20px;height:20px;box-sizing:border-box;border:3px solid rgba(255,255,255,.28);border-top-color:rgba(255,255,255,.9);border-radius:50%;opacity:0;transform:translate3d(-50%,5px,0) scale(.5);transition:opacity .12s,transform .12s;z-index:1;pointer-events:none}#t3-tab.t3-pulling .t3-tab-spinner,#t3-tab.t3-refreshing .t3-tab-spinner{opacity:1;transform:translate3d(-50%,0,0) scale(1);animation:t3-spin .72s linear infinite}#t3-tab.t3-hiding .t3-tab-spinner{animation:none!important;opacity:0!important;transform:translate3d(-50%,5px,0) scale(.45)!important;transition:opacity .9s cubic-bezier(.16,1,.3,1),transform .9s cubic-bezier(.16,1,.3,1)}@keyframes t3-spin{to{transform:translate3d(-50%,0,0) scale(1) rotate(360deg)}}#t3-panel{position:fixed;top:38px;left:50%;transform:translateX(-50%);z-index:2147483647;display:none;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.5);font-family:-apple-system,BlinkMacSystemFont,sans-serif;min-width:230px;background:#1c1c1e;color:#f5f5f7}#t3-panel.show{display:block}#t3-panel-status{display:flex;align-items:center;gap:6px;padding:9px 12px;font-size:12px;border-bottom:1px solid rgba(255,255,255,.1)}#t3-panel-dot{width:8px;height:8px;border-radius:50%;background:${dotColor};flex:0 0 auto}#t3-panel-url{opacity:.55;margin-left:auto;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#t3-panel-items{display:flex;flex-direction:column;padding:4px}#t3-panel-items button,#t3-panel-toggle{appearance:none;border:0;background:transparent;color:inherit;font:inherit;display:flex;align-items:center;gap:10px;padding:11px 12px;border-radius:8px;text-align:left;cursor:pointer}#t3-panel-items button:active,#t3-panel-toggle:active{background:rgba(255,255,255,.1)}#t3-panel-toggle{cursor:pointer}.t3-ico{display:inline-flex;width:18px;justify-content:center;font-size:15px}.t3-ico-sm{font-size:13px}.t3-switch{position:relative;width:38px;height:22px;border-radius:11px;background:rgba(255,255,255,.25);transition:background .15s;flex:0 0 auto}.t3-switch.t3-on{background:#30d158}.t3-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s}.t3-switch.t3-on .t3-knob{transform:translateX(16px)}';
    document.head.appendChild(s);
    var tab=document.createElement('div');tab.id='t3-tab';
    var tabSpinner=document.createElement('span');tabSpinner.className='t3-tab-spinner';tabSpinner.setAttribute('aria-hidden','true');
    var tabLabel=document.createElement('span');tabLabel.id='t3-tab-label';tabLabel.textContent='Options \\u22EE';
    tab.appendChild(tabSpinner);tab.appendChild(tabLabel);
    document.body.appendChild(tab);
    var panel=document.createElement('div');panel.id='t3-panel';
    var statusRow=document.createElement('div');statusRow.id='t3-panel-status';
    var dot=document.createElement('span');dot.id='t3-panel-dot';
    var label=document.createElement('span');label.textContent=${statusLabelLiteral};
    var urlSpan=document.createElement('span');urlSpan.id='t3-panel-url';urlSpan.textContent=${displayUrlLiteral};
    statusRow.appendChild(dot);statusRow.appendChild(label);statusRow.appendChild(urlSpan);
    panel.appendChild(statusRow);
    var items=document.createElement('div');items.id='t3-panel-items';
    var btns=[
      {i:'\\u21BB',l:${jsStringLiteral(t('common.refresh'))},a:'reload'},
      {i:'\\u2190',l:${jsStringLiteral(t('common.back'))},a:'back'},
      {i:'\\u2192',l:${jsStringLiteral(t('menu.forward'))},a:'forward'},
      {i:'\\u2197',l:${jsStringLiteral(t('menu.browser'))},a:'external'},
    ];
    btns.forEach(function(b){var btn=document.createElement('button');var ico=document.createElement('span');ico.className='t3-ico'+(b.a==='forward'?' t3-ico-sm':'');ico.textContent=b.i;btn.appendChild(ico);var lbl=document.createElement('span');lbl.className='t3-lbl';lbl.textContent=b.l;btn.appendChild(lbl);btn.addEventListener('click',function(){panel.classList.remove('show');switch(b.a){case'external':window.open(window.location.href,'_system');break;case'reload':window.location.reload();break;case'back':window.history.back();break;case'forward':window.history.forward();break}});items.appendChild(btn)});
    var btn=document.createElement('button');btn.id='t3-panel-close';
    var ico=document.createElement('span');ico.className='t3-ico';ico.textContent='\\u2716';
    btn.appendChild(ico);
    var lbl=document.createElement('span');lbl.className='t3-lbl';lbl.textContent=${jsStringLiteral(t('common.close'))};
    btn.appendChild(lbl);
    btn.addEventListener('click',function(){panel.classList.remove('show');if(window.mobileApp)window.mobileApp.close();});
    items.appendChild(btn);var sp=document.createElement('div');sp.style.height='8px';items.appendChild(sp);
    panel.appendChild(items);
    document.body.appendChild(panel);
    var t3Pull={tracking:false,axis:null,startX:0,startY:0,offset:0,pointer:'touch',moved:false};
    var suppressClickUntil=0;
    var t3RefreshOffset=32;
    var t3RefreshTriggerOffset=27;
    var t3MinimumSpinMs=300;
    function t3PullOffset(deltaY){return t3RefreshOffset*(1-Math.exp(-deltaY/48));}
    function t3SetPullOffset(offset){t3Pull.offset=offset;tab.style.setProperty('--t3-pull-y',offset+'px');if(offset>0){tab.classList.add('t3-pulling')}else{tab.classList.remove('t3-pulling')}}
    function t3ResetPull(){tab.classList.remove('t3-pulling','t3-refreshing','t3-hiding');tab.classList.add('t3-releasing');t3SetPullOffset(0);setTimeout(function(){tab.classList.remove('t3-releasing')},340)}
    function t3StartPull(x,y,pointer){if(tab.classList.contains('t3-refreshing'))return;tab.classList.remove('t3-releasing','t3-hiding');t3Pull.tracking=true;t3Pull.axis=null;t3Pull.startX=x;t3Pull.startY=y;t3Pull.offset=0;t3Pull.pointer=pointer;t3Pull.moved=false;t3SetPullOffset(0)}
    function t3MovePull(x,y,event){if(!t3Pull.tracking)return;var dy=y-t3Pull.startY;if(!t3Pull.axis){if(dy<8)return;t3Pull.axis='y';panel.classList.remove('show')}if(dy<=0){t3SetPullOffset(0);return}t3Pull.moved=true;t3SetPullOffset(t3PullOffset(dy));if(event&&event.cancelable)event.preventDefault()}
    function t3EndPull(){if(!t3Pull.tracking)return;var shouldReload=t3Pull.offset>=t3RefreshTriggerOffset;var shouldSuppressClick=t3Pull.moved||t3Pull.offset>0||t3Pull.axis==='y';t3Pull.tracking=false;t3Pull.axis=null;if(shouldReload){suppressClickUntil=Date.now()+t3MinimumSpinMs+250;tab.classList.remove('t3-pulling');tab.classList.add('t3-refreshing');t3SetPullOffset(t3RefreshOffset);setTimeout(function(){window.location.reload()},t3MinimumSpinMs)}else{if(shouldSuppressClick)suppressClickUntil=Date.now()+550;t3ResetPull()}}
    function t3CancelPull(){if(!t3Pull.tracking)return;t3Pull.tracking=false;t3Pull.axis=null;suppressClickUntil=Date.now()+350;t3ResetPull()}
    tab.addEventListener('touchstart',function(e){if(e.touches.length!==1)return;var t=e.touches[0];t3StartPull(t.clientX,t.clientY,'touch')},{passive:false});
    tab.addEventListener('touchmove',function(e){if(e.touches.length!==1)return;var t=e.touches[0];t3MovePull(t.clientX,t.clientY,e)},{passive:false});
    tab.addEventListener('touchend',function(){t3EndPull()});
    tab.addEventListener('touchcancel',function(){t3CancelPull()});
    document.addEventListener('touchmove',function(e){if(t3Pull.pointer!=='touch'||e.touches.length!==1)return;var t=e.touches[0];t3MovePull(t.clientX,t.clientY,e)},{passive:false});
    document.addEventListener('touchend',function(){if(t3Pull.pointer==='touch')t3EndPull()});
    document.addEventListener('touchcancel',function(){if(t3Pull.pointer==='touch')t3CancelPull()});
    tab.addEventListener('mousedown',function(e){if(e.button!==0)return;t3StartPull(e.clientX,e.clientY,'mouse');e.preventDefault()});
    document.addEventListener('mousemove',function(e){if(t3Pull.pointer==='mouse')t3MovePull(e.clientX,e.clientY,e)});
    document.addEventListener('mouseup',function(){if(t3Pull.pointer==='mouse')t3EndPull()});
    tab.addEventListener('click',function(e){e.stopPropagation();if(Date.now()<suppressClickUntil||t3Pull.moved){e.preventDefault();t3Pull.moved=false;return}panel.classList.toggle('show')});
    document.addEventListener('click',function(){panel.classList.remove('show')});
    panel.addEventListener('click',function(e){e.stopPropagation()});
  })();`
}

function ellipsize(value: string, maxLength = 140): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
}

function getNotificationPromptPreview(detail: unknown): string {
  const record = detail && typeof detail === 'object' ? detail as Record<string, unknown> : {}
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const body = typeof record.body === 'string' ? record.body.trim() : ''
  return ellipsize([title, body].filter(Boolean).join('\n') || `${APP_FALLBACK_TITLE} notification`)
}

function buildNotificationApprovalPromptScript(preview: string): string {
  return `(function(){
    function mount(){
    if(!document.body){setTimeout(mount,50);return;}
    var old=document.getElementById('t3-notification-permission-modal');
    if(old)old.remove();
    var style=document.createElement('style');
    style.id='t3-notification-permission-style';
    style.textContent='#t3-notification-permission-modal{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.54);display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#f5f5f7}#t3-notification-permission-box{width:min(330px,100%);background:#1c1c1e;border:1px solid rgba(255,255,255,.14);border-radius:14px;box-shadow:0 16px 44px rgba(0,0,0,.5);overflow:hidden}#t3-notification-permission-content{padding:18px 18px 14px;display:flex;flex-direction:column;gap:12px}#t3-notification-permission-title{font-size:17px;font-weight:700;line-height:1.25;text-align:center}#t3-notification-permission-message{font-size:13px;line-height:1.38;color:rgba(245,245,247,.78);text-align:center}#t3-notification-permission-preview{font-size:13px;line-height:1.35;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word;max-height:88px;overflow:hidden}#t3-notification-permission-foot{font-size:12px;line-height:1.3;color:rgba(245,245,247,.58);text-align:center}#t3-notification-permission-actions{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid rgba(255,255,255,.12)}#t3-notification-permission-actions button{appearance:none;border:0;background:transparent;color:#0a84ff;font-size:16px;padding:13px 8px;font-weight:600}#t3-notification-permission-actions button:first-child{border-right:1px solid rgba(255,255,255,.12);font-weight:500;color:rgba(245,245,247,.8)}';
    document.head.appendChild(style);
    var modal=document.createElement('div');
    modal.id='t3-notification-permission-modal';
    modal.innerHTML='<div id="t3-notification-permission-box"><div id="t3-notification-permission-content"><div id="t3-notification-permission-title">${t('settings.notifications')}</div><div id="t3-notification-permission-message">${t('settings.notificationDescription')}</div><div id="t3-notification-permission-preview"></div></div><div id="t3-notification-permission-actions"><button type="button" data-choice="no">${t('common.cancel')}</button><button type="button" data-choice="yes">${t('common.confirm')}</button></div></div>';
    modal.querySelector('#t3-notification-permission-preview').textContent=${JSON.stringify(preview)};
    function respond(accepted){
      try{window.mobileApp&&window.mobileApp.postMessage&&window.mobileApp.postMessage({detail:{type:'${WEB_NOTIFICATION_PROMPT_RESPONSE_MESSAGE_TYPE}',accepted:accepted}});}catch(e){}
      modal.remove();
    }
    modal.querySelector('[data-choice="yes"]').addEventListener('click',function(){respond(true);});
    modal.querySelector('[data-choice="no"]').addEventListener('click',function(){respond(false);});
    document.body.appendChild(modal);
    }
    mount();
  })();`
}

async function askForNativeNotificationApproval(detail: unknown): Promise<boolean> {
  if (notificationPromptPromise) return notificationPromptPromise

  notificationPromptPromise = new Promise((resolve) => {
    notificationPromptResolver = resolve
  })
  const promptPromise = notificationPromptPromise

  try {
    await InAppBrowser.executeScript({ code: buildNotificationApprovalPromptScript(getNotificationPromptPreview(detail)) })
  } catch {
    resolveNotificationPrompt(false)
  }
  return promptPromise
}

function resolveNotificationPrompt(accepted: boolean): void {
  notificationPromptResolver?.(accepted)
  notificationPromptResolver = null
  notificationPromptPromise = null
}

async function handleWebviewNotificationMessage(detail: unknown): Promise<void> {
  const decision = await getNativeNotificationDecision()
  if (decision === 'ignore') return

  if (decision === 'ask') {
    const accepted = await askForNativeNotificationApproval(detail)
    if (!accepted) {
      await denyNativeNotificationsFromPrompt()
      return
    }

    const granted = await approveNativeNotificationsFromPrompt()
    if (!granted) return
  }

  await emitNativeNotificationFromWebMessage(detail, profile.value?.name ?? APP_FALLBACK_TITLE)
}

function handleDownloadCompleted(event: DownloadCompletedEvent): void {
  const name = event.fileName || t('common.file')
  void showDownloadToast(t('connection.downloaded', { name }), false)
}

function handleDownloadFailed(event: DownloadFailedEvent): void {
  const name = event.fileName || t('common.file')
  void showDownloadToast(t('connection.downloadFailed', { name }), true)
}

/**
 * Opens a tapped external link in the device browser.
 *
 * On Android the in-app browser tab is launched in the device's default
 * browser package (the plugin pins the custom tab when `preventDeeplink` is
 * set). On iOS the plugin presents its browser sheet over the app.
 */
async function openUrlInDefaultBrowser(url: string): Promise<void> {
  try {
    await InAppBrowser.open({ url, preventDeeplink: true })
  } catch {
    // No browser could handle the link; keep the user in the current session.
  }
}

onMounted(async () => {
  await serverStore.load()

  if (isHosted.value) {
    await openWebView(HOSTED_WEB_APP_URL, 'app.t3.codes', 'connected')
    return
  }

  if (!profile.value) { router.push('/'); return }
  registerBackButton(handleBackButton)

  const connected = await connectionStore.connect(profile.value.id)
  if (!connected) {
    loading.value = false
    errorText.value = connectionStore.lastError ?? t('connection.unreachable')
    return
  }

  connectionStore.lastWebviewServerId = profile.value.id

  // A saved token means this device still needs to be (re)paired; otherwise the
  // server is already authorized for this WebView session.
  const token = profile.value.pairingEnabled
    ? await serverStore.getPairingToken(profile.value.id)
    : null
  const url = token
    ? buildPairUrl(profile.value.baseUrl, token)
    : buildAppUrl(profile.value.baseUrl)
  const displayUrl = profile.value.baseUrl.replace(/^https?:\/\//, '')

  await openWebView(url, displayUrl, connectionStore.state)
})

onUnmounted(() => {
  unregisterBackButton()
  removeWebviewListeners()
  resolveNotificationPrompt(false)
})

function openWebView(url: string, displayUrl: string, status: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank')
    loading.value = false
    errorText.value = t('connection.opened')
    return Promise.resolve()
  }
  return openInAppBrowser(url, displayUrl, status)
}

async function openInAppBrowser(url: string, displayUrl: string, status: string): Promise<void> {
  const { enabled: deviceIntegration, openLinksInBrowser } = await loadDeviceIntegrationSettings()

  browserClosedHandle = await InAppBrowser.addListener('closeEvent', () => {
    connectionStore.disconnect()
    removeWebviewListeners()
    resolveNotificationPrompt(false)
    router.push('/')
  })

  if (deviceIntegration) {
    downloadCompletedHandle = await InAppBrowser.addListener('downloadCompleted', handleDownloadCompleted)
    downloadFailedHandle = await InAppBrowser.addListener('downloadFailed', handleDownloadFailed)
  }

  messageFromWebviewHandle = await InAppBrowser.addListener('messageFromWebview', (event) => {
    if (event.detail?.type === WEB_NOTIFICATION_PROMPT_RESPONSE_MESSAGE_TYPE) {
      resolveNotificationPrompt(Boolean(event.detail.accepted))
      return
    }

    if (event.detail?.type === WEB_NOTIFICATION_MESSAGE_TYPE) {
      void handleWebviewNotificationMessage(event.detail)
      return
    }

    const externalUrl = parseExternalLinkUrl(event.detail)
    if (externalUrl) void openUrlInDefaultBrowser(externalUrl)
  })

  pageLoadedHandle = await InAppBrowser.addListener('browserPageLoaded', async () => {
    if (deviceIntegration) {
      await InAppBrowser.executeScript({ code: buildDeviceClipboardScript() })
    }
    if (openLinksInBrowser) {
      await InAppBrowser.executeScript({ code: buildExternalLinkScript() })
    }
    await InAppBrowser.executeScript({ code: buildToolbarScript(status, displayUrl) })
  })

  appStateHandle = await App.addListener('appStateChange', (state) => {
    if (!state.isActive) return
    // Nudge the WebView on resume so a dropped socket reconnects promptly.
    InAppBrowser.executeScript({
      code: `(function(){try{window.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));}catch(e){}})();`
    }).catch(() => {})
  })

  try {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches

    await InAppBrowser.openWebView({
      url,
      toolbarType: ToolBarType.BLANK,
      toolbarColor: isDark ? '#121212' : '#f8f8f8',
      backgroundColor: isDark ? BackgroundColor.BLACK : BackgroundColor.WHITE,
      isInspectable: true,
      useTopInset: false,
      enabledSafeBottomMargin: true,
      disableOverscroll: true,
      activeNativeNavigationForWebview: true,
      handleDownloads: deviceIntegration,
      isPresentAfterPageLoad: true,
      preShowScriptInjectionTime: 'documentStart',
      preShowScript: buildNotificationBridgeScript(),
    })
  } catch {
    removeWebviewListeners()
    loading.value = false
    errorText.value = t('connection.openFailed')
  }
}

async function retry(): Promise<void> {
  errorText.value = ''
  loading.value = true
  if (isHosted.value) { await openWebView(HOSTED_WEB_APP_URL, 'app.t3.codes', 'connected'); return }
  if (!profile.value) { goHome(); return }
  const connected = await connectionStore.connect(profile.value.id)
  if (connected) {
    connectionStore.lastWebviewServerId = profile.value.id
    const token = profile.value.pairingEnabled
      ? await serverStore.getPairingToken(profile.value.id)
      : null
    const url = token
      ? buildPairUrl(profile.value.baseUrl, token)
      : buildAppUrl(profile.value.baseUrl)
    await openWebView(url, profile.value.baseUrl.replace(/^https?:\/\//, ''), connectionStore.state)
  } else {
    loading.value = false
    errorText.value = connectionStore.lastError ?? t('connection.unreachable')
  }
}

function goHome(): void { connectionStore.disconnect(); router.push('/') }
async function handleBackButton(): Promise<boolean> {
  try { await InAppBrowser.close() } catch {}
  connectionStore.disconnect()
  router.push('/')
  return true
}
</script>
