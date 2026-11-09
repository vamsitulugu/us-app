// Tiny synthesized sound kit (no audio files): room tone, door, chat blip, crunch, chime. Call audio.init() from a user gesture.
let ctx,master,amb,murG,musicGain,crowdGain,songEl=null,songsOn=false,crowdOn=false,stepFlip=0,fxBus,songBus,ambBus,vol=loadVol(),stepBufs=[],stepIx=0,mixT={songs:0,crowd:0},memeGain,memeId=0,memeCur=null,memeBuf=new Map(),duck=1,muted=false,mixS=2,bgmScale=1,list=[],order=[],oi=0;

/* ---- user volume (the 🎚 button): master, songs, crowd + room ambience, effects (steps, doors, popcorn, memes). Saved on this device. ---- */
function loadVol(){const d={master:1,songs:1,amb:1,fx:1};try{const j=JSON.parse(localStorage.getItem('cin_vol')||'{}');for(const k in d)if(typeof j[k]==='number')d[k]=Math.max(0,Math.min(1,j[k]))}catch{}return d}
function applyVol(){if(!ctx)return;const t=ctx.currentTime;master.gain.setTargetAtTime(muted?0:.6*vol.master,t,.03);songBus.gain.setTargetAtTime(vol.songs,t,.03);ambBus.gain.setTargetAtTime(vol.amb,t,.03);fxBus.gain.setTargetAtTime(vol.fx,t,.03)}
const env=(g,t,a,d)=>{g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(a,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+d)};
function tone(f,d,type='sine',a=.2,t0=0,to){if(!ctx)return;const t=ctx.currentTime+t0,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(to)o.frequency.exponentialRampToValueAtTime(to,t+d);env(g,t,a,d);o.connect(g).connect(fxBus);o.start(t);o.stop(t+d+.05)}
function burst(d,a=.3,f=3000,t0=0){if(!ctx)return;const t=ctx.currentTime+t0,n=ctx.createBufferSource(),b=ctx.createBuffer(1,ctx.sampleRate*d,ctx.sampleRate),x=b.getChannelData(0);for(let i=0;i<x.length;i++)x[i]=Math.random()*2-1;n.buffer=b;
 const fl=ctx.createBiquadFilter();fl.type='bandpass';fl.frequency.value=f;const g=ctx.createGain();env(g,t,a,d);n.connect(fl).connect(g).connect(fxBus);n.start(t)}

/* ---- footsteps: synthesized, two surfaces. vol 0..1 (use distance for your partner), surface 'floor' (lobby) | 'carpet' (hall) ---- */
function stepSynth(surface='carpet',vol=1){if(!ctx||vol<=.01)return;const t=ctx.currentTime,fl=surface==='floor',side=(stepFlip^=1)?1:.93,j=.9+Math.random()*.2;
 const g=ctx.createGain();g.gain.value=vol*(fl?.5:.32);g.connect(fxBus);
 // thump: a very short low tone (the heel)
 const o=ctx.createOscillator(),og=ctx.createGain();o.type='sine';o.frequency.setValueAtTime((fl?150:110)*side*j,t);o.frequency.exponentialRampToValueAtTime(48,t+.09);
 og.gain.setValueAtTime(0,t);og.gain.linearRampToValueAtTime(.9,t+.006);og.gain.exponentialRampToValueAtTime(.0001,t+.11);o.connect(og).connect(g);o.start(t);o.stop(t+.14);
 // scuff / click: filtered noise (hard floor = brighter click, carpet = soft muffled brush)
 const n=ctx.createBufferSource(),b=ctx.createBuffer(1,ctx.sampleRate*.12,ctx.sampleRate),x=b.getChannelData(0);for(let i=0;i<x.length;i++)x[i]=Math.random()*2-1;n.buffer=b;
 const f=ctx.createBiquadFilter();f.type=fl?'bandpass':'lowpass';f.frequency.value=(fl?2200:700)*j;f.Q.value=fl?1.2:.5;
 const ng=ctx.createGain();ng.gain.setValueAtTime(0,t);ng.gain.linearRampToValueAtTime(fl?.55:.35,t+.004);ng.gain.exponentialRampToValueAtTime(.0001,t+(fl?.05:.1));n.connect(f).connect(ng).connect(g);n.start(t)}

