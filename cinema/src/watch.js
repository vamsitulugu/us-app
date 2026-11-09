import * as THREE from 'three';
import {openChannel} from './net.js';
/** The cinema's OWN movie system (no Twin Hearts room, no server in the playback loop). Two phones, one private channel:
 *   - ONE shared timeline {seq, playing, pos, at, by}: whoever presses play / pause / seeks writes the next seq. Everyone derives the same position:
 *       expected = pos + (now - at)      while playing
 *   - NOBODY WAITS FOR ANYBODY. If my video stalls, the timeline keeps running; the partner keeps watching (they only see a small note).
 *     When my video has data again it jumps to the timeline once (a seek, never a pause of both phones). This is what froze both phones before.
 *   - the owner of the timeline repeats it every 3 s (hb), so a lost message heals by itself and slow drift is re-anchored
 *   - drift: speed nudge ±6 % when 0.4–2.5 s off, ONE hard seek when further, never two seeks within 7 s
 *   - the movie: 🎞 a file on each phone (lengths must match within 3 s) or ☁️ the couple's cloud (each phone streams its own signed URL)
 *   - ready gate: Start stays locked until BOTH phones have the movie loaded (myReady / partnerReady / bothReady)
 * Surface used by the rest of the theatre: time, dur, playing, ready, play, pause, seek, tick, tex, aspect, muted, send, follow, resync, live, suspend ... */
