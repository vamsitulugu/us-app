import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {buildLobby,LW,LD,LH} from './lobby.js';
export {LW,LD,LH};

/* ------------------------------------------------------------------
   Stadium-style cinema (reference: red + grey high-back seats, lit aisle
   stairs, stepped glowing ceiling frames, wall speakers and sconces).
   Seats face -z toward the screen. The room rises toward the door (+z).
------------------------------------------------------------------- */
const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
const sm=u=>u*u*(3-2*u);
export const ROWS='ABCDEFGHI',NROWS=9,COLS=15;
export const PITCH=1.2,RISE=.25,ROW0=-5.2;          // row spacing, step height, z of row A
export const HALF=6.3,FRONT_Z=-11,DOOR_Z=6.6,AISLE_X=3.5;
export const rowZ=r=>ROW0+r*PITCH;
/** floor height: flat stage, then one smooth riser in front of every row, flat walkway at the top */
export const floorY=z=>{const u=(z-(rowZ(1)-.45))/PITCH;if(u<0)return 0;const i=Math.floor(u),f=u-i;return Math.min(NROWS-1,i+sm(Math.min(1,f/.2)))*RISE};
/** 3 seats | aisle | 9 seats | aisle | 3 seats */
export const seatX=c=>c<3?-4.35-(2-c)*.65:c<12?(c-7)*.66:4.35+(c-12)*.65;

const FZ=[3.2,-1.2,-5.6,-9.6],FH=[7.2,6.8,6.4,6.0],FW=[6.1,6.05,6,6],CEIL0=7.7;   // ceiling frames: z, opening height, half width
const BAY=[4.9,1.0,-3.4,-7.6];                                                    // wall bays (speaker + sconce)
const SCREEN_Y=3.45,SCREEN_Z=FRONT_Z+.15;

const mkCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const tex=(c,srgb=true)=>{const t=new THREE.CanvasTexture(c);if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t};
const noise=(rx,ry,s)=>{const c=mkCanvas(128,128),x=c.getContext('2d'),d=x.createImageData(128,128);for(let i=0;i<d.data.length;i+=4){d.data[i]=d.data[i+1]=d.data[i+2]=120+Math.random()*s;d.data[i+3]=255}x.putImageData(d,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rx,ry);return t};
/** red damask carpet */
function carpetTex(){const s=256,c=mkCanvas(s,s),x=c.getContext('2d');x.fillStyle='#7d1414';x.fillRect(0,0,s,s);
 for(let i=0;i<5000;i++){x.fillStyle=`rgba(${Math.random()<.5?255:0},${Math.random()<.5?120:0},60,.05)`;x.fillRect(Math.random()*s,Math.random()*s,2,2)}
 const motif=(cx,cy,k)=>{x.save();x.translate(cx,cy);x.scale(k,k);x.strokeStyle='rgba(222,84,62,.5)';x.fillStyle='rgba(222,84,62,.38)';x.lineWidth=3;
  for(const a of[0,Math.PI/2,Math.PI/4,-Math.PI/4]){x.beginPath();x.ellipse(0,0,44,11,a,0,Math.PI*2);x.stroke()}
  x.beginPath();x.arc(0,0,7,0,Math.PI*2);x.fill();x.restore()};
 motif(64,64,1);motif(192,192,1);motif(192,64,.55);motif(64,192,.55);
 const t=tex(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t}
function exitTex(){const c=mkCanvas(128,64),x=c.getContext('2d');x.fillStyle='#14b84b';x.fillRect(0,0,128,64);x.strokeStyle=x.fillStyle='#fff';x.lineWidth=5;x.lineCap=x.lineJoin='round';
 x.beginPath();x.moveTo(12,32);x.lineTo(34,14);x.lineTo(34,25);x.lineTo(54,25);x.lineTo(54,39);x.lineTo(34,39);x.lineTo(34,50);x.closePath();x.fill();
 x.beginPath();x.arc(84,16,6,0,Math.PI*2);x.fill();x.beginPath();x.moveTo(84,24);x.lineTo(80,42);x.moveTo(72,30);x.lineTo(92,27);x.moveTo(80,42);x.lineTo(71,55);x.moveTo(80,42);x.lineTo(91,52);x.stroke();
 x.lineWidth=3;x.strokeRect(104,12,16,40);return tex(c)}
const letterTex=ch=>{const c=mkCanvas(128,128),x=c.getContext('2d');x.fillStyle='#e0301e';x.font='bold 104px system-ui,Arial';x.textAlign='center';x.textBaseline='middle';x.fillText(ch,64,70);return tex(c)};
const washTex=()=>{const c=mkCanvas(64,128),x=c.getContext('2d');x.scale(1,2);const g=x.createRadialGradient(32,64,0,32,64,32);g.addColorStop(0,'rgba(255,196,140,.85)');g.addColorStop(1,'rgba(255,170,110,0)');x.fillStyle=g;x.fillRect(0,0,64,64);return tex(c)};

/** rounded-rectangle "U" outline (open at the bottom), as [x,y] points */
function uPts(W,H,R,y0,step=.25){const p=[],n=10;for(let y=y0;y<H-R;y+=step)p.push([-W,y]);
 for(let k=0;k<=n;k++){const a=Math.PI-k/n*Math.PI/2;p.push([-W+R+Math.cos(a)*R,H-R+Math.sin(a)*R])}
 for(let x=-W+R+step;x<W-R;x+=step)p.push([x,H]);
 for(let k=0;k<=n;k++){const a=Math.PI/2-k/n*Math.PI/2;p.push([W-R+Math.cos(a)*R,H-R+Math.sin(a)*R])}
 for(let y=H-R-step;y>=y0;y-=step)p.push([W,y]);return p}

export function buildHall(scene,renderer){
 const M=(c,o)=>new THREE.MeshStandardMaterial({color:c,roughness:.8,metalness:.05,...o});
 const bumpW=noise(40,25,135),bumpS=noise(3,3,135);
 const add=(m,x,y,z,p=scene)=>{m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;p.add(m);return m};
 const box=(w,h,d,mat,x,y,z,p)=>add(new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat),x,y,z,p);
 const noShadow=m=>{m.castShadow=false;return m};
 try{const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(new RoomEnvironment(),.04).texture;scene.environmentIntensity=.35}catch(e){}

 /* ---------- materials ---------- */
 const warm=M(0x221a10,{emissive:0xffc98a,emissiveIntensity:1});                    // every glowing line / sconce
 const stepMat=M(0x221100,{emissive:0xffa24a,emissiveIntensity:1.3});                // lit aisle steps
 const wall=M(0x80615a,{side:THREE.BackSide,roughness:.95,bumpMap:bumpW,bumpScale:.7});
 const backWall=M(0x634842,{side:THREE.BackSide,roughness:.95,bumpMap:bumpW,bumpScale:.6});
 const frontWall=M(0x9a6f63,{side:THREE.BackSide,roughness:.95,bumpMap:bumpW,bumpScale:.5});
 const ceilMat=M(0x3a2623,{roughness:.9}),slabMat=M(0x2b1d1a,{roughness:.9}),deck=M(0x4a3a35,{roughness:.9,bumpMap:bumpS,bumpScale:.4}),panelMat=M(0x8f675d,{roughness:.95,bumpMap:bumpS,bumpScale:.5}),
  dark=M(0x2a211f,{roughness:.55,metalness:.15}),metal=M(0x6e625e,{roughness:.4,metalness:.5});

 /* ---------- shell ---------- */
 const D=DOOR_Z-FRONT_Z,CZ=(DOOR_Z+FRONT_Z)/2;
 const shell=new THREE.Mesh(new THREE.BoxGeometry(HALF*2,CEIL0+.1,D),[wall,wall,ceilMat,ceilMat,new THREE.MeshBasicMaterial({visible:false}),frontWall]);   // +z face hidden: the back wall is built below WITH a doorwayshell.position.set(0,(CEIL0+.1)/2,CZ);scene.add(shell);

 /* ---------- floors: red carpet stage + stepped rows ---------- */
 const ct=carpetTex(),fz1=rowZ(1)-.325,fl=fz1-FRONT_Z;ct.repeat.set(HALF*2/2.4,fl/2.4);
 const flat=new THREE.Mesh(new THREE.PlaneGeometry(HALF*2,fl),M(0xffffff,{map:ct,roughness:.95}));flat.rotation.x=-Math.PI/2;flat.position.set(0,.001,(FRONT_Z+fz1)/2);flat.receiveShadow=true;scene.add(flat);
 const treads=[];
 for(let r=1;r<NROWS;r++){const z0=rowZ(r)-.325,z1=r<NROWS-1?rowZ(r+1)-.325:DOOR_Z,h=r*RISE;treads.push(box(HALF*2-.02,h,z1-z0,deck,0,h/2,(z0+z1)/2))}
 // lit aisle steps + row letters
 const lt=[...ROWS].map(letterTex);
 for(const s of[-1,1])for(let r=0;r<NROWS;r++){const h=r*RISE;
  if(r>0)noShadow(box(1,.04,.05,stepMat,s*AISLE_X,h-.015,rowZ(r)-.335));
  const l=new THREE.Mesh(new THREE.PlaneGeometry(.42,.42),new THREE.MeshBasicMaterial({map:lt[r],transparent:true,depthWrite:false}));l.rotation.x=-Math.PI/2;l.position.set(s*AISLE_X,h+.006,rowZ(r)+.02);scene.add(l)}

 /* ---------- stepped ceiling, glowing frames ---------- */
 const zones=[[DOOR_Z,FZ[0]+.25,CEIL0],[FZ[0]-.25,FZ[1]+.25,FH[0]],[FZ[1]-.25,FZ[2]+.25,FH[1]],[FZ[2]-.25,FZ[3]+.25,FH[2]],[FZ[3]-.25,FRONT_Z,FH[3]]];
 const dlPos=[],bayLights=[];
 zones.forEach(([za,zb,y],i)=>{const len=za-zb,p=new THREE.Mesh(new THREE.PlaneGeometry(HALF*2,len),ceilMat);p.rotation.x=Math.PI/2;p.position.set(0,y-.002,(za+zb)/2);p.receiveShadow=true;scene.add(p);
  for(let z=za-.7;z>zb+.3;z-=1.3)for(let x=-4.5;x<=4.6;x+=1.5)dlPos.push([x,y-.01,z]);
  if(len>1.5)for(const s of[-1,1]){const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(.9,.05,.9),M(0x17110f,{roughness:.6})));const in_=new THREE.Mesh(new THREE.BoxGeometry(.66,.02,.66),M(0x2c2220,{roughness:.5}));in_.position.y=-.02;g.add(in_);g.position.set(s*2.4,y-.03,(za+zb)/2);scene.add(g)}
  if(len>1.5){const l=new THREE.PointLight(0xffb070,9,9,1.6);l.position.set(0,y-.9,(za+zb)/2);scene.add(l);bayLights.push(l)}});
 const dlMat=new THREE.MeshBasicMaterial({color:0xfff1d6}),dlGeo=new THREE.CircleGeometry(.07,10).rotateX(Math.PI/2),dl=new THREE.InstancedMesh(dlGeo,dlMat,dlPos.length),mx=new THREE.Matrix4();
 dlPos.forEach((p,i)=>{mx.setPosition(p[0],p[1],p[2]);dl.setMatrixAt(i,mx)});dl.frustumCulled=false;scene.add(dl);
 FZ.forEach((z,i)=>{const W=FW[i],H=FH[i],R=1.4,top=i?FH[i-1]:CEIL0;
  const sh=new THREE.Shape();sh.moveTo(-HALF-.2,-1.5);sh.lineTo(HALF+.2,-1.5);sh.lineTo(HALF+.2,top);sh.lineTo(-HALF-.2,top);sh.closePath();
  const hole=new THREE.Path();hole.moveTo(-W,-.5);hole.lineTo(W,-.5);hole.lineTo(W,H-R);hole.absarc(W-R,H-R,R,0,Math.PI/2,false);hole.lineTo(-W+R,H);hole.absarc(-W+R,H-R,R,Math.PI/2,Math.PI,false);hole.lineTo(-W,-.5);sh.holes.push(hole);
  const slab=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:.5,bevelEnabled:false,curveSegments:14}),slabMat);slab.position.z=z-.25;slab.receiveShadow=true;scene.add(slab);
  const pts=uPts(W-.12,H-.12,R,floorY(z)+.1).map(p=>new THREE.Vector3(p[0],p[1],0)),tube=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts,false,'centripetal'),pts.length*2,.035,6),warm);tube.position.z=z+.27;scene.add(tube)});

 /* ---------- walls: panels, speakers, sconces ---------- */
 const wash=washTex(),washMats=[],lamps=[];
 for(const s of[-1,1])BAY.forEach((z,bi)=>{const y=floorY(z)+2.3,x=s*(HALF-.02);
  const pn=box(.08,3.8,1.9,panelMat,s*(HALF-.05),y+.9,z);
  const sp=new THREE.Group();sp.add(new THREE.Mesh(new THREE.BoxGeometry(.22,.56,.4),dark));for(const dy of[.12,-.12]){const c=new THREE.Mesh(new THREE.CylinderGeometry(.09,.09,.04,16),M(0x120d0c,{roughness:.9}));c.rotation.z=Math.PI/2;c.position.set(-s*.12,dy,0);sp.add(c)}sp.position.set(s*(HALF-.2),y,z);sp.children.forEach(k=>k.castShadow=true);scene.add(sp);
  const sy=y+1.5,sc=new THREE.Group();sc.add(new THREE.Mesh(new THREE.BoxGeometry(.12,.34,.14),dark));for(const dy of[.19,-.19]){const e=new THREE.Mesh(new THREE.BoxGeometry(.08,.025,.1),warm);e.position.y=dy;sc.add(e)}sc.position.set(s*(HALF-.12),sy,z);scene.add(sc);
  for(const up of[1,-1]){const wm=new THREE.MeshBasicMaterial({map:wash,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:.9});washMats.push(wm);
   const w=new THREE.Mesh(new THREE.PlaneGeometry(.9,1.7),wm);w.position.set(s*(HALF-.015),sy+up*.95,z);w.rotation.y=-s*Math.PI/2;if(up<0)w.rotation.z=Math.PI;scene.add(w)}
  });   // (per-sconce point lights removed: the additive wash sprites give the same glow for a fraction of the GPU cost)
 // exit signs, side exit doors, extinguishers
 const exMat=new THREE.MeshBasicMaterial({map:exitTex()});
 const sign=(x,y,z,ry)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(.6,.3),exMat);m.position.set(x,y,z);m.rotation.y=ry;scene.add(m)};
 sign(-HALF+.02,floorY(-8.8)+2.9,-8.8,Math.PI/2);sign(HALF-.02,floorY(4.2)+2.7,4.2,-Math.PI/2);
 for(const s of[-1,1]){box(.08,2.1,1,M(0x6f625d,{roughness:.6,metalness:.2}),s*(HALF-.05),1.05,-10.4);
  const e=new THREE.Group(),top=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.1,8),dark);top.position.y=.23;e.add(new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,.36,12),M(0xd02222,{roughness:.4})),top);e.position.set(s*(HALF-.12),1.2,-9.1);scene.add(e);
  sign(s*(HALF-.02),2.45,-10.4,-s*Math.PI/2)}

 /* ---------- lights ---------- */
 const hemi=new THREE.HemisphereLight(0xffe0c8,0x2e1a16,.7);scene.add(hemi);
 const spot=new THREE.SpotLight(0xffe2bf,60,32,1.1,.6,1);spot.position.set(0,6.9,1.2);spot.target.position.set(0,1,0);spot.castShadow=true;spot.shadow.mapSize.set(1024,1024);spot.shadow.bias=-.0005;scene.add(spot,spot.target);
 const glow=new THREE.PointLight(0xffe0cc,0,26,1.4);glow.position.set(0,3.5,SCREEN_Z+2);scene.add(glow);

 /* ---------- screen ---------- */
 const SW=1280,SH=560,cvs=mkCanvas(SW,SH),cx=cvs.getContext('2d'),stex=new THREE.CanvasTexture(cvs);stex.colorSpace=THREE.SRGBColorSpace;
 const screenMat=new THREE.MeshBasicMaterial({map:stex,toneMapped:false}),screen=new THREE.Group();screen.position.set(0,SCREEN_Y,SCREEN_Z);scene.add(screen);
 const SIZES={std:[9.6,4.2,0],imax:[10.6,5,0],curved:[10.2,4.4,.7],mini:[6,3.2,0]};
 const plane=(w,h,c,m,z)=>{const g=new THREE.PlaneGeometry(w,h,40,1),p=g.attributes.position;for(let i=0;i<p.count;i++)p.setZ(i,c?Math.pow(p.getX(i)/5,2)*c:0);g.computeVertexNormals();const k=new THREE.Mesh(g,m);k.position.z=z;return k};
 let kind='std',dims=[9.6,4.2];const setScreen=(k,asp)=>{kind=k;let[w,h,c]=SIZES[k];if(asp){h=Math.min(4.6,10.2/asp);w=h*asp}dims=[w,h];screen.clear();screen.add(plane(w+.2,h+.2,c,new THREE.MeshBasicMaterial({color:0x1a0f0d}),-.04),plane(w,h,c,screenMat,0))};setScreen('std');
 // curtains are gone in this theatre; the groups stay so the open/close animation is a harmless no-op
 const cL=new THREE.Group(),cR=new THREE.Group();

 /* ---------- seats ---------- */
 const rbs=sg=>(w,h,d,r,x,y,z,rx=0)=>{const g=new RoundedBoxGeometry(w,h,d,sg,r);if(rx)g.rotateX(rx);g.translate(x,y,z);return g};
 const rb=rbs(2),rbd=rbs(1);   // seat bevels: 2 segments on the big cushions, 1 on the tiny frame bars (looks identical, ~5x fewer triangles per seat)
 const cushGeo=mergeGeometries([rb(.52,.13,.5,.05,0,.47,-.03),rb(.52,.8,.13,.06,0,.98,.27,.13),rb(.42,.24,.15,.06,0,1.38,.32,.13)]);
 const darkGeo=mergeGeometries([rbd(.07,.07,.56,.025,-.3,.66,-.02),rbd(.07,.07,.56,.025,.3,.66,-.02),rbd(.06,.2,.1,.02,-.3,.54,.2),rbd(.06,.2,.1,.02,.3,.54,.2),rbd(.12,.42,.24,.03,0,.21,.14),rbd(.1,.04,.66,.015,0,.02,0)]);
 const redBase=M(0xa51d1d,{roughness:.9,bumpMap:bumpS,bumpScale:.25}),greyBase=M(0x453e3c,{roughness:.9,bumpMap:bumpS,bumpScale:.25});
 const darkParts=[],seats=new Map(),boxes=[],taken=new Set(['A3','A13','B2','B6','B13','C5','C10','C14','D3','D9','D12','E4','E12','F2','F7','F14','G3','G10','H6','H9','H13','I4','I8','I12']),picks=[];
 for(let r=0;r<NROWS;r++)for(let c=0;c<COLS;c++){
  const id=ROWS[r]+(c+1),x=seatX(c),z=rowZ(r),y=floorY(z),g=new THREE.Group(),red=c<3||c>11||r===0||r===NROWS-1,cushMat=(red?redBase:greyBase).clone();
  const a=new THREE.Mesh(cushGeo,cushMat);a.castShadow=a.receiveShadow=true;a.userData.seatId=id;g.add(a);picks.push(a);darkParts.push(darkGeo.clone().translate(x,y,z));
  g.position.set(x,y,z);scene.add(g);
  seats.set(id,{id,group:g,cushMat,x,z,y,row:r,col:c,pos:new THREE.Vector3(x,y,z),aisle:new THREE.Vector3(x,floorY(z-.55),z-.55)});
  boxes.push({x0:x-.33,x1:x+.33,z0:z-.22,z1:z+.35})}

 {const all=new THREE.Mesh(mergeGeometries(darkParts),dark);all.castShadow=all.receiveShadow=true;scene.add(all);darkParts.forEach(g=>g.dispose())}   // 135 frames, 1 draw call

 /* ---------- lobby (outside the door) ---------- */
 const y0=floorY(DOOR_Z),DW=.8,lobby=buildLobby(scene,{y0,DOOR_Z});
 const sc=mkCanvas(512,96),sx=sc.getContext('2d');sx.fillStyle='#fff3e6';sx.shadowColor='#ff6a4a';sx.shadowBlur=18;sx.font='bold 52px system-ui';sx.textAlign='center';sx.fillText('TWIN CINEMA’S',256,66);
 const lsign=new THREE.Mesh(new THREE.PlaneGeometry(3.2,.6),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(sc),transparent:true}));lsign.position.set(0,y0+3.3,DOOR_Z+.06);scene.add(lsign);
 /* double PUSH door (the doorway between the lobby and the hall). Two hinged leaves: walnut, raised panels, a glass vision panel, steel PUSH plates + kick plates on BOTH faces, three hinges each.
    A push swings them open (they spring up to the door stop with a small bounce); a door closer then swings them shut slowly and they latch with a soft knock. See doorTo / doorTick below. */
 const LW_=DW-.02,OPEN=1.75,door=new THREE.Group();
 const wood=M(0x4b2a1d,{roughness:.55,metalness:.05}),woodHi=M(0x60381f,{roughness:.5}),steel=M(0xc4c8cd,{roughness:.3,metalness:.55}),
  glass=new THREE.MeshStandardMaterial({color:0xa9cfe6,roughness:.08,metalness:.1,transparent:true,opacity:.3,depthWrite:false});
 const plateMat=(()=>{const c=mkCanvas(128,384),g=c.getContext('2d'),gr=g.createLinearGradient(0,0,128,0);gr.addColorStop(0,'#aeb2b8');gr.addColorStop(.5,'#e6e8ec');gr.addColorStop(1,'#a3a7ad');g.fillStyle=gr;g.fillRect(0,0,128,384);
  g.fillStyle='#30343b';g.font='bold 33px system-ui';g.textAlign='center';g.fillText('PUSH',64,74);g.fillRect(30,98,68,3);g.fillRect(30,300,68,3);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshStandardMaterial({map:t,roughness:.35,metalness:.3})})();
 const mkLeaf=side=>{                                                                   // side -1 = left leaf (hinge at the left jamb), +1 = right leaf
  const piv=new THREE.Group(),slab=new THREE.Group();piv.position.set(side*(DW-.014),0,0);slab.position.x=-side*LW_/2;piv.add(slab);
  const part=(w,h,d,m,x,y,z,to=slab)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=m!==glass;to.add(o);return o},T=.06;
  part(LW_,1.39,T,wood,0,-.495,0);part(LW_,.19,T,wood,0,1.095,0);                       // lower body + top rail
  for(const e of[-1,1])part(.12,.8,T,wood,e*(LW_/2-.06),.6,0);                          // stiles beside the glass
  part(LW_-.24,.8,.012,glass,0,.6,0);
  for(const f of[1,-1]){const z=f*(T/2+.004);                                           // f = +1 lobby face, -1 hall face (both get the same fittings)
   part(LW_-.2,.42,.008,woodHi,0,-.72,z);                                               // raised lower panel
   part(LW_-.24,.026,.012,steel,0,1.0,z);part(LW_-.24,.026,.012,steel,0,.2,z);          // window trim
   for(const e of[-1,1])part(.026,.8,.012,steel,e*(LW_/2-.12),.6,z);
   part(LW_-.02,.22,.008,steel,0,-1.08,z);                                              // kick plate
   part(.15,.5,.012,plateMat,-side*(LW_/2-.13),-.2,z*1.18)}
  for(const e of[-1,1])part(.03,.05,.05,steel,e*(LW_/2-.1),-.12,-(T/2+.03));part(LW_-.14,.06,.04,steel,0,-.12,-(T/2+.052));   // hall face: a proper push bar across the leaf (the way out)                             // PUSH plate near the free edge, at hand height
  for(const y of[-.9,.1,.95]){const h=new THREE.Mesh(new THREE.CylinderGeometry(.02,.02,.12,10),steel);h.position.set(0,y,0);piv.add(h)}   // hinges
  door.add(piv);return piv};
 const leaves=[mkLeaf(-1),mkLeaf(1)];
 door.position.set(0,y0+1.2,DOOR_Z-.06);scene.add(door);
 {const H=CEIL0+.1,sh=new THREE.Shape();sh.moveTo(-HALF,0);sh.lineTo(HALF,0);sh.lineTo(HALF,H);sh.lineTo(-HALF,H);sh.closePath();   // hall back wall: same doorway as the lobby side, so there is NO wall behind the door any more
  const h=new THREE.Path();h.moveTo(-DW,y0);h.lineTo(DW,y0);h.lineTo(DW,y0+2.4);h.lineTo(-DW,y0+2.4);h.closePath();sh.holes.push(h);
  const bw=new THREE.Mesh(new THREE.ShapeGeometry(sh),backWall);bw.position.z=DOOR_Z-.004;scene.add(bw)}
 for(const e of[-1,1])box(.05,2.46,.1,dark,e*(DW+.045),y0+1.23,DOOR_Z-.1);box(DW*2+.14,.1,.1,dark,0,y0+2.45,DOOR_Z-.1);   // trim round the doorway on the hall side
 const OPEN_LOBBY=1.5;let dA=0,dV=0,dMode='shut',dDir=1,dLast=-1,dOpen=OPEN;                                           // angle (0 closed .. OPEN), speed, what it is doing, which way it swings (+1 into the hall, -1 into the lobby)
 const setLeaves=a=>{leaves[0].rotation.y=a*dDir;leaves[1].rotation.y=-a*dDir};
 box(.7,.22,.06,new THREE.MeshBasicMaterial({color:0x3dff7a}),0,y0+2.95,DOOR_Z+.1);
 sign(0,y0+2.75,DOOR_Z-.03,Math.PI);

 const push=(p,r,b)=>{const cx2=cl(p.x,b.x0,b.x1),cz=cl(p.z,b.z0,b.z1),dx=p.x-cx2,dz=p.z-cz,d=Math.hypot(dx,dz);if(d<r){if(d>1e-4){p.x=cx2+dx/d*r;p.z=cz+dz/d*r}else p.z=b.z0-r}};
 const api={lobby,lobbyMode:false,discs:[],dims:()=>dims,seats,taken,door,screen,cL,cR,picks,floors:[flat,...treads],setScreen,fitScreen:a=>setScreen(kind,a),setScreenMap(t){screenMat.map=t||stex;screenMat.needsUpdate=true},sizes:Object.keys(SIZES),
  /** push the door open (dir +1 swings into the hall when you push from the lobby, -1 swings into the lobby when you push from the hall) or let the closer shut it. doorTick(dt) must run every frame. */
  doorTo(open,dir=1){if(open){if(dMode!=='open'){if(dA<.02){dDir=dir>=0?1:-1;dOpen=dDir>0?OPEN:OPEN_LOBBY}dMode='open';dV=Math.max(dV,2.6)}}else{dMode='shut';dV=0}},
  doorTick(dt){dt=Math.min(dt,.05);
   if(dMode==='open'){dV+=((dOpen-dA)*24-dV*7)*dt;dA+=dV*dt;if(dA>dOpen){dA=dOpen;dV=-Math.abs(dV)*.3}}                       // pushed: fast start, eases onto the door stop, tiny bounce
   else if(dA>0){dA-=Math.max(.3,Math.min(1.3,dA*1.8))*dt;dV=0;if(dA<=0){dA=0;api.onDoorShut?.()}}                          // door closer: steady, slows down for the last bit, then latches
   if(dA!==dLast){dLast=dA;setLeaves(dA)}},
  doorAngle:()=>dA,doorDir:()=>dDir,doorOpenAngle:()=>dOpen,onDoorShut:null,
  setDoor(u){dMode=u>0?'open':'shut';dA=u*dOpen;dV=0;setLeaves(dA)},
  /** house=1 full lights, 0.07 movie dark */
  setLights(v){lobby.setLights(v);hemi.intensity=.06+.64*v;spot.intensity=60*v;lamps.forEach(l=>l.intensity=.7*v);bayLights.forEach(l=>l.intensity=9*v);warm.emissiveIntensity=.12+.88*v;washMats.forEach(m=>m.opacity=.1+.8*v);
   stepMat.emissiveIntensity=.5+.8*v;dlMat.color.setScalar(.2+.8*v);scene.environmentIntensity=.05+.3*v;glow.intensity=6*(1-v)},
  /** inHall: the lobby lights are switched off once you are inside (fewer lights for the GPU to loop over every pixel) */
  setRoom(inHall){lobby.setOn(!inHall)},
  setCurtains(o){cL.scale.x=cR.scale.x=1-.93*o},
  setSeatHighlight(id,hex){const s=seats.get(id);if(s){s.cushMat.emissive.setHex(hex||0);s.cushMat.emissiveIntensity=hex?.7:1}},
  drawScreen(t,playing,prog=0){const g=cx.createRadialGradient(SW/2,SH/2,30,SW/2,SH/2,SW*.62);
   if(playing){g.addColorStop(0,'#4a2226');g.addColorStop(1,'#120708')}else{g.addColorStop(0,'#fff3ea');g.addColorStop(1,'#f1cdbb')}
   cx.fillStyle=g;cx.fillRect(0,0,SW,SH);cx.textAlign='center';
   cx.shadowColor=playing?'#ff6a4a':'transparent';cx.shadowBlur=playing?30:0;cx.fillStyle=playing?'#fff':'#8a3a32';cx.font='bold 84px system-ui';cx.fillText('TWIN CINEMA’S',SW/2,270);
   cx.shadowBlur=0;cx.font='30px system-ui';cx.fillStyle=playing?'#e8c9c0':'#a8625a';cx.fillText(playing?'▶ Demo movie · choose a video file for the real thing':'Choose your seats ♥',SW/2,336);
   if(playing||prog>0){cx.fillStyle=playing?'#fff3':'#8a3a3233';cx.fillRect(140,500,1000,6);cx.fillStyle='#ff6a4a';cx.fillRect(140,500,1000*prog,6)}
   cx.fillStyle='#e0504a';cx.font='40px serif';cx.fillText('♥',SW/2+Math.sin(t*2)*70,420+Math.cos(t*3)*8);stex.needsUpdate=true},
  /** walking route to a seat: sideways to the nearest aisle, along the aisle, then along the row gap */
  route(p,seat){const side=Math.abs(seat.x)>.35?Math.sign(seat.x):(p.x<0?-1:1),ax=side*AISLE_X,pts=[];if(Math.abs(p.x-ax)>.3)pts.push([ax,p.z]);pts.push([ax,seat.aisle.z],[seat.x,seat.aisle.z]);return pts},
  /** keep a point (radius r) inside the hall and out of seat blocks */
  resolve(p,r=.25,zMax=DOOR_Z-.4){if(api.lobbyMode){p.x=cl(p.x,-LW+.5,LW-.5);p.z=cl(p.z,DOOR_Z+.9,DOOR_Z+LD-.5);for(const b of lobby.boxes)push(p,r,b);
   for(const d of api.discs){const dx=p.x-d.x,dz=p.z-d.z,rr=d.r+r,q=dx*dx+dz*dz;if(q<rr*rr&&q>1e-6){const k=rr/Math.sqrt(q);p.x=d.x+dx*k;p.z=d.z+dz*k}}   // the lobby crowd (see crowd.js) is solid
   return}
   p.x=cl(p.x,-HALF+.3,HALF-.3);p.z=cl(p.z,FRONT_Z+1,zMax);for(const b of boxes)push(p,r,b)}};
 return api}