/* ---- REAL footsteps: your own recording (public/audio/footsteps.mp3 | .wav | .ogg | .m4a) ----
   The file can be ONE step or a clip of several steps walking. It is cut into single footfalls (at each loud onset) and
   one footfall is played, in recorded order, at the exact moment a foot lands (Player.update fires onStep on every
   half-cycle of the gait). If the file is missing or cannot be decoded, the synthesized steps above are used instead. */
const STEP_FILES=[import.meta.env.BASE_URL+'audio/footsteps.mp3',import.meta.env.BASE_URL+'audio/footsteps.wav',import.meta.env.BASE_URL+'audio/footsteps.ogg',import.meta.env.BASE_URL+'audio/footsteps.m4a',import.meta.env.BASE_URL+'audio/footstep.mp3',import.meta.env.BASE_URL+'audio/footstep.wav'];
const STEP_MAX=.55,STEP_GAP=.2;   // longest piece kept per step (s) / shortest allowed gap between two onsets (s)
function sliceSteps(buf){
 const sr=buf.sampleRate,ch=buf.numberOfChannels,N=buf.length,w=Math.max(8,sr*.004|0),n=Math.floor(N/w),e=new Float32Array(n),d=buf.getChannelData(0);
 for(let i=0;i<n;i++){let a=0;for(let k=i*w;k<(i+1)*w;k++)a+=d[k]*d[k];e[i]=Math.sqrt(a/w)}
 const sm=new Float32Array(n);for(let i=0;i<n;i++){let a=0,c=0;for(let k=Math.max(0,i-1);k<=Math.min(n-1,i+1);k++){a+=e[k];c++}sm[i]=a/c}
 let mx=0;for(let i=0;i<n;i++)if(sm[i]>mx)mx=sm[i];
 const th=mx*.32,on=[];let last=-9;
 for(let i=1;i<n;i++){if(sm[i]>th&&sm[i-1]<=th){const t=i*w/sr;if(t-last>=STEP_GAP){on.push(t);last=t}}}
 if(!on.length)on.push(0);
 const out=[];
 on.forEach((t0,i)=>{const s0=Math.max(0,Math.floor((t0-.015)*sr)),nx=i+1<on.length?Math.floor((on[i+1]-.02)*sr):N,s1=Math.min(N,nx,s0+Math.floor(STEP_MAX*sr));if(s1-s0<sr*.03)return;
  const b=ctx.createBuffer(ch,s1-s0,sr);let pk=0;
  for(let c=0;c<ch;c++){const src=buf.getChannelData(c),dst=b.getChannelData(c);for(let k=0;k<dst.length;k++){dst[k]=src[s0+k];const a=Math.abs(dst[k]);if(a>pk)pk=a}}
  const g=pk>.0001?.9/pk:1,fi=Math.min(b.length,Math.floor(sr*.004)),fo=Math.min(b.length>>1,Math.floor(sr*.06));   // normalise + tiny fade in/out so a cut never clicks
  for(let c=0;c<ch;c++){const dst=b.getChannelData(c);for(let k=0;k<dst.length;k++){let m=g;if(k<fi)m*=k/fi;const r=dst.length-k;if(r<fo)m*=r/fo;dst[k]*=m}}
  out.push(b)});
 return out}
async function loadSteps(){
 for(const u of STEP_FILES){try{const r=await fetch(u);if(!r.ok)continue;const ct=r.headers.get('content-type')||'';if(/text\/html/i.test(ct))continue;   // dev servers answer a missing file with index.html
   const buf=await ctx.decodeAudioData(await r.arrayBuffer()),parts=sliceSteps(buf);if(parts.length){stepBufs=parts;console.info('[footsteps] '+u+' -> '+parts.length+' step(s)');return}}catch(e){}}
 console.info('[footsteps] no recording found in /public/audio, using synthesized steps')}
function stepSample(surface,vol){
 const t=ctx.currentTime,b=stepBufs[stepIx++%stepBufs.length],src=ctx.createBufferSource(),g=ctx.createGain();src.buffer=b;
 src.playbackRate.value=stepBufs.length>1?1:(stepIx&1?.97:1.03);   // one-step file: alternate pitch a little so left and right differ
 g.gain.value=Math.min(1,vol)*(surface==='floor'?1:.9);src.connect(g).connect(fxBus);src.start(t)}
