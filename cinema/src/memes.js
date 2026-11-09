// Meme soundboard. ONE floating button (😂) that works everywhere: the avatar studio, the lobby / canteen and inside the hall.
// It opens a sheet with every sound (name + length). Tap a sound to play it; tap it again to stop. If your partner is in the room they hear it too.
// Files live in /public/memes/<id>.mp3 . To add a sound: drop the mp3 there and add one line to CLIPS ( id, name shown, emoji, seconds ).
import {rail} from './rail.js';
const DIR=import.meta.env.BASE_URL+'memes/';
const CLIPS=[
 ['address-pettu-full',"Address pettu (full)",'📍',27.8],
 ['anthelera-best-friends-antaru',"Anthelera best friends antaru",'🤝',4.2],
 ['atluntadhi-manathoni',"Atluntadhi manathoni",'🤷',0.9],
 ['chaduvukondi-first',"Chaduvukondi First",'📚',1.6],
 ['chinna-sekalu-levu-ra',"Chinna sekalu levu ra",'🤏',5.4],
 ['chocolete-kavala',"Chocolete Kavala",'🍫',1.0],
 ['cinema-bongu-la-undhi',"Cinema bongu la undhi",'🎬',3.0],
 ['cinema-super-100-days',"Cinema super 100 days",'🏆',3.5],
 ['comedy-message-tone',"Comedy Message Tone",'🔔',4.5],
 ['common-sense-undha-meeku',"Common sense undha meeku",'🧠',4.6],
 ['edo-thedaga-undenti',"Edo Thedaga Undenti",'🤨',3.1],
 ['enjoy-pandago',"Enjoy pandago",'🎉',1.4],
 ['enti-inka-padukoledha',"Enti inka padukoledha",'😴',1.9],
 ['good-lkg-lo-padeyandi',"Good LKG lo Padeyandi",'🎒',1.6],
 ['hey-whats-up',"Hey what's up",'👋',1.6],
 ['hi-aunty',"Hi Aunty",'👩',1.4],
 ['hungry-cheetah',"Hungry cheetah",'🐆',30.0],
 ['indhuvadana-kundaradana',"Indhuvadana Kundaradana",'🎭',4.3],
 ['intlo-padukovadam-kadhu',"Intlo padukovadam kadhu",'🛏️',9.8],
 ['mana-karma-atla-undhi',"Mana karma atla undhi",'🙄',3.5],
 ['nachinana-neeku',"Nachinana neeku",'😍',3.5],
 ['nenu-entha-edavano-nake-teledu',"Nenu entha edavano nake teledu",'🥲',2.9],
 ['new-notification',"New notification",'📳',1.0],
 ['nijamga-chepthunna-andi',"Nijamga chepthunna andi",'🙏',10.1],
 ['oh-2000-ready-chesuko',"Oh 2000 ready chesuko",'💸',1.2],
 ['pilla-bacha-nayala',"Pilla bacha nayala",'😂',1.6],
 ['pokiri-upma-dialogue',"Pokiri upma dialogue",'🥘',8.4],
 ['rey-lei-pilla-bacha-nayala',"Rey lei pilla bacha nayala",'🤣',1.6],
 ['sairam-sairam',"Sairam sairam",'🛕',3.4],
 ['saripoyaru-iddaru',"Saripoyaru iddaru",'😅',4.3],
 ['sleeveless-uncle',"Sleeveless uncle",'💪',11.5],
 ['thanks-andi-chala-thanks-andi',"Thanks andi chala thanks andi",'🙌',3.2],
 ['vaadu-vinadu',"Vaadu vinadu",'🙉',3.6],
 ['yedava-bava-vadu',"Yedava bava vadu",'😒',4.8]];
