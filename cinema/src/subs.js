// Movie subtitles for the theatre. Either of you loads an .srt or .vtt file; it is shared with your partner automatically
// (the raw text travels over the movie channel in small pieces), and each of you turns it on / off for yourself with the Subs button.
// Shown as a caption low on the screen, in the same place the in-movie chat appears. Pure parsing lives in parseSubs() (unit tested).
const clean=t=>t.replace(/\{\\[^}]*\}/g,'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const TS=/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/;
export function secs(x){const m=TS.exec(String(x).trim());if(!m)return NaN;return(+(m[1]||0))*3600+(+m[2])*60+(+m[3])+(m[4]?+m[4].padEnd(3,'0')/1000:0)}
/** .srt / .vtt text -> [{s,e,t}] sorted by start. Unknown lines (WEBVTT header, NOTE / STYLE blocks, cue numbers, cue settings) are skipped. */
export function parseSubs(text){
 const out=[];const blocks=String(text||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split(/\n{2,}/);
 for(const b of blocks){const lines=b.split('\n');const i=lines.findIndex(l=>l.includes('-->'));if(i<0)continue;
  const[a,rest]=lines[i].split('-->');const s=secs(a),e=secs((rest||'').trim().split(/\s+/)[0]);if(!(s>=0)||!(e>=s))continue;
  const t=clean(lines.slice(i+1).join('\n'));if(t)out.push({s,e,t})}
 return out.sort((x,y)=>x.s-y.s)}
/** the cue to show at time t (seconds), or null. cues are sorted by start; overlapping cues show the latest one that started. */
export function cueAt(cues,t){let lo=0,hi=cues.length-1,k=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(cues[mid].s<=t){k=mid;lo=mid+1}else hi=mid-1}
 for(let i=k;i>=0&&i>k-6;i--)if(t<=cues[i].e)return cues[i];return null}
const PIECE=30000;
/** o = {movie (Watch engine), toast(text)}. Returns {button(), pick(), shift(d), vis(bool), tick(time), state()}. */
export function createSubs({movie,toast}){
 const el=document.createElement('div');el.id='subs';document.body.appendChild(el);
 const inp=document.createElement('input');inp.type='file';inp.accept='.srt,.vtt,.txt,text/vtt,application/x-subrip,text/plain';inp.style.display='none';document.body.appendChild(inp);
 let cues=[],raw='',name='',on=true,shown=true,delay=0,lastText='',asm=null,sharedAt=0;
 const onChange=new Set();const note=()=>onChange.forEach(f=>f());
 function render(t){const c=on&&shown&&cues.length?cueAt(cues,t-delay):null,x=c?c.t:'';if(x!==lastText){lastText=x;el.textContent=x;el.classList.toggle('on',!!x)}}
 function load(text,nm,mine){const c=parseSubs(text);if(!c.length){toast?.('That file has no subtitles I can read (use .srt or .vtt)');return false}
  cues=c;raw=text;name=nm||'subtitles';on=true;delay=0;lastText='';render(movie.time);note();
  toast?.(mine?`Subtitles loaded: ${name} (${c.length} lines)`:`Your partner shared subtitles: ${name}`);return true}
 function share(){if(!raw||Date.now()-sharedAt<3000)return;sharedAt=Date.now();const id=Date.now(),n=Math.ceil(raw.length/PIECE);
  for(let i=0;i<n;i++)setTimeout(()=>movie._tx({k:'sub',id,i,n,name,d:raw.slice(i*PIECE,(i+1)*PIECE)}),i*70)}
 movie.onsub=m=>{if(!m||typeof m.d!=='string')return;                                   // a partner's file arrives in pieces
  if(!asm||asm.id!==m.id)asm={id:m.id,n:m.n,got:new Map(),name:m.name};asm.got.set(m.i,m.d);
  if(asm.got.size===asm.n){let t='';for(let i=0;i<asm.n;i++)t+=asm.got.get(i)||'';const nm=asm.name;asm=null;if(t!==raw)load(t,nm,false)}};
 movie.onwant=()=>{if(raw)share()};                                                    // a partner who joins / reloads gets the subtitles too
 inp.onchange=async()=>{const f=inp.files[0];inp.value='';if(!f)return;
  if(f.size>3e6){toast?.('That subtitle file is too big');return}
  let t='';try{t=await f.text()}catch(e){toast?.('Could not read that file');return}
  if(load(t,f.name.replace(/\.[^.]+$/,''),true))share()};
 return{pick:()=>inp.click(),
  /** the Subs button: nothing loaded -> choose a file; loaded -> turn them on / off (for me only) */
  button(){if(!cues.length){inp.click();return}on=!on;lastText='';render(movie.time);note();toast?.(on?'Subtitles on':'Subtitles off')},
  shift(d){if(!cues.length){toast?.('Load a subtitle file first');return}delay=Math.round((delay+d)*10)/10;lastText='';render(movie.time);toast?.(`Subtitles ${delay>=0?'+':''}${delay.toFixed(1)} s`)},
  remove(){cues=[];raw='';name='';lastText='';el.textContent='';el.classList.remove('on');note()},
  vis(x){shown=!!x;if(!shown){lastText='';el.textContent='';el.classList.remove('on')}},
  tick:t=>render(t),state:()=>({loaded:cues.length>0,on,name,delay}),onChange:f=>onChange.add(f)}}