function step(surface='carpet',vol=1){if(!ctx||vol<=.01)return;stepBufs.length?stepSample(surface,vol):stepSynth(surface,vol)}
/* playlist: shuffled on every page load (never starts with the song that played last time), then plays on to the next song by itself, reshuffling after the last one */
function shuffle(n){const a=[...Array(n).keys()];for(let i=n-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a}
function startSongs(urls){if(!ctx||songsOn||!urls?.length)return;songsOn=true;list=urls;order=shuffle(list.length);
 let last=-1;try{last=+localStorage.getItem('cin_last')}catch{}
 if(order.length>1&&order[0]===last){const k=1+(Math.random()*(order.length-1)|0);[order[0],order[k]]=[order[k],order[0]]}   // refresh / re-entry -> a different first song
 oi=0;const el=songEl=new Audio();el.preload='auto';el.crossOrigin='anonymous';
 try{ctx.createMediaElementSource(el).connect(musicGain)}catch(e){}
 const play=()=>{const i=order[oi];try{localStorage.setItem('cin_last',i)}catch{}el.src=list[i];el.play().catch(()=>{})};
 el.addEventListener('ended',()=>{oi++;if(oi>=order.length){const lastI=order[order.length-1];order=shuffle(list.length);if(order.length>1&&order[0]===lastI)order.push(order.shift());oi=0}play()});
 el.addEventListener('error',()=>{if(++errs>list.length){songsOn=false;return}oi=(oi+1)%order.length;play()});let errs=0;
 play()}
/* hall crowd: one seamless loop (decoded to memory so it repeats with no gap) */
async function startCrowd(url){if(!ctx||crowdOn||!url)return;crowdOn=true;try{const buf=await ctx.decodeAudioData(await(await fetch(url)).arrayBuffer()),n=ctx.createBufferSource();n.buffer=buf;n.loop=true;n.connect(crowdGain);n.start()}catch(e){crowdOn=false;console.warn('crowd audio',e)}}
function applyMix(fast){if(!ctx)return;const t=ctx.currentTime,k=fast?.06:Math.max(.05,mixS/3);musicGain.gain.setTargetAtTime(mixT.songs*bgmScale*duck,t,k);crowdGain.gain.setTargetAtTime(mixT.crowd*bgmScale*duck,t,k)}
/* ---- meme sounds: one at a time, the songs / crowd dip while one plays. Clips are downloaded + decoded on first use, then kept. ---- */
const memeRaw=new Map();
function memeBytes(url){let p=memeRaw.get(url);if(!p){p=fetch(url).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.arrayBuffer()});p.catch(()=>memeRaw.delete(url));memeRaw.set(url,p)}return p}   // downloaded once, kept in memory
function memeLoad(url){let p=memeBuf.get(url);if(!p){p=memeBytes(url).then(b=>ctx.decodeAudioData(b.slice(0)));p.catch(()=>memeBuf.delete(url));memeBuf.set(url,p)}return p}
async function memePrefetch(urls){for(const u of urls){try{await memeBytes(u)}catch{}}}      // download only (works before audio.init), so a sound from your partner starts instantly
function memeStop(){memeId++;const h=memeCur;memeCur=null;duck=1;applyMix(true);if(h)try{h.stop()}catch{}}
async function memePlay(url,onend){if(!ctx)return null;memeStop();const my=memeId;let buf;
 try{buf=await memeLoad(url)}catch(e){console.warn('meme sound',e);return null}
 if(my!==memeId)return null;                                          // another sound was chosen while this one was loading
 ctx.resume();const n=ctx.createBufferSource();n.buffer=buf;n.connect(memeGain);const h={stop:()=>n.stop()};memeCur=h;duck=.3;applyMix(true);
 n.onended=()=>{if(memeCur===h){memeCur=null;duck=1;applyMix(true)}onend?.()};n.start();return h}
