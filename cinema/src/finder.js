/* ------------------------------------------------------------------
   "Find my partner" (lobby + hall). One tap lights the partner up for a few seconds:
     - a glowing pulse ring + beam on the floor under them (drawn on top of everything, so a crowd or a row of seats cannot hide it)
     - a pin on the screen when they are in view, or an arrow on the screen edge pointing the way (with the distance) when they are not
   Tap the button again to hide it. Nothing is sent over the network: it only reads where the partner already is.
------------------------------------------------------------------- */
import * as THREE from 'three';
const SHOW_MS=9000;
export function createFinder({scene,camera,target,from}){
 const mk=()=>new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.9,depthTest:false,depthWrite:false,side:THREE.DoubleSide,fog:false});
 const grp=new THREE.Group();grp.visible=false;
 const ring=(m)=>{const r=new THREE.Mesh(new THREE.RingGeometry(.42,.5,48),m);r.rotation.x=-Math.PI/2;r.renderOrder=999;grp.add(r);return r};
 const r1=ring(mk()),r2=ring(mk());
 const beam=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,2.4,10,1,true),mk());beam.position.y=1.2;beam.renderOrder=999;grp.add(beam);
 scene.add(grp);
 const el=document.createElement('div');el.id='find';
 el.innerHTML='<div class="fd-pin"><i>♥</i></div><div class="fd-arr"><i>➤</i></div><div class="fd-lab"></div><div class="fd-toast"></div>';
 document.body.appendChild(el);
 const pin=el.querySelector('.fd-pin'),arr=el.querySelector('.fd-arr'),lab=el.querySelector('.fd-lab'),toastEl=el.querySelector('.fd-toast');
 let on=false,t0=0,toastT=0;const v=new THREE.Vector3();
 function toast(t){toastEl.textContent=t;toastEl.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>toastEl.classList.remove('on'),2600)}
 function stop(){on=false;grp.visible=false;pin.style.display=arr.style.display=lab.style.display='none';document.body.classList.remove('finding');api.onchange?.(false)}
 function start(){const p=target();if(!p){toast('Your partner is not here yet');return false}
  on=true;t0=performance.now();grp.visible=true;document.body.classList.add('finding');api.onchange?.(true);return true}
 function update(dt,t){
  if(!on)return;const p=target();
  if(!p||performance.now()-t0>SHOW_MS){stop();return}
  grp.position.set(p.x,p.y+.03,p.z);
  for(const[r,o]of[[r1,0],[r2,.5]]){const k=(t*.9+o)%1;r.scale.setScalar(.6+k*1.7);r.material.opacity=.95*(1-k)}
  beam.material.opacity=.45+.25*Math.sin(t*5);
  camera.updateMatrixWorld();v.set(p.x,p.y+1.1,p.z).project(camera);
  const W=innerWidth,H=innerHeight,behind=v.z>1,inView=!behind&&Math.abs(v.x)<.88&&Math.abs(v.y)<.88;
  const me=from?.(),d=me?Math.hypot(p.x-me.x,p.z-me.z):0,txt=d>=1?Math.round(d)+' m':'right here';
  if(inView){
   const sx=(v.x*.5+.5)*W,sy=(-v.y*.5+.5)*H;
   pin.style.display='grid';arr.style.display='none';pin.style.transform=`translate(${sx}px,${sy}px) translate(-50%,-100%)`;
   lab.style.display='block';lab.textContent='Your partner · '+txt;lab.style.transform=`translate(${sx}px,${sy+6}px) translate(-50%,0)`}
  else{
   let ax=v.x,ay=-v.y;if(behind){ax=-ax;ay=-ay}if(Math.abs(ax)<1e-3&&Math.abs(ay)<1e-3)ay=1;   // straight behind you: point down
   const mx=34,my=70,k=Math.min((W/2-mx)/Math.max(Math.abs(ax),1e-3),(H/2-my)/Math.max(Math.abs(ay),1e-3));
   const sx=W/2+ax*k,sy=H/2+ay*k,ang=Math.atan2(ay,ax);
   arr.style.display='grid';pin.style.display='none';arr.style.transform=`translate(${sx}px,${sy}px) translate(-50%,-50%) rotate(${ang}rad)`;
   lab.style.display='block';lab.textContent=txt;const lx=sx-Math.cos(ang)*34,ly=sy-Math.sin(ang)*34;lab.style.transform=`translate(${lx}px,${ly}px) translate(-50%,-50%)`}}
 const api={update,toggle(){if(on){stop();return false}return start()},get on(){return on},stop,onchange:null};
 return api}
