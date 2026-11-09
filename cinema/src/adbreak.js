// Ad breaks while watching together. The host's movie clock decides when a break starts; both phones pause the movie,
// play the ads, and the movie resumes for both when both are finished (or your partner left / took too long).
// Order: your own Twin Hearts video  ->  Google ad (only when AD.google.enabled)  ->  movie continues.
import {AD} from './ads-config.js';
import {ic,Megaphone,SkipForward,Hourglass} from './icons.js';
const IMA_URL='https://imasdk.googleapis.com/js/sdkloader/ima3.js';
const mmss=s=>{s=Math.max(0,Math.ceil(s));return`${s/60|0}:${String(s%60).padStart(2,'0')}`};
const CSS=`#adbreak{position:fixed;inset:0;z-index:60;background:#000;display:none;align-items:center;justify-content:center;font-family:var(--sans,system-ui)}
#adbreak.on{display:flex}#adbreak video{width:100%;height:100%;object-fit:contain;background:#000}
#adbreak .ad-tag,#adbreak .ad-time{position:absolute;top:max(14px,env(safe-area-inset-top));display:flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;font-size:13px;font-weight:600;color:#fff;background:rgba(43,6,29,.82);border:1px solid rgba(194,26,139,.4);backdrop-filter:blur(8px)}
#adbreak .ad-tag{left:max(14px,env(safe-area-inset-left))}#adbreak .ad-time{right:max(14px,env(safe-area-inset-right))}
#adbreak .ad-skip{position:absolute;right:max(14px,env(safe-area-inset-right));bottom:max(28px,env(safe-area-inset-bottom));display:none;align-items:center;gap:7px;padding:11px 20px;border-radius:999px;border:0;font:inherit;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,#C21A8B,#B0127A 55%,#7C0A57);box-shadow:0 6px 18px rgba(176,18,122,.45)}
#adbreak .ad-skip.on{display:inline-flex}
#adbreak .ad-bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.15)}#adbreak .ad-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#C21A8B,#B0127A)}
#adbreak .ad-wait{position:absolute;left:50%;bottom:max(40px,env(safe-area-inset-bottom));transform:translateX(-50%);display:none;align-items:center;gap:8px;padding:10px 18px;border-radius:999px;font-size:14px;color:#fff;background:rgba(43,6,29,.9);border:1px solid rgba(194,26,139,.4)}
#adbreak .ad-wait.on{display:inline-flex}#adbreak .ima{position:absolute;inset:0;display:none}#adbreak .ima.on{display:block}`;
const loadScript=src=>new Promise((res,rej)=>{if(document.querySelector(`script[src="${src}"]`)&&window.google?.ima)return res();const s=document.createElement('script');s.src=src;s.async=true;s.onload=res;s.onerror=rej;document.head.appendChild(s)});

