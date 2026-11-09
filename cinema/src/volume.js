/** One 🎚 button (top-left, under the bag) that opens a small mixer for everything you hear in the lobby and the hall:
    Master · Songs · Crowd & room · Effects (footsteps, doors, popcorn, memes) · Movie. Values are saved on this device. */
import {rail} from './rail.js';
export function createVolume({audio,movie}){
 const ROWS=[['master','🔊','Everything'],['songs','🎵','Songs'],['amb','👥','Crowd & room'],['fx','👣','Steps & effects'],['movie','🎬','Movie']];
 const btn=document.createElement('button'),box=document.createElement('div');btn.id='volbtn';btn.title='Sound: songs, crowd, steps, movie';btn.setAttribute('aria-label','Sound controls');
 box.id='volpanel';box.innerHTML='<b>Sound</b>'+ROWS.map(([k,i,n])=>`<label><span>${i} ${n}</span><input type="range" min="0" max="100" data-k="${k}"><em></em></label>`).join('');
 rail.appendChild(btn);document.body.appendChild(box);
 const get=k=>k==='movie'?(movie?.v?.volume??1):audio.volumes()[k],ins=[...box.querySelectorAll('input')];
 const icon=()=>{const v=audio.volumes().master;btn.textContent=audio.isMuted()||v===0?'🔇':v<.34?'🔈':v<.67?'🔉':'🔊'};
 const paint=()=>{ins.forEach(i=>{const v=Math.round(get(i.dataset.k)*100);i.value=v;i.nextElementSibling.textContent=v;i.style.setProperty('--p',v+'%')});icon()};
 ins.forEach(i=>i.oninput=()=>{const k=i.dataset.k,v=i.value/100;if(k==='movie'){if(movie?.v)movie.v.volume=v}else audio.volume(k,v);i.nextElementSibling.textContent=i.value;i.style.setProperty('--p',i.value+'%');icon()});
 let open=false;const set=o=>{open=o;box.classList.toggle('open',o);btn.classList.toggle('on',o);if(o){paint();document.dispatchEvent(new CustomEvent('rail-open',{detail:'vol'}))}};
 document.addEventListener('rail-open',e=>{if(e.detail!=='vol'&&open)set(false)});
 btn.onclick=e=>{e.stopPropagation();set(!open)};
 document.addEventListener('pointerdown',e=>{if(open&&!box.contains(e.target)&&e.target!==btn)set(false)});
 return{show(){btn.classList.add('show');paint()},hide(){btn.classList.remove('show');set(false)},toggle:()=>set(!open),refresh:paint}}
