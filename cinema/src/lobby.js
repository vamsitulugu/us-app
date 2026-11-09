import * as THREE from 'three';
import {createFrames} from './frames.js';
import {createTVs} from './tvs.js';

/* ------------------------------------------------------------------
   Lobby + canteen (outside the hall door, +z side).
   Reference: peach wood-panel walls and pillars with black skirting/caps,
   dropped red ceiling panels with glowing cream edges, travertine floor,
   framed posters, a concession counter with popcorn machine, hanging menu
   screens, queue ropes and promo standees.
   Local coords: x across, z measured from the door wall (0) to the back wall (LD).
------------------------------------------------------------------- */
export const LW=9,LD=15,LH=5.4;                       // half width, depth, ceiling height of the lobby
export const COUNTER_Z=10.7;                          // where couples stand to order (local z)

const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const tex=(c,rx,ry)=>{const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;if(rx){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry)}return t};
const rnd=(a,b)=>a+Math.random()*(b-a);
const at=(m,x,y,z)=>{m.position.set(x,y,z);return m};

/* ---------- procedural textures ---------- */
function woodCanvas(){const s=256,c=mk(s,s),x=c.getContext('2d');x.fillStyle='#e6a468';x.fillRect(0,0,s,s);
 for(let i=0;i<260;i++){x.strokeStyle=`rgba(${rnd(120,170)|0},${rnd(60,90)|0},30,${rnd(.04,.14)})`;x.lineWidth=rnd(.5,2);const px=rnd(0,s);x.beginPath();x.moveTo(px,0);x.bezierCurveTo(px+rnd(-6,6),s*.3,px+rnd(-6,6),s*.7,px+rnd(-4,4),s);x.stroke()}
 x.fillStyle='rgba(90,45,20,.35)';x.fillRect(0,0,2,s);x.fillRect(s/2,0,2,s);x.fillStyle='rgba(255,220,170,.18)';x.fillRect(2,0,2,s);x.fillRect(s/2+2,0,2,s);return c}
function floorCanvas(){const s=256,c=mk(s,s),x=c.getContext('2d');x.fillStyle='#b39a74';x.fillRect(0,0,s,s);
 for(let i=0;i<2600;i++){x.fillStyle=`rgba(${Math.random()<.5?255:70},${Math.random()<.5?235:60},${Math.random()<.5?200:40},${rnd(.02,.07)})`;x.fillRect(rnd(0,s),rnd(0,s),rnd(2,16),rnd(1,5))}
 for(let i=0;i<14;i++){x.strokeStyle=`rgba(110,85,55,${rnd(.06,.16)})`;x.lineWidth=rnd(1,3);x.beginPath();let px=rnd(0,s),py=rnd(0,s);x.moveTo(px,py);for(let k=0;k<5;k++){px+=rnd(-40,40);py+=rnd(-40,40);x.lineTo(px,py)}x.stroke()}
 x.strokeStyle='#6f5a3e';x.lineWidth=3;x.strokeRect(0,0,s,s);x.strokeStyle='rgba(255,240,210,.25)';x.lineWidth=1;x.strokeRect(3,3,s-6,s-6);return c}
function tileCanvas(){const c=mk(256,256),x=c.getContext('2d');x.fillStyle='#f1eee6';x.fillRect(0,0,256,256);x.strokeStyle='#bdb8aa';x.lineWidth=2;for(let i=0;i<=256;i+=64){x.beginPath();x.moveTo(i,0);x.lineTo(i,256);x.stroke();x.beginPath();x.moveTo(0,i);x.lineTo(256,i);x.stroke()}return c}
function brickCanvas(){const c=mk(256,128),x=c.getContext('2d');x.fillStyle='#262a28';x.fillRect(0,0,256,128);for(let r=0;r<8;r++)for(let i=-1;i<5;i++){const ox=r%2?32:0;x.fillStyle=`rgb(${rnd(44,64)|0},${rnd(50,68)|0},${rnd(48,64)|0})`;x.fillRect(i*64+ox+2,r*16+2,60,12)}return c}

