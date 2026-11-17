/* ------------------------------------------------------------------
   Cinema voice + video calls.
   Same call UI and same call engine as the Twin Hearts movie page (public/movie.js, SECTION 12):
   the cinema runs in a same-origin frame, so window.parent.Call (public/chat/call.js) is the SAME
   engine the movie page uses (registerWatchSession / startWatchCall / endWatchCall / getWatchState /
   getRemoteStream / getRemoteCamOn / toggleMute / toggleSpeaker / flipCamera).
   No new WebRTC or backend code lives here, only the mini call UI:
     VOICE -> compact bar (tap it to collapse to a pill)
     VIDEO -> small 9:16 window (drag it; tap the timer pill for Mute / Speaker / Swap / Minimize / End),
              minimizes to a round live bubble (same stream, no reconnect)
------------------------------------------------------------------- */
const I={
 phone:'<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
 off:'<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/>',
 video:'<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>',
 mic:'<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
 micoff:'<line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
 spk:'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
 spkoff:'<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
 swap:'<path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/><path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5"/><circle cx="12" cy="12" r="3"/><path d="m18 22-3-3 3-3"/><path d="m6 2 3 3-3 3"/>',
 min:'<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>'};
const svg=(p,s=18)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

/** o = { sessionId, partnerName(), toast(msg), setActive(name,bool) } */
export function createCall(o){
 const getCall=()=>{try{return window.parent&&window.parent!==window?window.parent.Call||null:window.Call||null}catch(e){return null}};
 const host=()=>{try{return window.parent&&window.parent!==window?window.parent:window}catch(e){return window}};
 const root=document.createElement('div');root.id='cc';
 root.innerHTML=`
  <div class="wt-voice-bar" id="wtVoiceBar" hidden>
   <span class="wt-voice-bar-icon">${svg(I.phone,16)}</span><span class="wt-voice-bar-name" id="wtVoiceBarName">Partner</span><span class="wt-voice-bar-time" id="wtVoiceBarTime">00:00</span>
   <button id="voiceMuteBtn" aria-label="Mute">${svg(I.mic)}</button><button id="voiceSpeakerBtn" aria-label="Speaker">${svg(I.spk)}</button><button id="voiceEndBtn" aria-label="End call" class="wt-voice-bar-end">${svg(I.off)}</button></div>
  <button class="wt-voice-pill" id="wtVoicePill" hidden aria-label="Expand call">${svg(I.phone,14)}<span id="wtVoicePillTime">00:00</span></button>
  <div class="wt-video-win" id="wtVideoWin" hidden>
   <div class="wt-video-win-frame"><video id="wtVideoWinVideo" autoplay playsinline></video><div class="wt-video-win-avatar-fallback" id="wtVideoWinAvatarFallback" hidden></div></div>
   <button class="wt-video-runtime" id="wtVideoRuntime" aria-label="Call controls">${svg(I.video,12)}<span id="wtVideoRuntimeTime">00:00</span></button>
   <div class="wt-video-vmenu" id="wtVideoVMenu">
    <button id="vmenuMuteBtn" aria-label="Mute">${svg(I.mic,16)}<label>Mute</label></button>
    <button id="vmenuSpeakerBtn" aria-label="Speaker">${svg(I.spk,16)}<label>Speaker</label></button>
    <button id="vmenuSwapBtn" aria-label="Swap camera">${svg(I.swap,16)}<label>Swap</label></button>
    <button id="vmenuMinBtn" aria-label="Minimize">${svg(I.min,16)}<label>Minimize</label></button>
    <button id="vmenuEndBtn" class="wt-video-vmenu-danger" aria-label="End call">${svg(I.off,16)}<label>End</label></button></div></div>
  <div class="wt-video-bubble" id="wtVideoBubble" hidden><video id="wtVideoBubbleVideo" autoplay playsinline></video><div class="wt-video-bubble-avatar-fallback" id="wtVideoBubbleAvatarFallback" hidden></div></div>`;
 document.body.appendChild(root);
 const $=id=>root.querySelector('#'+id);
 const voiceBar=$('wtVoiceBar'),voicePill=$('wtVoicePill'),videoWin=$('wtVideoWin'),videoWinVideo=$('wtVideoWinVideo'),videoWinFallback=$('wtVideoWinAvatarFallback'),
  videoRuntime=$('wtVideoRuntime'),videoRuntimeTime=$('wtVideoRuntimeTime'),videoVMenu=$('wtVideoVMenu'),
  videoBubble=$('wtVideoBubble'),videoBubbleVideo=$('wtVideoBubbleVideo'),videoBubbleFallback=$('wtVideoBubbleAvatarFallback');
 const setIc=(btn,p,s=18)=>{btn.innerHTML=svg(p,s)+(btn.querySelector('label')?`<label>${btn.querySelector('label').textContent}</label>`:'')};
 let timerInt=null,startedAt=null,videoMinimized=false,voiceCollapsed=false,registered=null,lastKind='';
 const pName=()=>(o.partnerName&&o.partnerName())||'Partner';
 const dur=()=>{if(!startedAt)return'00:00';const s=Math.max(0,Math.floor((Date.now()-startedAt)/1000));return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
 function updateTimers(){const t=dur();$('wtVoiceBarTime').textContent=t;$('wtVoicePillTime').textContent=t;videoRuntimeTime.textContent=t}
 function bindRemote(el,stream){if(el.srcObject!==stream)el.srcObject=stream;const p=el.play();if(p&&p.catch)p.catch(()=>{})}   // assigning srcObject alone does not always start the frames on a WebView
 function hideAll(){voiceBar.hidden=voicePill.hidden=videoWin.hidden=videoBubble.hidden=true;if(timerInt){clearInterval(timerInt);timerInt=null}startedAt=null;lastKind='';o.setActive?.('voice',false);o.setActive?.('video',false)}
 function refresh(){
  const Call=getCall();
  if(!Call||typeof Call.getWatchState!=='function'){hideAll();return}
  const st=Call.getWatchState();                 // active only for a watch call belonging to the session registered below
  if(!st.active){hideAll();videoVMenu.classList.remove('is-open');return}
  const stream=Call.getRemoteStream();
  if(!timerInt)timerInt=setInterval(updateTimers,1000);
  startedAt=st.startedAt||null;updateTimers();
  o.setActive?.('voice',st.callType!=='video');o.setActive?.('video',st.callType==='video');
  if(st.callType==='video'){
   voiceBar.hidden=voicePill.hidden=true;
   setIc($('vmenuMuteBtn'),st.muted?I.micoff:I.mic,16);$('vmenuMuteBtn').classList.toggle('is-active',!!st.muted);
   setIc($('vmenuSpeakerBtn'),st.speakerOn?I.spk:I.spkoff,16);$('vmenuSpeakerBtn').classList.toggle('is-active',!!st.speakerOn);
   const camOn=typeof Call.getRemoteCamOn==='function'?Call.getRemoteCamOn():true,ini=(pName()[0]||'P').toUpperCase();
   if(videoMinimized){videoWin.hidden=true;videoBubble.hidden=false;
    if(stream&&camOn){bindRemote(videoBubbleVideo,stream);videoBubbleVideo.hidden=false;videoBubbleFallback.hidden=true}else{videoBubbleVideo.hidden=true;videoBubbleFallback.hidden=false;videoBubbleFallback.textContent=ini}}
   else{videoBubble.hidden=true;videoWin.hidden=false;
    if(stream&&camOn){bindRemote(videoWinVideo,stream);videoWinVideo.hidden=false;videoWinFallback.hidden=true}else{videoWinVideo.hidden=true;videoWinFallback.hidden=false;videoWinFallback.textContent=ini}}
  }else{
   videoWin.hidden=videoBubble.hidden=true;
   if(voiceCollapsed){voiceBar.hidden=true;voicePill.hidden=false}else{voicePill.hidden=true;voiceBar.hidden=false}
   $('wtVoiceBarName').textContent=pName();
   setIc($('voiceMuteBtn'),st.muted?I.micoff:I.mic);setIc($('voiceSpeakerBtn'),st.speakerOn?I.spk:I.spkoff)}}
 try{host().addEventListener('uwl:call-stream-changed',refresh)}catch(e){}
 setInterval(refresh,3000);

 /* voice bar */
 const call=fn=>{try{const C=getCall();C&&C[fn]&&C[fn]()}catch(e){}};
 $('voiceMuteBtn').onclick=e=>{e.stopPropagation();call('toggleMute');refresh()};
 $('voiceSpeakerBtn').onclick=e=>{e.stopPropagation();call('toggleSpeaker');refresh()};
 $('voiceEndBtn').onclick=e=>{e.stopPropagation();call('endWatchCall');refresh()};
 voiceBar.addEventListener('click',()=>{voiceCollapsed=true;refresh()});      // the whole bar collapses it; the three buttons above stop the click
 voicePill.onclick=()=>{voiceCollapsed=false;refresh()};

 /* video window: drag, snap to a side */
 const DRAG_BOTTOM_RESERVE=150;
 const clamp=(el,l,t)=>({left:Math.min(Math.max(l,4),Math.max(4,innerWidth-el.offsetWidth-4)),top:Math.min(Math.max(t,4),Math.max(4,innerHeight-el.offsetHeight-DRAG_BOTTOM_RESERVE))});
 const snap=el=>{const r=el.getBoundingClientRect(),left=r.left<innerWidth/2;el.style.left=el.style.top=el.style.right=el.style.bottom='';el.style.left=left?'12px':'auto';el.style.right=left?'auto':'12px'};
 function drag(el,{skip,onTap}={}){let sx,sy,ox,oy,on=false,moved=false;
  el.addEventListener('pointerdown',e=>{if(skip&&skip(e.target))return;on=true;moved=false;sx=e.clientX;sy=e.clientY;const r=el.getBoundingClientRect();ox=r.left;oy=r.top;el.setPointerCapture(e.pointerId)});
  el.addEventListener('pointermove',e=>{if(!on)return;const dx=e.clientX-sx,dy=e.clientY-sy;if(Math.abs(dx)>6||Math.abs(dy)>6)moved=true;
   if(moved){const p=clamp(el,ox+dx,oy+dy);el.style.left=p.left+'px';el.style.top=p.top+'px';el.style.right='auto';el.style.bottom='auto';if(el===videoWin&&videoVMenu.classList.contains('is-open'))posMenu()}});
  el.addEventListener('pointerup',()=>{if(!on)return;on=false;if(moved){snap(el);moved=false}else onTap&&onTap()})}
 drag(videoWin,{skip:t=>videoRuntime.contains(t)||videoVMenu.contains(t)});
 drag(videoBubble,{onTap:()=>{videoMinimized=false;refresh()}});         // tap the bubble = back to the rectangle (same stream)

 /* runtime pill -> vertical menu (opens up when there is no room below) */
 function posMenu(){const w=videoWin.getBoundingClientRect(),below=innerHeight-w.bottom,above=w.top;videoVMenu.classList.toggle('opens-up',below<250&&above>below)}
 videoRuntime.onclick=e=>{e.stopPropagation();if(videoVMenu.classList.contains('is-open')){videoVMenu.classList.remove('is-open');return}posMenu();videoVMenu.classList.add('is-open')};
 document.addEventListener('pointerdown',e=>{if(!videoVMenu.classList.contains('is-open'))return;if(videoVMenu.contains(e.target)||videoRuntime.contains(e.target))return;videoVMenu.classList.remove('is-open')});
 $('vmenuMuteBtn').onclick=e=>{e.stopPropagation();call('toggleMute');refresh()};
 $('vmenuSpeakerBtn').onclick=e=>{e.stopPropagation();call('toggleSpeaker');refresh()};
 $('vmenuMinBtn').onclick=e=>{e.stopPropagation();videoVMenu.classList.remove('is-open');videoMinimized=true;refresh()};
 let swapping=false;
 $('vmenuSwapBtn').onclick=async e=>{e.stopPropagation();if(swapping)return;swapping=true;const b=$('vmenuSwapBtn');b.style.opacity='.5';
  try{const C=getCall();if(C&&C.flipCamera)await C.flipCamera()}catch(err){}finally{swapping=false;b.style.opacity=''}};
 $('vmenuEndBtn').onclick=e=>{e.stopPropagation();videoVMenu.classList.remove('is-open');call('endWatchCall');refresh()};

 /* session: both phones register the SAME id (the cinema session id), so the engine only auto-joins an offer from this theatre */
 function register(){const C=getCall();if(!C||!C.registerWatchSession||!o.sessionId)return false;if(registered!==o.sessionId){C.registerWatchSession(o.sessionId);registered=o.sessionId}return true}
 function unregister(){const C=getCall();registered=null;videoMinimized=false;voiceCollapsed=false;try{C&&C.clearWatchSession&&C.clearWatchSession()}catch(e){}refresh()}
 function start(type){
  const C=getCall();
  if(!C||typeof C.startWatchCall!=='function'){o.toast('Call system unavailable.');return}
  if(!register()){o.toast('Calls work when the cinema is opened from Twin Hearts.');return}
  const st=C.getWatchState&&C.getWatchState();
  if(st&&st.active&&(st.callType==='video'||type==='voice')){o.toast('You are already in a call');return}   // voice -> video is the only allowed change (an upgrade of the same call)
  try{C.startWatchCall(type)}catch(e){o.toast('Could not start the call')}}
 /** my side of the call for the avatar badge: {on,muted,level,cam} or null. cam: 1 camera on, 0 camera off, -1 no video. Android supplies getMicState itself (its calls are native). */
 function mic(){try{const C=getCall();if(!C)return null;
  if(typeof C.getMicState==='function'){const s=C.getMicState();return s&&s.on?s:null}
  const st=typeof C.getWatchState==='function'?C.getWatchState():null;if(!st||!st.active)return null;
  return{on:1,muted:!!st.muted,level:typeof C.getLocalLevel==='function'?+C.getLocalLevel()||0:0,cam:st.callType==='video'?(st.camOn?1:0):-1}}catch(e){return null}}
 return{start,register,unregister,end:()=>{call('endWatchCall');refresh()},refresh,mic}}