/** movie = the Movie object · send(msg) tells the partner · present() = partner is in the room · leader() = this phone starts the breaks */
export function createAdBreak({movie,send,present,leader,onBegin,onResume}){
 let active=false,next=AD.firstAfterMin*60,pre=null,localDone=false,partnerDone=false,wasPlaying=false,waitT=0,pollT=0,root=null,ui={};
 document.head.appendChild(Object.assign(document.createElement('style'),{textContent:CSS}));
 const swallowKeys=e=>{e.stopImmediatePropagation();e.preventDefault()};

 function ownVideo(){const v=document.createElement('video');Object.assign(v,{src:AD.own.src,playsInline:true,preload:'auto'});v.setAttribute('playsinline','');return v}
 function build(){root=document.createElement('div');root.id='adbreak';
  root.innerHTML=`<div class="ad-tag"></div><div class="ad-time"></div><button class="ad-skip"></button><div class="ad-bar"><i></i></div><div class="ad-wait"></div><div class="ima"></div>`;
  ui={tag:root.querySelector('.ad-tag'),time:root.querySelector('.ad-time'),skip:root.querySelector('.ad-skip'),bar:root.querySelector('.ad-bar i'),wait:root.querySelector('.ad-wait'),ima:root.querySelector('.ima')};
  ui.skip.append(ic(SkipForward,18),'Skip ad');document.body.appendChild(root);root.classList.add('on')}
 const tag=t=>{ui.tag.textContent='';ui.tag.append(ic(Megaphone,15),t)};

 /* ---- 1) your own video ---- */
 function playOwn(){return new Promise(res=>{
  if(!AD.own.enabled||!AD.own.src)return res();
  const v=pre||ownVideo();pre=null;root.prepend(v);tag('Ad · '+AD.own.label);let t0=0,fin=false;
  const end=()=>{if(fin)return;fin=true;v.pause();v.remove();res()};
  v.onended=end;v.onerror=end;
  v.ontimeupdate=()=>{const d=v.duration||0;if(!d)return;ui.time.textContent=mmss(d-v.currentTime);ui.bar.style.width=(v.currentTime/d*100)+'%';
   if(AD.own.skipAfterSec>0&&v.currentTime>=AD.own.skipAfterSec)ui.skip.classList.add('on')};
  ui.skip.onclick=end;
  v.play().catch(()=>{v.muted=true;v.play().catch(end)});
  setTimeout(()=>{if(!fin&&v.readyState<2&&v.currentTime===0)end()},15000)})}      // never loaded -> carry on

 /* ---- 2) Google ad (IMA SDK). Off until AD.google.enabled + adTagUrl ---- */
 function playGoogle(){const G=AD.google;
  if(!G.enabled||!G.adTagUrl)return Promise.resolve();
  ui.skip.classList.remove('on');ui.time.textContent='';ui.bar.style.width='0';tag('Ad');
  return new Promise(res=>{let done=false,mgr=null,loader=null,to=0;
   const end=()=>{if(done)return;done=true;clearTimeout(to);try{mgr?.destroy()}catch(e){}try{loader?.destroy()}catch(e){}ui.ima.classList.remove('on');ui.ima.textContent='';res()};
   to=setTimeout(end,G.loadTimeoutSec*1000);                                   // no-fill / blocked / slow -> straight back to the movie
   loadScript(IMA_URL).then(()=>{
    const g=google.ima,vid=document.createElement('video');vid.setAttribute('playsinline','');vid.style.cssText='width:100%;height:100%';
    ui.ima.textContent='';ui.ima.append(vid);ui.ima.classList.add('on');
    const slot=document.createElement('div');slot.style.cssText='position:absolute;inset:0';ui.ima.append(slot);
    const dc=new g.AdDisplayContainer(slot,vid);dc.initialize();
    loader=new g.AdsLoader(dc);
    loader.addEventListener(g.AdErrorEvent.Type.AD_ERROR,end);
    loader.addEventListener(g.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,e=>{
     mgr=e.getAdsManager(vid);
     mgr.addEventListener(g.AdErrorEvent.Type.AD_ERROR,end);
     mgr.addEventListener(g.AdEvent.Type.STARTED,()=>{clearTimeout(to);to=setTimeout(end,5*60*1000)});     // started: allow the full ad
     for(const k of ['ALL_ADS_COMPLETED','SKIPPED','CONTENT_RESUME_REQUESTED'])mgr.addEventListener(g.AdEvent.Type[k],end);
     try{mgr.init(root.clientWidth,root.clientHeight,g.ViewMode.NORMAL);mgr.start()}catch(err){end()}});
    const rq=new g.AdsRequest();rq.adTagUrl=G.adTagUrl;rq.linearAdSlotWidth=root.clientWidth;rq.linearAdSlotHeight=root.clientHeight;
    rq.setAdWillAutoPlay(true);rq.setAdWillPlayMuted(false);loader.requestAds(rq)
   }).catch(end)})}

 /* ---- the break ---- */
 async function begin(){if(active)return;active=true;localDone=false;partnerDone=!present();wasPlaying=movie.playing;movie.pause();onBegin?.();
  addEventListener('keydown',swallowKeys,true);build();
  try{await playOwn();await playGoogle()}catch(e){console.warn('ad break',e)}
  finishLocal()}
 function finishLocal(){localDone=true;send({t:'adend'});ui.skip?.classList.remove('on');ui.tag.textContent='';ui.time.textContent='';
  if(!partnerDone&&present()){ui.wait.textContent='';ui.wait.append(ic(Hourglass,16),'Waiting for your partner’s ad to finish…');ui.wait.classList.add('on');
   waitT=setTimeout(resume,AD.waitForPartnerSec*1000);pollT=setInterval(()=>{if(!present())resume()},500)}
  else resume()}
 function resume(){if(!active)return;clearTimeout(waitT);clearInterval(pollT);removeEventListener('keydown',swallowKeys,true);root?.remove();root=null;active=false;
  const every=AD.everyMin*60;next=every>0?(Math.floor(movie.time/every)+1)*every:Infinity;
  if(wasPlaying)movie.play();onResume?.()}

 return{
  get active(){return active},
  /** call every frame; watching = the story is in the WATCH state */
  tick(watching){if(!AD.enabled||active||!watching||!movie.src)return;const t=movie.time,d=movie.dur;
   if(!d||d-t<AD.skipLastMin*60||t>d)return;
   if(!pre&&AD.own.enabled&&AD.own.src&&t>=next-120&&t<next){pre=ownVideo();pre.load()}       // quietly download your video 2 minutes before
   if(t>=next&&movie.playing&&leader()){send({t:'ad'});begin()}},
  /** the host started a break */
  remote(){if(AD.enabled)begin()},
  /** your partner's ads finished */
  partnerEnd(){partnerDone=true;if(active&&localDone)resume()},
 }}
