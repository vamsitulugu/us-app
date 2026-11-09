// Two-person room transport. Supabase Realtime broadcast when .env is set; otherwise BroadcastChannel (two tabs, same browser) for local testing.
import {createClient} from '@supabase/supabase-js';
// Same Supabase project as the web app: its public URL + anon key are read from ../public/index.html at build time (vite.config.js). VITE_* env vars still override.
const env=import.meta.env||{},URL=env.VITE_SUPABASE_URL||(typeof __SB_URL__!=='undefined'?__SB_URL__:''),KEY=env.VITE_SUPABASE_ANON_KEY||(typeof __SB_KEY__!=='undefined'?__SB_KEY__:'');
export const ONLINE=Boolean(URL&&KEY);
/** a raw two-phone message channel (Supabase Realtime broadcast, or BroadcastChannel for two tabs) -> {send(m),close()}. The scene and the movie each open their own. */
export async function openChannel(code,onMsg){return open(code,onMsg)}
let shared=null;const client=()=>shared||(shared=createClient(URL,KEY,{realtime:{params:{eventsPerSecond:20}}}));
async function open(code,onMsg){
 if(ONLINE){const sb=client(),ch=sb.channel('twin:'+code,{config:{broadcast:{self:false}}});
  ch.on('broadcast',{event:'m'},e=>onMsg(e.payload));
  await new Promise(res=>{ch.subscribe(s=>s==='SUBSCRIBED'&&res());setTimeout(res,6000)});
  return{send:m=>ch.send({type:'broadcast',event:'m',payload:m}),close:()=>sb.removeChannel(ch)}}
 const bc=new BroadcastChannel('twin:'+code);bc.onmessage=e=>onMsg(e.data);return{send:m=>bc.postMessage(m),close:()=>bc.close()}}
/** Presence + state sync for a 2-person room. role is 1 or 2. Handlers: onJoin,onLeave,onHello,onPos,onSit,onStand,onConflict. */
export async function createSync(code,role,h){
 let last=0,seen=0,present=false,tr;
 const gone=()=>{if(present){present=false;h.onLeave()}};
 tr=await open(code,m=>{if(!m)return;if(m.p===role){h.onConflict?.();return}seen=performance.now();if(!present){present=true;h.onJoin()}
  if(m.t==='hi'){if(!m.r)tr?.send({t:'hi',p:role,r:1});h.onHello()}else if(m.t==='pos')h.onPos(m);else if(m.t==='sit')h.onSit(m);else if(m.t==='stand')h.onStand(m);else if(m.t==='bye')gone();else h.onMsg?.(m)});
 tr.send({t:'hi',p:role});
 const bye=()=>tr.send({t:'bye',p:role});if(typeof addEventListener==='function')addEventListener('beforeunload',bye);
 return{send:m=>tr.send({...m,p:role}),
  /** call every frame; snap() returns the state to broadcast (10 Hz while moving, ~1 Hz heartbeat otherwise) */
  tick(now,moving,snap){if(now-last>(moving?100:900)){last=now;tr.send({t:'pos',p:role,...snap()})}if(present&&now-seen>6000)gone()},
  get present(){return present},close(){bye();tr.close()}}}
