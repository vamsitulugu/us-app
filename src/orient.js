// Landscape-only on phones when the cinema is opened from Twin Hearts.
// Inside the app's full-screen frame the viewport is already landscape (the app turns the frame), so this stays hidden.
// Opened on its own with the phone upright, it asks to turn the phone and, on the tap, tries fullscreen + orientation lock.
export function mountOrient(){
 if(!matchMedia('(pointer:coarse)').matches)return;
 const el=document.createElement('div');el.id='rot';
 el.innerHTML='<div class="rot-i">📱</div><div class="rot-t">Turn your phone sideways</div><small>The 3D theatre is made for landscape</small>';
 const b=document.createElement('button');b.className='main';b.textContent='Full screen';
 b.onclick=async()=>{try{await document.documentElement.requestFullscreen({navigationUI:'hide'});await screen.orientation.lock('landscape')}catch(e){}};
 el.appendChild(b);document.body.appendChild(el);
 const q=matchMedia('(orientation:portrait)'),upd=()=>{el.style.display=q.matches?'flex':'none'};
 q.addEventListener?q.addEventListener('change',upd):q.addListener(upd);upd()}