function screenCanvas(kind){const w=512,h=288,c=mk(w,h),x=c.getContext('2d');
 const T={Beverages:['#7a3db8','#ff4fa0','🥤',['Cola · Shakes','Iced Tea · Lime Soda','Cold Coffee · Water']],Popcorn:['#b3121c','#ff5a3c','🍿',['Salted · Butter · Caramel','Cheese · Peri-Peri','Small · Medium · Large · Tub']],'Ice Cream':['#0d9b7d','#38d9a9','🍦',['Cups · Cones · Sundaes','Add your toppings','Couple Heart Sundae']]}[kind];
 const g=x.createLinearGradient(0,0,w,h);g.addColorStop(0,T[0]);g.addColorStop(1,T[1]);x.fillStyle=g;x.fillRect(0,0,w,h);
 x.fillStyle='rgba(255,255,255,.14)';x.beginPath();x.arc(w*.82,h*.5,130,0,7);x.fill();
 x.font='120px serif';x.textAlign='center';x.fillText(T[2],w*.8,h*.62);
 x.textAlign='left';x.fillStyle='#fff';x.shadowColor='rgba(0,0,0,.45)';x.shadowBlur=10;x.font='bold 58px Georgia,serif';x.fillText(kind,28,84);
 x.shadowBlur=0;x.font='26px system-ui,sans-serif';x.fillStyle='#fff';T[3].forEach((l,i)=>x.fillText(l,28,140+i*42));return c}
function boardCanvas(){const w=640,h=300,c=mk(w,h),x=c.getContext('2d');x.fillStyle='#0d0d0d';x.fillRect(0,0,w,h);x.strokeStyle='#d6a24a';x.lineWidth=3;x.strokeRect(8,8,w-16,h-16);
 const cols=[['SNACKS',['Nachos','Fries','Burgers','Hot Dogs','Pizza']],['DRINKS',['Cola','Shakes','Iced Tea','Lime Soda','Water']],['HOT',['Coffee','Chai','Latte','Cocoa','Green Tea']],['SWEET',['Ice Cream','Brownies','Churros','Donuts','Waffles']]];
 cols.forEach(([t,l],i)=>{const cx=20+i*154;x.fillStyle='#ffd37a';x.font='bold 24px system-ui';x.textAlign='left';x.fillText(t,cx,52);x.fillStyle='#f4efe6';x.font='19px system-ui';l.forEach((s,k)=>x.fillText(s,cx,92+k*34))});
 x.fillStyle='#ff6a82';x.font='bold 22px system-ui';x.textAlign='center';x.fillText('♥  COUPLE COMBOS FROM 40 COINS  ♥',w/2,h-22);return c}
function standCanvas(){const w=256,h=448,c=mk(w,h),x=c.getContext('2d'),g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,'#5a1d7a');g.addColorStop(1,'#2a0c40');x.fillStyle=g;x.fillRect(0,0,w,h);x.strokeStyle='#ffc93c';x.lineWidth=8;x.strokeRect(6,6,w-12,h-12);
 x.fillStyle='#ffc93c';x.beginPath();for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,r=i%2?42:96;x.lineTo(w/2+Math.cos(a)*r,150+Math.sin(a)*r)}x.closePath();x.fill();
 x.fillStyle='#b3121c';x.textAlign='center';x.font='bold 34px Georgia,serif';x.fillText('DATE',w/2,142);x.fillText('NIGHT',w/2,180);
 x.fillStyle='#fff';x.font='bold 30px system-ui';x.fillText('GET 40–50%',w/2,282);x.fillText('OFF ON',w/2,320);x.fillStyle='#ffc93c';x.fillText('TUESDAY',w/2,364);x.fillText('& FRIDAY',w/2,402);return c}
function signCanvas(){const c=mk(512,128),x=c.getContext('2d');x.fillStyle='#fff3e6';x.shadowColor='#ff3a4a';x.shadowBlur=22;x.font='bold 64px Georgia,serif';x.textAlign='center';x.fillText('♥ CANTEEN ♥',256,88);return c}

