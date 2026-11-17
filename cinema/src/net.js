// Two-person room transport. Supabase Realtime broadcast when .env is set; otherwise BroadcastChannel (two tabs, same browser) for local testing.
// Reconnect + resume (Nov 17, 2026): a channel that drops (lost internet, phone locked, app in the background) is re-opened by itself,
// and onNet(fn) tells the screen when the link is down so it can show a small "Reconnecting…" badge.
import {createClient} from '@supabase/supabase-js';
// Same Supabase project as the web app: its public URL + anon key are read from ../public/index.html at build time (vite.config.js). VITE_* env vars still override.
const env=import.meta.env||{},URL=env.VITE_SUPABASE_URL||(typeof __SB_URL__!=='undefined'?__SB_URL__:''),KEY=env.VITE_SUPABASE_ANON_KEY||(typeof __SB_KEY__!=='undefined'?__SB_KEY__:'');
export const ONLINE=Boolean(URL&&KEY);
/* ---- link state: every open channel reports up / down; the screen listens with onNet(fn) -> unsubscribe ---- */
const chans=new Map(),listeners=new Set();let linkUp=true;
const offline=()=>typeof navigator!=='undefined'&&navigator.onLine===false;
function recompute(){const up=!offline()&&[...chans.values()].every(Boolean);if(up!==linkUp){linkUp=up;listeners.forEach(f=>{try{f(up)}catch(e){}})}}
export const onNet=f=>{listeners.add(f);return()=>listeners.delete(f)};
export const netUp=()=>linkUp;
if(typeof addEventListener==='function'){addEventListener('offline',recompute);addEventListener('online',recompute)}
/** a raw two-phone message channel (Supabase Realtime broadcast, or BroadcastChannel for two tabs) -> {send(m),close(),reopen()}. The scene and the movie each open their own.
 *  onUp() runs every time the channel comes back after a drop (not the first time): say hello again, ask for the state. */
export async function openChannel(code,onMsg,onUp){return open(code,onMsg,onUp)}
let shared=null;const client=()=>shared||(shared=createClient(URL,KEY,{realtime:{params:{eventsPerSecond:20}}}));
async function open(code,onMsg,onUp){
 if(ONLINE){const sb=client(),id=Symbol('ch');let ch=null,dead=false,ok=false,tries=0,tid=0,first=true,hiddenAt=0,opening=null;
  const set=up=>{ok=up;chans.set(id,up);recompute()};
  const retry=()=>{if(dead||tid)return;tid=setTimeout(()=>{tid=0;if(!dead&&!ok)make()},Math.min(8000,700*(++tries)))};
  const make=()=>{if(dead)return Promise.resolve();if(opening)return opening;
   try{if(ch)sb.removeChannel(ch)}catch(e){}
   const c=sb.channel('twin:'+code,{config:{broadcast:{self:false}}});ch=c;c.on('broadcast',{event:'m'},e=>onMsg(e.payload));
   opening=new Promise(res=>{let done=false;const fin=()=>{if(!done){done=true;opening=null;res()}};
    c.subscribe(s=>{if(dead||c!==ch)return;
     if(s==='SUBSCRIBED'){tries=0;const again=!first;first=false;set(true);fin();if(again){try{onUp?.()}catch(e){}}}
     else if(s==='CHANNEL_ERROR'||s==='TIMED_OUT'||s==='CLOSED'){set(false);fin();retry()}});
    setTimeout(()=>{if(!done){if(!ok)set(false);fin();if(!ok)retry()}},6000)});
   return opening};
  chans.set(id,false);await make();
  /* back from a locked phone / the background / a lost connection: a socket that slept is not trusted, open a fresh channel */
  const sleep=()=>{hiddenAt=performance.now()};
  const wake=()=>{if(dead||(typeof document!=='undefined'&&document.visibilityState==='hidden'))return;const slept=hiddenAt&&performance.now()-hiddenAt>4000;hiddenAt=0;if(!ok||slept||offline()){set(false);tries=0;clearTimeout(tid);tid=0;make()}};
  const vis=()=>document.visibilityState==='hidden'?sleep():wake();
  if(typeof addEventListener==='function'){addEventListener('online',wake);addEventListener('pageshow',wake);addEventListener('focus',wake);addEventListener('twin:resume',wake);addEventListener('twin:pause',sleep);addEventListener('offline',()=>set(false))}
  if(typeof document!=='undefined')document.addEventListener('visibilitychange',vis);
  return{send:m=>{try{const p=ch.send({type:'broadcast',event:'m',payload:m});if(p&&p.then)p.then(r=>{if(r&&r!=='ok'&&!dead){set(false);retry()}},()=>{});return p}catch(e){}},
   reopen:()=>{set(false);return make()},
   close:()=>{dead=true;clearTimeout(tid);chans.delete(id);recompute();try{removeEventListener('online',wake);removeEventListener('pageshow',wake);removeEventListener('focus',wake);removeEventListener('twin:resume',wake);removeEventListener('twin:pause',sleep);document.removeEventListener('visibilitychange',vis)}catch(e){}sb.removeChannel(ch)}}}
 const bc=new BroadcastChannel('twin:'+code);bc.onmessage=e=>onMsg(e.data);return{send:m=>bc.postMessage(m),reopen:()=>Promise.resolve(),close:()=>bc.close()}}
