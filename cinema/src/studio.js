import * as THREE from 'three';
import {makeAvatar} from './avatar.js';
/** The "outside the theatre" start screen: a navy MetaPerson-style studio with the couple standing side by side.
    Drag to turn the camera, wheel/pinch to zoom. Renders in its own scene until the couple joins. */
export function createStudio(renderer,gl){
 const scene=new THREE.Scene(),cam=new THREE.PerspectiveCamera(32,innerWidth/innerHeight,.1,40);
 const bg=document.createElement('canvas');bg.width=4;bg.height=512;{const x=bg.getContext('2d'),g=x.createLinearGradient(0,0,0,512);g.addColorStop(0,'#1a1f3c');g.addColorStop(.55,'#252b52');g.addColorStop(1,'#12152b');x.fillStyle=g;x.fillRect(0,0,4,512)}
 const bt=new THREE.CanvasTexture(bg);bt.colorSpace=THREE.SRGBColorSpace;scene.background=bt;
 scene.add(new THREE.HemisphereLight(0x9aa6ff,0x1a1630,1.1));
 const key=new THREE.DirectionalLight(0xfff1e0,2.6);key.position.set(2.5,3.5,4);key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-2,right:2,top:3,bottom:-1,near:.5,far:12});key.shadow.bias=-.0004;scene.add(key);
 const rim=new THREE.DirectionalLight(0x7a8cff,2.2);rim.position.set(-3,2.5,-3);scene.add(rim);const rim2=new THREE.DirectionalLight(0xff7ac8,1.1);rim2.position.set(3,1.5,-3);scene.add(rim2);
 // soft round stage floor with a glow under the couple
 const fc=document.createElement('canvas');fc.width=fc.height=256;{const x=fc.getContext('2d'),g=x.createRadialGradient(128,128,10,128,128,128);g.addColorStop(0,'#3a4378ff');g.addColorStop(.6,'#232a52cc');g.addColorStop(1,'#12152b00');x.fillStyle=g;x.fillRect(0,0,256,256)}
 const ft=new THREE.CanvasTexture(fc);ft.colorSpace=THREE.SRGBColorSpace;
 const floor=new THREE.Mesh(new THREE.CircleGeometry(3.2,64),new THREE.MeshStandardMaterial({map:ft,transparent:true,roughness:.9,metalness:0}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
 const f=makeAvatar(gl.cf,{height:1.68,walker:true,relaxed:true,style:'f'}),m=makeAvatar(gl.cm,{height:1.8,walker:true,relaxed:true,style:'m'});
 f.group.position.set(-.5,0,0);m.group.position.set(.5,0,0);f.group.rotation.y=.28;m.group.rotation.y=-.28;scene.add(f.group,m.group);
 let pair=true,yaw=0,dist=5.6,tyaw=0,tdist=5.6,focus=1,tfocus=1,down=null,spin=false,nextWave=0;
 const cvs=renderer.domElement,live=()=>scene.userData.on;
 cvs.addEventListener('pointerdown',e=>{if(live())down={x:e.clientX,y:e.clientY,yaw:tyaw}});
 addEventListener('pointermove',e=>{if(live()&&down&&e.buttons)tyaw=down.yaw-(e.clientX-down.x)*.008});
 addEventListener('pointerup',()=>down=null);
 cvs.addEventListener('wheel',e=>{if(live())tdist=Math.min(8,Math.max(2.2,tdist+e.deltaY*.004))},{passive:true});
 let pd=0;cvs.addEventListener('touchmove',e=>{if(!live()||e.touches.length!==2)return;const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);if(pd)tdist=Math.min(8,Math.max(2.2,tdist-(d-pd)*.01));pd=d},{passive:true});cvs.addEventListener('touchend',()=>pd=0);
 const api={scene,on:false,
  wave(){f.emote('wave');setTimeout(()=>m.emote('wave'),450)},
  /** slot = which avatar is you (1 girl / 2 boy). both=false: only you, centred; both=true: the couple side by side (partner waves hello). */
  layout(slot,both){const mine=slot===1?f:m,other=slot===1?m:f;
   if(both){f.group.visible=m.group.visible=true;f.group.position.x=-.5;m.group.position.x=.5;f.group.rotation.y=.28;m.group.rotation.y=-.28;if(!pair)setTimeout(api.wave,350)}
   else{mine.group.visible=true;other.group.visible=false;mine.group.position.x=0;mine.group.rotation.y=0}
   pair=both},
  toggleSpin(){spin=!spin;return spin},
  view(v){if(v==='face'){tfocus=1.62;tdist=2.6}else if(v==='body'){tfocus=.95;tdist=5.6}else{tfocus=1.1;tdist=4.2}},
  png(){const w=renderer.domElement;api.render(0,performance.now()/1000);return new Promise(r=>w.toBlob(r,'image/png'))},
  render(dt,t){scene.userData.on=api.on;if(spin)tyaw+=dt*.5;yaw+=(tyaw-yaw)*Math.min(1,dt*8);dist+=(tdist-dist)*Math.min(1,dt*5);focus+=(tfocus-focus)*Math.min(1,dt*5);
   cam.aspect=innerWidth/innerHeight;cam.fov=cam.aspect<1?52:32;cam.updateProjectionMatrix();
   cam.position.set(Math.sin(yaw)*dist,focus+.35,Math.cos(yaw)*dist);cam.lookAt(0,focus,0);
   if(t>nextWave){nextWave=t+9+Math.random()*5;api.wave()}
   for(const a of[f,m]){a.update(dt,t);a.group.scale.y=1+Math.sin(t*1.6)*.0035}   // idle breathing
   renderer.render(scene,cam)}};
 return api}