/* ---------- builder ---------- */
export function buildLobby(scene,{y0,DOOR_Z}){
 const Z=z=>DOOR_Z+z,Y=y=>y0+y,boxes=[],hits=[],lights=[],glows=[];
 let lobbyOn=true;
 const M=(c,o)=>new THREE.MeshStandardMaterial({color:c,roughness:.8,metalness:.05,...o});
 const add=(m,x,y,z,p=scene)=>{m.position.set(x,y,z);p.add(m);return m};
 const box=(w,h,d,mat,x,y,z,p)=>add(new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat),x,y,z,p);
 const lit=(map,k=.35,o)=>M(0xffffff,{map,emissive:0xffffff,emissiveMap:map,emissiveIntensity:k,...o});
 const woodC=woodCanvas();
 const wood=(rx,ry)=>lit(tex(woodC,rx,ry),.3,{roughness:.85});
 const black=M(0x0b0a0a,{roughness:.5,metalness:.2}),cream=M(0xe9dcc0,{roughness:.7});

 /* shell: floor, ceiling, walls */
 const floorT=tex(floorCanvas(),LW*2/1.6,LD/1.6),floor=add(new THREE.Mesh(new THREE.PlaneGeometry(LW*2,LD),M(0xffffff,{map:floorT,roughness:.35,metalness:.08,emissive:0x3a2a18,emissiveIntensity:.25})),0,Y(0),Z(LD/2));floor.rotation.x=-Math.PI/2;
 const ceil=add(new THREE.Mesh(new THREE.PlaneGeometry(LW*2,LD),M(0xe6dbb8,{roughness:.9,emissive:0x5a5238,emissiveIntensity:.5})),0,Y(LH),Z(LD/2));ceil.rotation.x=Math.PI/2;
 const wallL=add(new THREE.Mesh(new THREE.PlaneGeometry(LD,LH),wood(LD/2.4,LH/2.4)),-LW,Y(LH/2),Z(LD/2));wallL.rotation.y=Math.PI/2;
 const wallR=add(new THREE.Mesh(new THREE.PlaneGeometry(LD,LH),wood(LD/2.4,LH/2.4)),LW,Y(LH/2),Z(LD/2));wallR.rotation.y=-Math.PI/2;
 const wallB=add(new THREE.Mesh(new THREE.PlaneGeometry(LW*2,LH),wood(LW*2/2.4,LH/2.4)),0,Y(LH/2),Z(LD));wallB.rotation.y=Math.PI;
 // door wall (with the doorway cut out)
 {const DW=.8,sh=new THREE.Shape();sh.moveTo(-LW,y0);sh.lineTo(LW,y0);sh.lineTo(LW,y0+LH);sh.lineTo(-LW,y0+LH);sh.closePath();
  const h=new THREE.Path();h.moveTo(-DW,y0);h.lineTo(DW,y0);h.lineTo(DW,y0+2.4);h.lineTo(-DW,y0+2.4);h.closePath();sh.holes.push(h);
  const t=tex(woodC,1/2.4,1/2.4);const w=new THREE.Mesh(new THREE.ShapeGeometry(sh),lit(t,.3));w.position.z=DOOR_Z+.02;scene.add(w);
  box(.12,2.5,.14,black,-DW-.06,Y(1.25),DOOR_Z+.06);box(.12,2.5,.14,black,DW+.06,Y(1.25),DOOR_Z+.06);box(DW*2+.24,.12,.14,black,0,Y(2.46),DOOR_Z+.06)}
 // black skirting + cap trim all round
 for(const s of[-1,1]){box(.14,.28,LD,black,s*(LW-.07),Y(.14),Z(LD/2));box(.14,.26,LD,black,s*(LW-.07),Y(LH-.13),Z(LD/2))}
 box(LW*2,.28,.14,black,0,Y(.14),Z(LD-.07));box(LW*2,.26,.14,black,0,Y(LH-.13),Z(LD-.07));box(LW*2,.28,.14,black,0,Y(.14),Z(.09));box(LW*2,.26,.14,black,0,Y(LH-.13),Z(.09));

 /* ceiling: dropped red panels with glowing cream edges */
 const redM=new THREE.MeshBasicMaterial({color:0xb3121b,toneMapped:false}),edgeM=new THREE.MeshBasicMaterial({color:0xffe0b0,toneMapped:false}),neonM=new THREE.MeshBasicMaterial({color:0xff5a50,toneMapped:false});
 for(const[cz,w,d]of[[2.6,13,3.4],[7.4,13,4.2],[12.6,13,3.6]]){const y=LH-.14;
  const p=new THREE.Mesh(new THREE.PlaneGeometry(w,d),redM);p.rotation.x=Math.PI/2;add(p,0,Y(y),Z(cz));
  const e=.16,ey=Y(LH-.07);
  for(const s of[-1,1]){box(w+e*2,.14,e,edgeM,0,ey,Z(cz+s*(d/2+e/2)));box(e,.14,d,edgeM,s*(w/2+e/2),ey,Z(cz))}
  box(w,.03,.05,neonM,0,Y(y-.01),Z(cz+d/2-.04));box(w,.03,.05,neonM,0,Y(y-.01),Z(cz-d/2+.04))}
 for(const[lx,lz,c,i,dist]of[[0,3,0xff4a3c,7,9],[0,8,0xff7a50,9,10],[0,12.2,0xffc890,9,9]]){const l=new THREE.PointLight(c,i,dist,1.6);l.position.set(lx,Y(LH-1.1),Z(lz));scene.add(l);lights.push([l,i])}

 /* pillars (wood, black base + cap) */
 const pw=wood(1.6/2.4,LH/2.4);
 for(const[px,pz]of[[-4.3,5.2],[4.3,5.2],[-4.3,9.4],[4.3,9.4]]){box(1.5,LH,1.5,pw,px,Y(LH/2),Z(pz));box(1.64,.32,1.64,black,px,Y(.16),Z(pz));box(1.64,.3,1.64,black,px,Y(LH-.15),Z(pz));
  boxes.push({x0:px-.85,x1:px+.85,z0:DOOR_Z+pz-.85,z1:DOOR_Z+pz+.85})}

 /* framed movie posters = the couple's Twin Hearts library (see frames.js) */
 const frames=createFrames();
 const tvs=createTVs({scene});
 const poster=(x,z,ry)=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(1.1,1.62,.1),black));const fr=frames.add(x,Y(2.35),z,ry),p=fr.plane;p.position.z=.056;g.add(p);fr.plate.position.set(0,1.04,.06);g.add(fr.plate);
  const glow=new THREE.Mesh(new THREE.PlaneGeometry(1.5,2.1),new THREE.MeshBasicMaterial({color:0xffd9a8,transparent:true,opacity:.1,blending:THREE.AdditiveBlending,depthWrite:false}));glow.position.z=.02;g.add(glow);glows.push(glow.material);
  g.position.set(x,Y(2.35),z);g.rotation.y=ry;scene.add(g)};
 [2.4,5.4,8.4,11.4].forEach(z=>{poster(-LW+.07,Z(z),Math.PI/2);poster(LW-.07,Z(z),-Math.PI/2)});
 poster(-7.4,Z(LD-.07),Math.PI);poster(7.4,Z(LD-.07),Math.PI);
 /* wall TVs high above the posters: your Twin Hearts ad + share-with-friends / new-features / app-image slides (see tvs.js) */
 [2.4,5.4,8.4,11.4].forEach(z=>{tvs.wall(-LW+.09,Y(4.35),Z(z),Math.PI/2,1.9);tvs.wall(LW-.09,Y(4.35),Z(z),-Math.PI/2,1.9)});
 tvs.wall(-7.4,Y(4.35),Z(LD-.09),Math.PI,1.9);tvs.wall(7.4,Y(4.35),Z(LD-.09),Math.PI,1.9);       // back wall, above the canteen side posters
 tvs.wall(-4.6,Y(3.7),Z(.2),0,2.4);tvs.wall(4.6,Y(3.7),Z(.2),0,2.4);                              // entrance wall, either side of the hall door

 /* sofas for couples along the side walls */
 const sofaM=M(0x8f1a22,{roughness:.8});
 for(const s of[-1,1]){const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(.9,.42,2.4),sofaM));const bk=new THREE.Mesh(new THREE.BoxGeometry(.24,.7,2.4),sofaM);bk.position.set(s*.34,.46,0);g.add(bk);
  for(const dz of[-1.25,1.25]){const a=new THREE.Mesh(new THREE.BoxGeometry(.9,.3,.18),sofaM);a.position.set(0,.36,dz);g.add(a)}
  const b=new THREE.Mesh(new THREE.BoxGeometry(.8,.06,2.2),black);b.position.y=-.24;g.add(b);
  g.position.set(s*(LW-.75),Y(.3),Z(1.4));scene.add(g);
  boxes.push({x0:s*(LW-.75)-.5,x1:s*(LW-.75)+.5,z0:DOOR_Z+.2,z1:DOOR_Z+2.6})}

 /* ---------- concession counter ---------- */
 const backZ=Z(LD);
 const tileM=lit(tex(tileCanvas(),11/1.2,2.2/1.2),.35);const tile=add(new THREE.Mesh(new THREE.PlaneGeometry(11,2.2),tileM),0,Y(1.1),backZ-.02);tile.rotation.y=Math.PI;
 const brick=add(new THREE.Mesh(new THREE.PlaneGeometry(11,1.4),lit(tex(brickCanvas(),5,1),.25)),0,Y(2.9),backZ-.02);brick.rotation.y=Math.PI;
 box(11.2,.1,.16,black,0,Y(2.2),backZ-.08);box(11.2,.1,.16,black,0,Y(3.62),backZ-.08);
 // counter body + top
 const cbody=box(11,1.1,1.1,M(0x2a130f,{roughness:.55,metalness:.15,emissive:0x2a0e08,emissiveIntensity:.4}),0,Y(.55),Z(12.3)),ctop=box(11.3,.08,1.34,cream,0,Y(1.14),Z(12.3));
 box(11.3,.05,.06,M(0xffd6a0,{emissive:0xffb070,emissiveIntensity:1.2}),0,Y(.06),Z(11.72));
 hits.push(cbody,ctop);boxes.push({x0:-5.7,x1:5.7,z0:DOOR_Z+11.6,z1:DOOR_Z+LD});
 // popcorn machine (glass cabinet full of popcorn)
 const popm=new THREE.Group(),goldM=M(0xd9a830,{metalness:.7,roughness:.35});
 popm.add(at(new THREE.Mesh(new THREE.BoxGeometry(.9,.42,.8),M(0xb3121b,{roughness:.5})),0,.21,0));
 popm.add(at(new THREE.Mesh(new THREE.BoxGeometry(.84,.82,.74),new THREE.MeshStandardMaterial({color:0xfff4d0,transparent:true,opacity:.22,roughness:.1,metalness:.1})),0,.83,0));
 for(const[x,z]of[[-.43,-.37],[.43,-.37],[-.43,.37],[.43,.37]])popm.add(at(new THREE.Mesh(new THREE.BoxGeometry(.04,.84,.04),goldM),x,.83,z));
 popm.add(at(new THREE.Mesh(new THREE.BoxGeometry(.96,.1,.86),goldM),0,1.3,0));
 popm.add(at(new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.2,8),goldM),0,1.45,0));
 const pop=new THREE.InstancedMesh(new THREE.SphereGeometry(.07,7,6),M(0xfff0b8,{roughness:.9,emissive:0x6a5a20,emissiveIntensity:.3}),150),mt=new THREE.Matrix4(),pdata=[];
 for(let i=0;i<150;i++){const p=[rnd(-.34,.34),rnd(.5,1.05),rnd(-.3,.3),rnd(0,6)];pdata.push(p);mt.setPosition(p[0],p[1],p[2]);pop.setMatrixAt(i,mt)}popm.add(pop);
 popm.position.set(-1.2,Y(1.18),Z(12.3));scene.add(popm);hits.push(popm.children[0],popm.children[1]);
 const popLight=new THREE.PointLight(0xffcf70,1.6,3.2,2);popLight.position.set(-1.2,Y(2.2),Z(11.9));scene.add(popLight);lights.push([popLight,1.6]);
 // soda dispenser + cups
 const soda=new THREE.Group();soda.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.2,.95,.55),M(0x3a3c3e,{roughness:.4,metalness:.5})),0,.48,0));
 soda.add(at(new THREE.Mesh(new THREE.BoxGeometry(1.2,.25,.6),M(0xb3121b,{roughness:.5})),0,1.07,0));
 for(const x of[-.4,-.13,.14,.4])soda.add(at(new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.14,8),M(0xcfcfcf,{metalness:.8,roughness:.3})),x,.78,-.3));
 soda.position.set(2.1,Y(1.18),Z(12.35));scene.add(soda);hits.push(soda.children[0]);
 // registers + counter bell
 for(const x of[-3.4,-2.5,3.5]){const r=new THREE.Group();r.add(at(new THREE.Mesh(new THREE.BoxGeometry(.42,.22,.38),black),0,.11,0));
  const sc=new THREE.Mesh(new THREE.BoxGeometry(.32,.22,.04),M(0x101418,{emissive:0x3dff7a,emissiveIntensity:.35}));sc.position.set(0,.34,.04);sc.rotation.x=-.3;r.add(sc);r.position.set(x,Y(1.18),Z(12.3));r.rotation.y=Math.PI;scene.add(r)}
 const bell=new THREE.Mesh(new THREE.SphereGeometry(.07,12,8,0,Math.PI*2,0,Math.PI/2),goldM);bell.position.set(0,Y(1.18),Z(11.95));scene.add(bell);
 // side cabinets (green vending cabinet like the reference + dark fridge)
 for(const[x,c]of[[-6.6,0x0e3b2b],[6.6,0x1a1f2b]]){const m=box(1.2,2.3,1,M(c,{roughness:.4,metalness:.3}),x,Y(1.15),Z(LD-.6));boxes.push({x0:x-.7,x1:x+.7,z0:DOOR_Z+LD-1.2,z1:DOOR_Z+LD});hits.push(m);
  const gl=new THREE.Mesh(new THREE.PlaneGeometry(.9,1.6),new THREE.MeshBasicMaterial({color:c===0x0e3b2b?0x7affc4:0xa6d8ff,transparent:true,opacity:.28}));gl.position.set(x,Y(1.3),Z(LD-.09));gl.rotation.y=Math.PI;scene.add(gl)}
 // menu board + overhead menu screens
 const board=add(new THREE.Mesh(new THREE.PlaneGeometry(3.2,1.3),new THREE.MeshBasicMaterial({map:tex(boardCanvas()),toneMapped:false})),0,Y(2.9),backZ-.1);board.rotation.y=Math.PI;hits.push(board);
 const kinds=['Beverages','Popcorn','Ice Cream','Beverages','Popcorn','Ice Cream'],scrs=[];
 kinds.forEach((k,i)=>{const x=-4.4+i*1.76,g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(1.64,.96,.1),black));
  const s=new THREE.Mesh(new THREE.PlaneGeometry(1.54,.87),new THREE.MeshBasicMaterial({map:tex(screenCanvas(k)),toneMapped:false}));s.position.z=-.056;s.rotation.y=Math.PI;g.add(s);
  const rod=new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,.6,6),black);rod.position.set(0,.77,.0);g.add(rod);hits.push(s);scrs.push(s);tvs.menu(s);
  g.position.set(x,Y(4.35),Z(12.1));g.rotation.x=-.12;scene.add(g)});
 // neon sign above the screens
 const nsign=new THREE.Mesh(new THREE.PlaneGeometry(3,.75),new THREE.MeshBasicMaterial({map:tex(signCanvas()),transparent:true,toneMapped:false}));nsign.position.set(0,Y(5.02),backZ-.12);nsign.rotation.y=Math.PI;scene.add(nsign);
 // queue ropes (two lanes leading to the counter) + standees
 const bronze=M(0x3a2a1a,{metalness:.8,roughness:.35}),velvet=M(0x8a0f18,{roughness:.8});
 const post=(x,z)=>{box(.34,.04,.34,bronze,x,Y(.02),z);add(new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.96,8),bronze),x,Y(.5),z);add(new THREE.Mesh(new THREE.SphereGeometry(.06,8,8),bronze),x,Y(1),z)};
 const rope=(x1,z1,x2,z2)=>{const len=Math.hypot(x2-x1,z2-z1),r=add(new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,len,6),velvet),(x1+x2)/2,Y(.88),(z1+z2)/2);r.rotation.z=Math.PI/2;r.rotation.y=-Math.atan2(z2-z1,x2-x1)}; 
 for(const s of[-1,1]){const x=s*1.6,zs=[Z(7.6),Z(8.7),Z(9.8)];zs.forEach(z=>post(x,z));rope(x,zs[0],x,zs[1]);rope(x,zs[1],x,zs[2])}
 for(const x of[-3.2,3.2]){const g=new THREE.Group(),stM=new THREE.MeshBasicMaterial({map:tex(standCanvas()),toneMapped:false,side:THREE.DoubleSide}),pl=new THREE.Mesh(new THREE.PlaneGeometry(.78,1.36),stM);pl.position.y=.95;g.add(pl);g.add(at(new THREE.Mesh(new THREE.BoxGeometry(.7,.06,.5),black),0,.03,0));g.position.set(x,Y(0),Z(10.3));g.rotation.y=Math.PI+x*.06;scene.add(g)}
 // trash bin
 add(new THREE.Mesh(new THREE.CylinderGeometry(.24,.2,.8,14),M(0x3c3a2e,{roughness:.6,metalness:.4})),-LW+.8,Y(.4),Z(6.5));

 /* ---------- order tray (appears on the counter when an order is ready) ---------- */
 const tray=new THREE.Group();tray.position.set(0,Y(1.18),Z(11.95));scene.add(tray);
 const bucket=()=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.CylinderGeometry(.14,.1,.26,16),M(0xd8283c,{roughness:.6})));const st=new THREE.Mesh(new THREE.CylinderGeometry(.141,.101,.07,16),M(0xffffff,{roughness:.6}));st.position.y=.04;g.add(st);
  for(let i=0;i<9;i++){const s=new THREE.Mesh(new THREE.SphereGeometry(.065,8,6),M(0xfff0b8));s.position.set(rnd(-.09,.09),.16+rnd(0,.06),rnd(-.09,.09));g.add(s)}g.position.y=.13;return g};
 const cup=()=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.CylinderGeometry(.075,.055,.22,14),M(0xf1f1f1,{roughness:.5})));const l=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,.02,14),M(0xb3121b));l.position.y=.12;g.add(l);const sw=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.2,6),M(0xff4fa0));sw.position.set(.02,.22,0);sw.rotation.z=-.15;g.add(sw);g.position.y=.11;return g};
 const cone=()=>{const g=new THREE.Group(),c=new THREE.Mesh(new THREE.ConeGeometry(.07,.2,12),M(0xd9a15a));c.rotation.x=Math.PI;c.position.y=.1;g.add(c);const s=new THREE.Mesh(new THREE.SphereGeometry(.085,14,10),M(0xffc8dc));s.position.y=.24;g.add(s);return g};
 const food=()=>{const g=new THREE.Group(),b=new THREE.Mesh(new THREE.BoxGeometry(.24,.1,.18),M(0xe8d9b0));b.position.y=.05;g.add(b);const t=new THREE.Mesh(new THREE.SphereGeometry(.1,12,8,0,Math.PI*2,0,Math.PI/2),M(0xc98a45));t.position.y=.1;g.add(t);return g};
 const MAKE={popcorn:bucket,drink:cup,ice:cone,food};
 const trayBase=new THREE.Mesh(new THREE.BoxGeometry(1.5,.03,.6),M(0xb3121b,{roughness:.5}));trayBase.position.y=.015;tray.add(trayBase);tray.visible=false;

 /* ---------- api ---------- */
 const servePoint={x:0,z:DOOR_Z+COUNTER_Z};
 let lt=0;
 return{boxes,hits,floors:[floor],servePoint,frames,
  /** show the finished order on the counter. kinds = array of 'popcorn' | 'drink' | 'ice' | 'food' */
  showTray(kinds){tray.children.slice(1).forEach(c=>tray.remove(c));const list=kinds.slice(0,8),n=list.length;list.forEach((k,i)=>{const o=(MAKE[k]||food)();o.position.x=(i-(n-1)/2)*(1.3/Math.max(n,3));o.position.z=(i%2?.1:-.08);tray.add(o)});tray.visible=n>0},
  hideTray(){tray.visible=false},
  /** house=1 full lights; lobby lights fade with the hall so they never leak light into a dark movie */
  setOn(on){lobbyOn=on;lights.forEach(([l,i],k)=>{l.visible=on||k<2;l.intensity=on?i:i*.45});tvs.setOn(on)},   // in the hall the two lights nearest the door stay on (dimmed): through the door glass / open door you see the lobby, not darkness
  setLights(v){tvs.setLights(v);lights.forEach(([l,i])=>l.intensity=i*v*(lobbyOn?1:.45));glows.forEach(m=>m.opacity=.04+.08*v)},
  update(t){frames.update(Math.min(.1,Math.max(0,t-lt)));lt=t;pop.rotation.y=Math.sin(t*.8)*.04;for(let i=0;i<pdata.length;i++){const p=pdata[i];mt.setPosition(p[0],p[1]+Math.sin(t*3+p[3])*.012,p[2]);pop.setMatrixAt(i,mt)}pop.instanceMatrix.needsUpdate=true;
   const k=.55+.45*Math.sin(t*1.2);neonM.color.setRGB(1,.28+.12*k,.25+.1*k);tvs.update(t)}}}