export const audio={
 init(){if(ctx){ctx.resume();return}ctx=new(window.AudioContext||window.webkitAudioContext)();master=ctx.createGain();master.gain.value=muted?0:.6*vol.master;master.connect(ctx.destination);fxBus=ctx.createGain();fxBus.gain.value=vol.fx;fxBus.connect(master);songBus=ctx.createGain();songBus.gain.value=vol.songs;songBus.connect(master);ambBus=ctx.createGain();ambBus.gain.value=vol.amb;ambBus.connect(master);musicGain=ctx.createGain();musicGain.gain.value=0;musicGain.connect(songBus);crowdGain=ctx.createGain();crowdGain.gain.value=0;crowdGain.connect(ambBus);memeGain=ctx.createGain();memeGain.gain.value=.8;memeGain.connect(fxBus);applyMix();loadSteps();
  const b=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  const n=ctx.createBufferSource();n.buffer=b;n.loop=true;const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=180;amb=ctx.createGain();amb.gain.value=0;n.connect(f).connect(amb).connect(ambBus);n.start()},
 step,
 /** songs: array of urls (the lobby playlist). Call after audio.init(), from a tap. Safe to call again. */
 music(urls){startSongs(urls);songEl?.paused&&songEl.src&&songEl.play().catch(()=>{})},
 /** the hall crowd loop (one url) */
 crowd(url){startCrowd(url)},
 /** loudness of each layer, 0..1: audio.mix({songs:.5,crowd:0},2) eased over 2 s */
 mix(m,secs=1.5){mixT={...mixT,...m};mixS=secs;applyMix()},
 /** music + crowd on/off (the master 🔔 button mutes everything including these) */
 musicToggle(){bgmScale=bgmScale?0:1;applyMix();return !!bgmScale},
 next(){songEl&&songEl.dispatchEvent(new Event('ended'))},
 ambient(v){amb&&amb.gain.setTargetAtTime(v,ctx.currentTime,.8)},
 mute(m){muted=!!m;if(master)master.gain.value=m?0:.6*vol.master},
 /** user volume 0..1 per layer: audio.volume('songs',.4) ; audio.volumes() -> {master,songs,amb,fx} */
 volume(k,v){if(!(k in vol))return;vol[k]=Math.max(0,Math.min(1,+v||0));try{localStorage.setItem('cin_vol',JSON.stringify(vol))}catch{}applyVol()},volumes:()=>({...vol}),isMuted:()=>muted,
 meme:memePlay,memeStop,memePrefetch,state:()=>ctx?ctx.state:'none',
 door(){tone(110,.9,'sawtooth',.08,0,55);burst(.5,.12,400,.1)},
 /** push door: the shove + a short hinge creak, and the soft knock when the closer latches it */
 doorPush(){burst(.09,.22,350);tone(92,.55,'sawtooth',.035,.02,58);tone(138,.4,'sawtooth',.02,.05,90);burst(.14,.07,1800,.12)},
 doorShut(){tone(75,.16,'sine',.3,0,42);burst(.05,.25,700);burst(.03,.18,3200,.06)},
 chat(){tone(880,.12,'sine',.12);tone(1320,.14,'sine',.08,.07)},
 crunch(){for(let i=0;i<4;i++)burst(.07,.25,2500+Math.random()*2000,i*.11)},
 chime(){tone(523,1.2,'sine',.15);tone(659,1.2,'sine',.12,.18);tone(784,1.6,'sine',.12,.36)},
 heart(){tone(660,.2,'triangle',.1,0,990)},
 /** lobby life: a popcorn pop, the till bell, and the murmur of a busy foyer (murmur(0) switches it off) */
 pop(){burst(.05,.05,1800+Math.random()*1800)},
 ching(){tone(2093,.6,'sine',.07);tone(2637,.5,'sine',.05,.07)},
 murmur(v){if(!ctx)return;if(!murG){const b=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate),d=b.getChannelData(0);let y=0;for(let i=0;i<d.length;i++){y=y*.92+(Math.random()*2-1)*.08;d[i]=y*3}
   const n=ctx.createBufferSource();n.buffer=b;n.loop=true;const f=ctx.createBiquadFilter();f.type='bandpass';f.frequency.value=520;f.Q.value=.5;
   const lfo=ctx.createOscillator(),lg=ctx.createGain();lfo.frequency.value=.23;lg.gain.value=.012;murG=ctx.createGain();murG.gain.value=0;lfo.connect(lg).connect(murG.gain);lfo.start();n.connect(f).connect(murG).connect(ambBus);n.start()}
  murG.gain.setTargetAtTime(v,ctx.currentTime,.7)},
 add(){tone(740,.08,'sine',.1);tone(990,.1,'sine',.08,.06)},
 bell(){tone(1568,.9,'sine',.12);tone(2093,.7,'sine',.06,.01)},
 gift(){tone(523,.25,'triangle',.12);tone(784,.25,'triangle',.1,.12);tone(1046,.5,'triangle',.1,.24)},
 sip(){burst(.35,.08,900);tone(300,.25,'sine',.04,.05,180)},
 bite(){burst(.09,.2,1800);burst(.08,.16,2600,.12)}};
