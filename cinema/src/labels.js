/* ------------------------------------------------------------------
   Tiny name under every icon-only button in the theatre (lobby, hall, player, full screen).
   Works for buttons built later too: a MutationObserver keeps the names in step (e.g. Sound on / off, Play / Pause).
   The name comes from the button's own tooltip / aria-label, so there is nothing to keep in sync by hand.
------------------------------------------------------------------- */
const BY_ID={cb:'Chat',snd:'Alerts',leave:'Leave',volbtn:'Volume',bagbtn:'Snacks','mm-btn':'Memes',fp:'Play',fm:'Sound',fchat:'Chat',fview:'Views',fx:'Exit','vw-fs':'Full'};
const RULES=[
 [/find.*partner/,'Partner'],[/waiting for (your )?partner to sit/,'Waiting'],[/sit here/,'Sit'],[/go to the hall/,'Hall'],[/stand up/,'Stand'],
 [/^back 10/,'Back'],[/^forward 10/,'Forward'],[/^pause/,'Pause'],[/^play/,'Play'],[/exit full/,'Exit'],[/full screen|choose a view/,'Full'],
 [/camera/,'Camera'],[/sound controls|sound: songs/,'Volume'],[/^sound|mute/,'Sound'],[/popcorn/,'Popcorn'],[/send love/,'Love'],[/^wave/,'Wave'],[/^clap/,'Clap'],
 [/chat/,'Chat'],[/alert/,'Alerts'],[/leave/,'Leave'],[/snack/,'Snacks'],[/meme/,'Memes'],[/^start movie/,'Start'],[/movie|“|partner/,'Movie']];
const SEL='#bar button,#rail>button,#top-r button,#fc button,#vw-fs,#player .ib,#player .big,#player .skip';
function nameOf(b){
 if(BY_ID[b.id])return BY_ID[b.id];
 const raw=(b.dataset.tip||b.getAttribute('aria-label')||b.getAttribute('title')||'').split(' · ')[0].trim();if(!raw)return'';
 const t=raw.toLowerCase(),r=RULES.find(([re])=>re.test(t));
 return r?r[1]:raw.split(/\s+/)[0].slice(0,8)}
function apply(){
 for(const b of document.querySelectorAll(SEL)){
  const n=nameOf(b);let l=b.querySelector(':scope>.bl');
  if(!n){l?.remove();continue}
  if(!l){l=document.createElement('span');l.className='bl';l.setAttribute('aria-hidden','true');b.appendChild(l);
   if(getComputedStyle(b).position==='static')b.style.position='relative'}
  if(l.textContent!==n)l.textContent=n}}
export function mountLabels(){
 let raf=0;const go=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;mo.disconnect();apply();mo.observe(document.body,OPT)})};
 const OPT={childList:true,subtree:true,attributes:true,attributeFilter:['data-tip','aria-label','title']};
 const mo=new MutationObserver(go);mo.observe(document.body,OPT);apply()}