/** Presence + state sync for a 2-person room. role is 1 or 2. Handlers: onJoin,onLeave,onHello,onPos,onSit,onStand,onConflict, onReconnect (the link came back). */
export async function createSync(code,role,h){
 let last=0,seen=0,present=false,tr,hb,conf=0;const born=performance.now();
 const gone=()=>{if(present){present=false;h.onLeave()}};
 const back=()=>{seen=performance.now();tr?.send({t:'hi',p:role});h.onReconnect?.()};           // after a drop: say hello again (the partner answers with theirs) and let the screen ask for the state; give the partner a fresh 15 s before they count as gone
 tr=await open(code,m=>{if(!m)return;
  // same seat heard from another phone: a reload / a phone that just left can still echo for a moment, so only a REAL second phone (heard again and again after a short grace) blocks this one
  if(m.p===role){if(performance.now()-born>4000&&++conf>=3)h.onConflict?.();return}
  conf=0;seen=performance.now();if(!present){present=true;h.onJoin()}
  if(m.t==='hi'){if(!m.r)tr?.send({t:'hi',p:role,r:1});h.onHello()}else if(m.t==='pos')h.onPos(m);else if(m.t==='sit')h.onSit(m);else if(m.t==='stand')h.onStand(m);else if(m.t==='bye')gone();else if(m.t!=='hb')h.onMsg?.(m)},back);
 tr.send({t:'hi',p:role});
 // Presence must not depend on the 3D render loop (a throttled / hidden frame stops it): a plain timer says "I am here" every 1.5 s, and the partner counts as gone only after 15 s of silence.
 hb=setInterval(()=>{tr.send({t:'hb',p:role});if(present&&performance.now()-seen>15000&&linkUp)gone()},1500);     // (while OUR link is down we cannot hear them: that is not "they left")
 const wakeSeen=()=>{seen=performance.now()};if(typeof addEventListener==='function')addEventListener('twin:resume',wakeSeen);
 const bye=()=>tr.send({t:'bye',p:role});if(typeof addEventListener==='function')addEventListener('beforeunload',bye);
 return{send:m=>tr.send({...m,p:role}),
  /** call every frame; snap() returns the state to broadcast (10 Hz while moving, ~1 Hz heartbeat otherwise) */
  tick(now,moving,snap){if(now-last>(moving?100:900)){last=now;tr.send({t:'pos',p:role,...snap()})}if(present&&now-seen>15000&&linkUp)gone()},
  get present(){return present},close(){clearInterval(hb);try{removeEventListener('twin:resume',wakeSeen)}catch(e){}bye();tr.close()}}}
