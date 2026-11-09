// The cinema's own movie picker (inside the theatre, for both partners):
//   🎞 Choose movie   - a file on this device (your partner picks the same file; lengths must match)
//   ☁️ Cloud movies   - the couple's Cloudflare R2 library (both phones stream the same movie)
// Shows what is chosen and whether you / your partner have it loaded. The Start button of the theatre stays locked until both do (gate()).
import {fmt} from './watch.js';
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
const size=b=>!b?'':b>=1e9?(b/1e9).toFixed(1)+' GB':Math.round(b/1e6)+' MB';
/** movie = the Watch engine · fetchList() -> {movies:[{id,title,durationSec,sizeBytes}]} | {err} · present() = partner is in the room · ask(text) -> boolean (confirm) */
export function createMoviePick({movie,fetchList,present,ask}){
 const root=el('div');root.id='mp';root.style.display='none';
 const head=el('div','mp-h'),chips=el('div','mp-c'),row=el('div','mp-r'),note=el('div','mp-n');root.append(head,chips,row,note);
 const lab=el('label','mp-b'),inp=el('input');inp.type='file';inp.accept='video/*,.mkv,.mp4,.m4v,.mov,.webm';lab.append(el('span',0,'🎞 Choose movie'),inp);
 const cb=el('button','mp-b','☁️ Cloud movies');row.append(lab,cb);document.body.appendChild(root);
 /* ---- what is missing before the movie can start (empty string = ready) ---- */
 function gate(){const m=movie.media;
  if(!m)return'Choose a movie: from this device, or from your cloud';
  if(!movie.myReady){
   if(movie.picking)return'Loading your movie…';
   if(movie.needsFile)return'Your partner chose “'+m.title+'”. Choose the same file';
   return movie.problem||'Loading “'+m.title+'”…'}
  if(present()&&!movie.partnerReady)return'Waiting for your partner to get “'+m.title+'”…';
  return''}
 function refresh(){const m=movie.media,mine=movie.myReady,theirs=movie.partnerReady,here=present();
  head.textContent=m?'🎬 '+m.title:'🎬 No movie chosen yet';
  chips.textContent='';
  const chip=(who,ok,wait)=>{const c=el('span','mp-chip'+(ok?' ok':''),who+(ok?' ✓':wait?' ⏳':' —'));chips.appendChild(c)};
  if(m){chip('You',mine,movie.picking||!!m);if(here)chip('Your partner',theirs,true);else{const c=el('span','mp-chip','Partner not here yet');chips.appendChild(c)}
   const meta=[m.kind==='cloud'?'☁️ Cloud':'🎞 From a device',m.dur?fmt(m.dur):'',size(m.size)].filter(Boolean).join(' · ');chips.appendChild(el('span','mp-meta',meta))}
  const g=gate();note.textContent=m&&!g?'Both of you have it — you can start ♥':g;note.className='mp-n'+(movie.problem?' bad':'');
  lab.classList.toggle('dis',movie.picking);cb.disabled=movie.picking}
 inp.onchange=async()=>{const f=inp.files[0];inp.value='';if(!f)return;
  let r=await movie.chooseFile(f);
  if(!r.ok&&r.len&&ask('That file is a different length than your partner’s movie.\n\nUse THIS file as the movie instead? Your partner will then have to choose it too.'))r=await movie.chooseFile(f,true);
  refresh()};
 /* ---- cloud sheet ---- */
 const sheet=el('div');sheet.id='mp-sheet';sheet.style.display='none';document.body.appendChild(sheet);
 function closeSheet(){sheet.style.display='none';sheet.textContent=''}
 async function openCloud(){sheet.textContent='';sheet.style.display='flex';
  const box=el('div','mps-box'),hd=el('div','mps-h'),x=el('button','mps-x','✕'),body=el('div','mps-body');x.onclick=closeSheet;hd.append(el('b',0,'☁️ Cloud movies'),x);box.append(hd,body);sheet.appendChild(box);
  sheet.onclick=e=>{if(e.target===sheet)closeSheet()};
  body.append(el('div','mps-i','Loading your cloud movies…'));
  const r=await fetchList();if(sheet.style.display==='none')return;body.textContent='';
  if(!r||r.err){body.append(el('div','mps-i bad',(r&&r.err)||'Could not load your cloud movies'));const b=el('button','mp-b','Try again');b.onclick=openCloud;body.append(b);return}
  if(!r.movies.length){body.append(el('div','mps-i','No movies in your cloud yet. Upload one in Twin Hearts → Watch Together → Cloud Storage, then come back here.'));return}
  for(const mv of r.movies){const it=el('button','mps-m'),t=el('span','mps-t',mv.title||'Movie'),s=el('span','mps-s',[mv.durationSec?fmt(mv.durationSec):'',size(mv.sizeBytes)].filter(Boolean).join(' · '));
   if(movie.media&&movie.media.id===mv.id)it.classList.add('on');it.append(t,s);
   it.onclick=async()=>{closeSheet();const res=await movie.chooseCloud(mv);if(!res.ok)note.textContent=res.msg;refresh()};body.append(it)}}
 cb.onclick=openCloud;
 movie.onmedia=refresh;refresh();
 return{refresh,gate,openCloud,vis(on){const d=on?'flex':'none';if(root.style.display!==d){root.style.display=d;if(on)refresh()}}}}