const CSS=`
#mm-btn{width:46px;height:46px;border-radius:50%;padding:0;font-size:24px;line-height:1;display:grid;place-items:center;background:linear-gradient(145deg,#e8620f,#f5821f);border:2px solid #ffd2a3;box-shadow:0 4px 16px #0008,0 0 18px #f5821f66;transition:opacity .3s,transform .15s}
#mm-btn:active{transform:scale(.92)}body.pl-hide #mm-btn{opacity:0;pointer-events:none}
#mm-btn.on{animation:mmpulse 1s ease-out infinite}@keyframes mmpulse{0%{box-shadow:0 4px 16px #0008,0 0 0 0 #ffb15ccc}100%{box-shadow:0 4px 16px #0008,0 0 0 16px #ffb15c00}}
#mm{position:fixed;inset:0;z-index:15;display:none;align-items:flex-end;justify-content:center;background:#000b;touch-action:pan-y}#mm.on{display:flex}
.mm-box{width:min(720px,100%);height:min(86%,760px);display:flex;flex-direction:column;background:radial-gradient(120% 60% at 50% 0,#252b5a 0,#161a3a 55%);border:1px solid #ffb15c44;border-radius:20px 20px 0 0;box-shadow:0 -10px 40px #000a;animation:mmup .22s ease-out}
@keyframes mmup{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
@media(min-width:760px){#mm{align-items:center}.mm-box{border-radius:20px;height:min(80%,700px)}}
.mm-h{display:flex;align-items:center;gap:10px;padding:14px 14px 8px}.mm-h b{letter-spacing:3px;color:#ffb15c;font-size:15px;white-space:nowrap}
.mm-h small{flex:1;min-width:0;color:var(--mute);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-both{border-radius:999px;padding:6px 12px;font-size:12px;white-space:nowrap;background:#ffffff0d}.mm-both.on{background:linear-gradient(90deg,#e8620f,var(--accent));border-color:transparent;font-weight:700}.mm-both[hidden]{display:none}
.mm-x{padding:6px 11px}
.mm-s{padding:4px 14px 8px}.mm-s input{width:100%;background:#ffffff0d;color:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font:inherit;font-size:14px}
.mm-g{flex:1;overflow-y:auto;padding:4px 14px 12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px;align-content:start;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.mm-c{position:relative;overflow:hidden;display:flex;align-items:center;gap:10px;text-align:left;padding:10px 11px;border-radius:14px;background:linear-gradient(160deg,#ffffff14,#ffffff06);border:1px solid #ffb15c2a;min-height:62px}.mm-c:active{transform:scale(.98)}
.mm-c .e{font-size:26px;flex:none}.mm-c .t{flex:1;min-width:0;font-weight:600;font-size:13px;line-height:1.25}.mm-c .t small{display:block;margin-top:2px;font-size:11px;font-weight:400;color:var(--mute)}
.mm-c.on{border-color:#ffb15c;background:linear-gradient(160deg,#e8620f55,#f5821f22);box-shadow:0 0 14px #f5821f55}
.mm-c.on::after{content:"";position:absolute;left:0;bottom:0;height:3px;background:#ffb15c;animation:mmfill var(--d) linear forwards}@keyframes mmfill{from{width:0}to{width:100%}}
.mm-eq{display:none;gap:2px;align-items:flex-end;height:16px;flex:none}.mm-c.on .mm-eq{display:flex}.mm-eq i{width:3px;background:#ffb15c;border-radius:2px;animation:mmeq .7s ease-in-out infinite}.mm-eq i:nth-child(2){animation-delay:.2s}.mm-eq i:nth-child(3){animation-delay:.4s}@keyframes mmeq{0%,100%{height:4px}50%{height:16px}}
.mm-empty{grid-column:1/-1;text-align:center;color:var(--mute);padding:26px 0}
.mm-f{display:flex;gap:10px;align-items:center;padding:10px 14px max(14px,env(safe-area-inset-bottom));border-top:1px solid #ffffff14}.mm-f span{flex:1;color:var(--mute);font-size:12px}.mm-f button:disabled{opacity:.4}
.mm-t{position:fixed;left:50%;top:max(64px,calc(env(safe-area-inset-top) + 56px));transform:translate(-50%,-8px);z-index:16;background:#000d;border:1px solid #ffffff26;border-radius:999px;padding:8px 15px;font-size:13px;max-width:90vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s}.mm-t.on{opacity:1;transform:translate(-50%,0)}`;
const mmss=s=>{const t=Math.round(s);return Math.floor(t/60)+':'+String(t%60).padStart(2,'0')};
/** audio = the cinema's audio kit (audio.meme / memeStop / isMuted / init). send(msg) tells the partner. present() = partner is in the room. */
export function createMemes({audio,send,present}){
 const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
 document.head.appendChild(Object.assign(document.createElement('style'),{textContent:CSS}));
 const btn=el('button',0,'😂');btn.id='mm-btn';btn.setAttribute('aria-label','Meme sounds');
 const sheet=el('div');sheet.id='mm';const box=el('div','mm-box');sheet.appendChild(box);
 const head=el('div','mm-h'),both=el('button','mm-both on','💞 Both of us'),x=el('button','mm-x','✕');x.setAttribute('aria-label','Close');
 const sub=el('small',0,CLIPS.length+' sounds');head.append(el('b',0,'😂 MEME SOUNDS'),sub,both,x);
 const sw=el('div','mm-s'),q=el('input');q.placeholder='Search sounds…';q.autocomplete='off';q.setAttribute('aria-label','Search sounds');sw.appendChild(q);
 const grid=el('div','mm-g');grid.dataset.keepEmoji='';const empty=el('div','mm-empty','No sound found');empty.hidden=true;
 const foot=el('div','mm-f'),hint=el('span',0,'Tap to play · tap again to stop'),stopB=el('button',0,'⏹ Stop');foot.append(hint,stopB);
 box.append(head,sw,grid,foot);
 const toast=el('div','mm-t');rail.appendChild(btn);document.body.append(sheet,toast);
 const cards=new Map();let cur=null,isBoth=true,tt=0,warmed=false;
 const note=t=>{toast.textContent=t;toast.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>toast.classList.remove('on'),2200)};
 for(const[id,name,emo,d]of CLIPS){const c=el('button','mm-c'),t=el('span','t',name),eq=el('span','mm-eq');eq.append(el('i'),el('i'),el('i'));
  t.appendChild(el('small',0,mmss(d)));c.append(el('span','e',emo),t,eq);c.dataset.k=(name+' '+id).toLowerCase();c.style.setProperty('--d',d+'s');
  c.onclick=()=>{play(id,false);close()};grid.appendChild(c);cards.set(id,c)}
 grid.appendChild(empty);
 const clearOn=()=>{cards.forEach(c=>c.classList.remove('on'));btn.classList.remove('on')};
 function stop(){audio.memeStop();clearOn();cur=null}
 async function play(id,remote){const clip=CLIPS.find(c=>c[0]===id);if(!clip)return;audio.init();
  if(cur===id&&!remote){stop();return}                                   // tap the playing sound again = stop
  if(!remote&&isBoth)send({t:'meme',id});                                 // your partner plays it at the same moment (sent even if your own sound is off)
  if(audio.isMuted()){note('🔕 Sound is off — tap the 🔔 bell to turn it on');return}
  clearOn();cur=id;const c=cards.get(id);void c.offsetWidth;c.classList.add('on');btn.classList.add('on');          // (offsetWidth: restarts the progress line)
  if(!remote)note('▶ '+clip[1]);
  const h=await audio.meme(DIR+id+'.mp3',()=>{if(cur===id){clearOn();cur=null}});
  if(!h&&cur===id){clearOn();cur=null;note('Could not load that sound')}
  else if(remote&&audio.state()==='suspended')note('🔇 Tap the screen once to hear your partner’s sounds')}
 const hintText=()=>!isBoth?'Plays only for you':present()?'Plays for both of you ♥':'Plays for you · and your partner when they are here';
 function warm(){if(warmed)return;warmed=true;audio.memePrefetch(CLIPS.map(c=>DIR+c[0]+'.mp3'))}      // quietly download them all once, so every tap (and every sound from your partner) is instant
 function open(){audio.init();sheet.classList.add('on');both.classList.toggle('on',isBoth);hint.textContent=hintText();warm();
  setTimeout(()=>{if(matchMedia('(pointer:fine)').matches)q.focus()},60)}
 const wt=setInterval(()=>{if(warmed)clearInterval(wt);else if(present())warm()},2000);     // as soon as your partner is in the room
 const close=()=>{sheet.classList.remove('on');q.blur()};
 btn.onclick=()=>sheet.classList.contains('on')?close():open();x.onclick=close;sheet.addEventListener('pointerdown',e=>{if(e.target===sheet)close()});stopB.onclick=stop;
 both.onclick=()=>{isBoth=!isBoth;both.classList.toggle('on',isBoth);hint.textContent=hintText()};
 q.oninput=()=>{const v=q.value.trim().toLowerCase();let n=0;cards.forEach(c=>{const ok=!v||c.dataset.k.includes(v);c.hidden=!ok;if(ok)n++});empty.hidden=n>0};
 addEventListener('keydown',e=>{if(e.key==='Escape'&&sheet.classList.contains('on'))close()});
 return{open,close,stop,
  /** a sound your partner played */
  remote(id,p){const clip=CLIPS.find(c=>c[0]===id);if(!clip)return;note((p===1?'💗':'💙')+' Partner played: '+clip[1]);play(id,true)}}}
