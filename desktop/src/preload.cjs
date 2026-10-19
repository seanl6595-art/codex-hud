'use strict';
// Sandboxed isolated world only. No contextBridge, filesystem, token or API is
// exposed to the GUI. The only outbound message contains ready state and three
// enumerated UI preferences; the main process checks its frame and origin.
const {ipcRenderer}=require('electron');
const allowed={
  'codex-hud.language.v1':['en','zh-CN'],
  'codex-hud.include-auto-review.v1':['yes','no'],
  'codex-hud.chart-type.v1':['bar','line']
};
if(location.protocol==='http:'&&location.hostname==='127.0.0.1'&&process.isMainFrame){
  const flag=process.argv.find(arg=>arg.startsWith('--codex-hud-preferences='));
  try{const initial=JSON.parse(decodeURIComponent(flag?.slice('--codex-hud-preferences='.length)||'{}'));for(const [key,values]of Object.entries(allowed))if(values.includes(initial[key])&&!values.includes(localStorage.getItem(key)))localStorage.setItem(key,initial[key]);}catch{}
  const read=()=>{const result={};for(const [key,values]of Object.entries(allowed)){try{const value=localStorage.getItem(key);if(values.includes(value))result[key]=value;}catch{}}return result;};
  let previous=JSON.stringify(read()),settled=false,scheduled=false;
  const emit=(kind,outcome)=>ipcRenderer.send('codex-hud:ui',{kind,outcome,preferences:read()});
  const check=()=>{
    scheduled=false;
    if(settled)return;
    const error=document.querySelector('main .error-box');
    const missing=document.querySelector('main .onboarding');
    const metrics=document.querySelector('main .metrics');
    const heatmap=document.querySelectorAll('.heatmap-grid button').length>=84;
    if(error||missing||(metrics&&heatmap)){
      settled=true;observer.disconnect();emit('ready',error?'error':missing?'missing':'data');
    }
  };
  const observer=new MutationObserver(()=>{if(!scheduled){scheduled=true;setTimeout(check,16);}});
  window.addEventListener('DOMContentLoaded',()=>{observer.observe(document.documentElement,{childList:true,subtree:true});check();});
  setInterval(()=>{const next=JSON.stringify(read());if(next!==previous){previous=next;emit('preferences');}},1000);
  window.addEventListener('pagehide',()=>emit('preferences'));
}