const LOAD_MS=30000,STALL_MS=800,NUDGE=.4,HARD=2.5,FOLLOW=1.5,COOLDOWN=7000,DRIFT_MS=1000,HB_MS=3000,LEN_TOL=3;
const ERR={1:'Loading the movie was interrupted',2:'Network problem while loading the movie — check your connection',3:'This video could not be decoded — use an MP4 (H.264 + AAC) copy',4:'This video format is not supported here — use an MP4 (H.264 + AAC) copy'};
const base=n=>String(n||'Movie').replace(/\.[^.]+$/,'').replace(/[._]+/g,' ').trim()||'Movie';
export class Watch{
 /** o = {cloudUrl: async id -> {url,title,durationSec}}  (throws an Error with a readable message when the movie is gone) */
 constructor(o={}){
  this.cloudUrl=o.cloudUrl||null;this.role=0;
  this.v=document.createElement('video');Object.assign(this.v,{playsInline:true,preload:'auto',className:'hv'});document.body.appendChild(this.v);
  this.tex=null;this.src=false;this.meta=null;this.demo={t:0,playing:false,dur:30};this.url=null;this.loading=false;
  this.onend=null;this.onblocked=null;this.onfail=null;this.onstatus=null;this.onmedia=null;this.onremote=null;     // onstatus(text|'') partner note · onmedia(): what is chosen / who is ready changed · onremote({playing,reason,by}): the partner acted
  this.media=null;this.haveMid=0;this.pReady=false;this.pMid=0;this.pBuf=false;this.picking=false;this.problem='';this._tok=0;
  this.ref={seq:0,playing:false,pos:0,at:0,by:0};this.reason=null;
  this.live=false;this.suspend=false;this.applying=false;this.buffering=false;this.stallT=0;
  this.lastSeek=0;this.lastPlay=0;this.lastGood=0;this.recov=0;this.recAt=0;this.kick=0;this.timers=[];this.closed=false;this.ch=null;
  const v=this.v;
  v.addEventListener('ended',()=>this.onend?.());
  v.addEventListener('timeupdate',()=>{if(!v.seeking&&!this.loading)this.lastGood=v.currentTime});
  v.addEventListener('playing',()=>{if(performance.now()-this.recAt>20000)this.recov=0;this._recovered()});
  v.addEventListener('canplay',()=>this._recovered());v.addEventListener('canplaythrough',()=>this._recovered());
  v.addEventListener('waiting',()=>this._waiting());v.addEventListener('stalled',()=>this._waiting());
  v.addEventListener('error',()=>this._err())}
 /* ---------- the movie file ---------- */
 _ready(){const v=this.v;return new Promise((res,rej)=>{let done=false;
   const fin=f=>x=>{if(done)return;done=true;clearTimeout(t);v.onloadedmetadata=v.onerror=null;f(x)},
    t=setTimeout(()=>fin(rej)(new Error('The movie took too long to load — check your connection and try again')),LOAD_MS);
   v.onloadedmetadata=fin(res);v.onerror=()=>fin(rej)(new Error(ERR[v.error?.code]||'Cannot play this file'))})}
 _free(){if(this.v.src&&String(this.v.src).startsWith('blob:'))URL.revokeObjectURL(this.v.src)}
 _bad(){this.loading=false;this.src=false;this.url=null;this.v.removeAttribute('src');try{this.v.load()}catch(e){}}
 _unload(){this._free();this._bad();this.tex?.dispose?.();this.tex=null;this.haveMid=0;this.buffering=false;clearTimeout(this.stallT);this.stallT=0}
 _tex(){this.tex?.dispose?.();this.tex=new THREE.VideoTexture(this.v);this.tex.colorSpace=THREE.SRGBColorSpace;this.src=true;this.lastGood=0;this.recov=0}
 async _loadUrl(url){this._free();this.src=false;this.loading=true;this.v.crossOrigin='anonymous';this.v.src=url;
  try{await this._ready()}catch(e){this._bad();throw e}
  this.loading=false;this.url=url;this._tex();return Math.round(this.v.duration)}
 async _loadFile(file){this._free();this.src=false;this.loading=true;this.v.removeAttribute('crossorigin');this.v.src=URL.createObjectURL(file);
  try{await this._ready()}catch(e){this._free();this._bad();throw e}
  this.loading=false;this.url=null;this._tex();return Math.round(this.v.duration)}
 /** a cloud movie that errors while playing is reloaded with a fresh signed URL and put back at the same second (3 times at most) */
 async _err(){const v=this.v;if(!this.src||this.loading)return;const msg=ERR[v.error?.code]||'The video stopped working';
  if(!(this.media&&this.media.kind==='cloud'&&this.cloudUrl&&this.url)||this.recov>=3){this.onfail?.(msg);return}
  this.recov++;this.recAt=performance.now();const t=this.lastGood,was=!v.paused;this.loading=true;this._status('Reconnecting video…');
  try{const c=await this.cloudUrl(this.media.id);this.url=c.url;v.src=c.url;await this._ready();this.loading=false;this._status();
   v.currentTime=Math.min(t,(v.duration||t)-.5);if(this.live&&this.ref.seq)this.follow();else if(was)this.play()}
  catch(e){this.loading=false;this._status();this.onfail?.(e.message||msg)}}
 /* ---------- what is chosen / who is ready ---------- */
 get myReady(){return!!this.media&&this.src&&!this.loading&&this.haveMid===this.media.mid}
 get partnerReady(){return!!this.media&&this.pReady&&this.pMid===this.media.mid}
 get bothReady(){return this.myReady&&this.partnerReady}
 /** the partner chose a file on their device and I do not have it (yet) */
 get needsFile(){return!!this.media&&this.media.kind==='device'&&!this.myReady&&!this.picking}
 _mid(){return Math.max((this.media?.mid||0)+10,Date.now()*10+this.role)}
 _note(){this.onmedia?.()}
 _sendMedia(){if(this.media)this._tx({k:'med',media:this.media})}
 _sendReady(){this._tx({k:'rdy',mid:this.media?this.media.mid:0,on:this.myReady?1:0})}
 _announce(){this._sendMedia();this._sendReady();this._note()}
 /** 🎞 Choose movie: a file on THIS device. Matches the partner's file (length within 3 s) or, with force, replaces their choice. -> {ok:true} | {ok:false,len:true,msg} | {ok:false,msg} */
 async chooseFile(file,force){
  if(this.picking)return{ok:false,msg:'Still loading the other choice…'};
  this.picking=true;this.problem='';this.haveMid=0;this._note();let dur;
  try{dur=await this._loadFile(file)}catch(e){this.picking=false;this.problem=e.message;this._note();return{ok:false,msg:e.message}}
  const m=this.media;
  if(m&&m.kind==='device'&&m.by!==this.role&&!force){
   if(m.dur&&Math.abs(dur-m.dur)>LEN_TOL){this._unload();this.picking=false;this._note();return{ok:false,len:true,msg:'That file is a different length than your partner’s movie'}}
   this.haveMid=m.mid;this.picking=false;this._sendReady();this._note();this._loaded();return{ok:true}}
  const media={mid:this._mid(),kind:'device',title:base(file.name),dur,size:file.size||0,by:this.role};
  this.media=media;this.haveMid=media.mid;this.picking=false;this._announce();this._loaded();return{ok:true}}
 /** ☁️ Cloud movies: one of the couple's R2 movies. Nothing is announced if it cannot be opened. -> {ok:true} | {ok:false,msg} */
 async chooseCloud(item){
  if(this.picking)return{ok:false,msg:'Still loading the other choice…'};
  if(!this.cloudUrl)return{ok:false,msg:'Your cloud is only available when the cinema is opened from Twin Hearts'};
  this.picking=true;this.problem='';this._note();let c,dur;
  try{c=await this.cloudUrl(item.id)}catch(e){this.picking=false;this._note();return{ok:false,msg:e.message||'Could not open that movie'}}
  this.haveMid=0;
  try{dur=await this._loadUrl(c.url)}catch(e){this.picking=false;this.problem=e.message;this._note();return{ok:false,msg:e.message}}
  const media={mid:this._mid(),kind:'cloud',id:item.id,title:item.title||c.title||'Movie',dur:dur||item.durationSec||0,size:item.sizeBytes||0,by:this.role};
  this.media=media;this.haveMid=media.mid;this.picking=false;this._announce();this._loaded();return{ok:true}}
 /** the partner announced a movie. The higher mid wins when both choose at the same moment. */
 async _rxMedia(m){
  if(!m||!m.mid)return;const cur=this.media;
  if(cur&&cur.mid===m.mid){this._sendReady();return}
  if(cur&&cur.mid>m.mid){this._sendMedia();return}                    // my choice is newer: they will adopt it
  this.media=m;this.problem='';const tok=++this._tok;
  if(this.picking){this._note();return}                               // my own file is still loading: chooseFile() compares it with this movie when done
  if(m.kind==='device'){
   if(this.src&&this.haveMid&&!this.url&&Math.abs((Math.round(this.v.duration)||0)-m.dur)<=LEN_TOL){this.haveMid=m.mid;this._sendReady();this._note();return}   // the file I already have is the same length: ready
   this._unload();this._sendReady();this._note();return}
  this._unload();this.picking=true;this._status('Loading the movie…');this._note();
  try{if(!this.cloudUrl)throw new Error('Your cloud is only available when the cinema is opened from Twin Hearts');
   const c=await this.cloudUrl(m.id);if(tok!==this._tok)return;
   await this._loadUrl(c.url);if(tok!==this._tok)return;
   this.haveMid=m.mid;this.picking=false;this._status();this._sendReady();this._note();this._loaded()}
  catch(e){if(tok!==this._tok)return;this.picking=false;this._status();this.problem=e.message||'Could not load the movie';this._sendReady();this._note()}}
 /** try the movie again (after a failed load, or back online) */
 retry(){const m=this.media;if(!m||this.myReady||this.picking||m.kind!=='cloud')return;this.media=null;this._rxMedia(m)}
 _loaded(){if(this.live&&this.ref.seq)this.follow()}
 get aspect(){return this.src&&this.v.videoHeight?this.v.videoWidth/this.v.videoHeight:0}
 /* ---------- local primitives (what the theatre scene and the ad breaks call) ---------- */
 get time(){return this.src?this.v.currentTime:this.demo.t}
 get dur(){return(this.src?this.v.duration:this.demo.dur)||0}
 get playing(){return this.src?!this.v.paused&&!this.v.ended:this.demo.playing}
 /** false while the video is waiting for data (buffering / seeking). Always true for the demo clock. */
 get ready(){return!this.src||(!this.loading&&this.v.readyState>=3&&!this.v.seeking)}
 get muted(){return this.v.muted}set muted(x){this.v.muted=x}
 play(){if(this.src){this.lastPlay=Date.now();this.v.play()?.catch(e=>{if(e&&e.name==='NotAllowedError')this.onblocked?.()})}else this.demo.playing=true}   // AbortError (pause during play) is normal, not "blocked"
 pause(){this.src?this.v.pause():this.demo.playing=false}
 seek(t){t=Math.max(0,Math.min(t,this.dur||t||0));this.lastSeek=Date.now();if(this.src){this.v.playbackRate=1;this.v.currentTime=t}else this.demo.t=t}
 tick(dt){if(!this.src&&this.demo.playing){this.demo.t+=dt;if(this.demo.t>=this.demo.dur){this.demo.t=this.demo.dur;this.demo.playing=false;this.onend?.()}}}
 /* ---------- the channel ---------- */
 async connect(room,role){this.role=role;if(this.closed)return;
  try{this.ch=await openChannel(room+'~movie',m=>this._rx(m))}catch(e){this.ch=null}
  const every=(f,ms)=>this.timers.push(setInterval(f,ms));
  every(()=>{if(this.ref.seq&&this.ref.by===this.role)this._hb()},HB_MS);every(()=>this._drift(),DRIFT_MS);
  this._wake=()=>{if(document.visibilityState==='hidden')return;this._tx({k:'want'});this.retry();this.follow()};   // back from a sleeping phone / lost connection: ask, then go where the timeline is
  addEventListener('online',this._wake);addEventListener('focus',this._wake);addEventListener('pageshow',this._wake);document.addEventListener('visibilitychange',this._wake);
  this._tx({k:'want',hello:1})}
 close(){this.closed=true;this.timers.forEach(clearInterval);this.timers=[];clearTimeout(this.stallT);
  if(this._wake){removeEventListener('online',this._wake);removeEventListener('focus',this._wake);removeEventListener('pageshow',this._wake);document.removeEventListener('visibilitychange',this._wake)}
  try{this.ch?.close()}catch(e){}this.ch=null}
 _tx(m){try{this.ch?.send({...m,r:this.role})}catch(e){}}
 /** the partner left the room: forget their ready flag */
 partnerLeft(){this.pReady=false;this.pBuf=false;this._status();this._note()}
 _rx(m){if(!m||m.r===this.role||this.closed)return;
  if(m.k==='st')this._rxState(m);
  else if(m.k==='med')this._rxMedia(m.media);
  else if(m.k==='rdy'){this.pReady=!!m.on;this.pMid=m.mid||0;this._note()}
  else if(m.k==='buf'){this.pBuf=!!m.on;this._status()}
  else if(m.k==='want'){if(m.hello){this.pReady=false;this.pBuf=false;this._status();this._note()}     // they (re)started: forget what they had until they say so again
   if(this.media){this._sendMedia();this._sendReady()}if(this.ref.seq)this._hb()}}
 /* ---------- the shared timeline ---------- */
 _seq(){return Math.max(this.ref.seq+1,Date.now())}
 expected(r=this.ref){if(!r.seq)return this.time;if(!r.playing)return r.pos||0;return(r.pos||0)+Math.max(0,(Date.now()-r.at)/1000)}
 /** I pressed play / pause / seek (or the scene did): this is the next action of the timeline. Never while the partner's change is being applied. */
 send(playing,reason){if(this.applying)return 0;const seq=this._seq(),pos=this.time;
  this.ref={seq,playing:!!playing,pos,at:Date.now(),by:this.role};this.reason=reason||null;
  this._tx({k:'st',seq,playing:!!playing,pos,by:this.role,reason:reason||null});return seq}
 /** the owner repeats the timeline (position as it is NOW), so a lost message or a slow drift heals */
 _hb(){const r=this.ref;if(!r.seq)return;this._tx({k:'st',seq:r.seq,playing:r.playing,pos:this.expected(),by:r.by,hb:1,reason:this.reason})}
 _rxState(m){const r=this.ref;if(m.seq<r.seq)return;
  if(m.seq===r.seq){if(m.hb&&m.by===r.by&&!!m.playing===r.playing){r.pos=+m.pos||0;r.at=Date.now()}return}      // the same action again: only the owner's repeat re-anchors the position
  this.ref={seq:m.seq,playing:!!m.playing,pos:+m.pos||0,at:Date.now(),by:m.by};this.reason=m.reason||null;
  if(!this.live||this.suspend)return;                                                                   // kept; follow() applies it when the scene (or the ad break) is over
  this.applying=true;this._apply(false);setTimeout(()=>{this.applying=false},250)}
 _apply(quiet){const r=this.ref,t=this.expected(r);
  if(this.src){if(Math.abs(this.time-t)>(r.playing?FOLLOW:.25))this.seek(t);r.playing?this.play():this.pause()}
  else{this.demo.t=Math.min(t,this.demo.dur);this.demo.playing=!!r.playing}
  if(!quiet)this.onremote?.({playing:r.playing,reason:this.reason,by:r.by})}
 /** bring this video to wherever the timeline says it should be (after a stall / reconnect / ad break / entering the scene) */
 follow(){if(!this.ref.seq||!this.live)return;this._apply(true)}
 /** the Sync button: ask the partner for the timeline and jump to it */
 resync(){this._tx({k:'want'});this.follow();if(this.src)this.v.playbackRate=1;return Promise.resolve(true)}
 /** the movie ended or the theatre is left: nothing to write on a server any more */
 finish(){return Promise.resolve()}
 /* ---------- stalls: NOBODY WAITS. My video buffers, the timeline keeps running, the partner keeps watching. ---------- */
 _status(t){const s=t!=null?t:this.pBuf?'⏳ Your partner is loading…':'';this.onstatus?.(s)}
 _ahead(){const v=this.v;try{for(let i=0;i<v.buffered.length;i++)if(v.currentTime>=v.buffered.start(i)-.1&&v.currentTime<=v.buffered.end(i))return v.buffered.end(i)-v.currentTime}catch(e){}return 0}
 _waiting(){if(!this.src||this.loading||this.buffering||this.stallT||!this.live||this.suspend||this.v.ended)return;
  if(!this.ref.playing&&this.v.paused)return;
  this.stallT=setTimeout(()=>{this.stallT=0;if(this.v.readyState>=3||this._ahead()>.5)return;this._setBuf(true)},STALL_MS)}
 _setBuf(on){if(this.buffering===on)return;this.buffering=on;this._tx({k:'buf',on:on?1:0});this._status()}
 _recovered(){clearTimeout(this.stallT);this.stallT=0;if(!this.buffering)return;this._setBuf(false);this.follow()}   // data again: one jump to the timeline, nobody was paused
 /* ---------- drift: reads only, never writes to the partner ---------- */
 _drift(){const v=this.v;if(this.closed||!this.live||this.suspend)return;
  if(this.buffering){if(this.src&&v.readyState>=3&&!v.seeking)this._recovered();return}
  const r=this.ref;if(!r.seq||!r.playing||this.applying||document.hidden)return;
  if(!this.src){const d=this.expected()-this.demo.t;if(Math.abs(d)>1.2)this.demo.t+=d;return}
  if(v.paused){if(!v.seeking&&v.readyState>=2&&Date.now()-this.kick>3000){this.kick=Date.now();this.follow()}return}   // the timeline is playing but this video is not: try again, not in a tight loop
  if(v.seeking||v.readyState<3||Date.now()-this.lastSeek<COOLDOWN)return;
  const d=this.expected()-v.currentTime,a=Math.abs(d);
  if(a<NUDGE){if(v.playbackRate!==1)v.playbackRate=1}
  else if(a<HARD)v.playbackRate=d>0?1.06:.94;
  else{v.playbackRate=1;this.seek(this.expected())}}}
export const fmt=s=>{s=Math.max(0,s|0);return`${s/60|0}:${String(s%60).padStart(2,'0')}`};
