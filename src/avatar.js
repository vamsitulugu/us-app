import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {applyLook,randomLook} from './look.js';
/** Rigged (Mixamo-style) avatars with procedural walk / sit / stand poses. No animation clips needed. */
const V=(x,y,z)=>new THREE.Vector3(x,y,z),wp=o=>o.getWorldPosition(new THREE.Vector3()),YA=V(0,1,0);
const NAMES=['LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','Spine','Spine1','Spine2','Neck','Head','LeftToeBase','RightToeBase'];
const FILES={cf:import.meta.env.BASE_URL+'models/couple_f.glb',cm:import.meta.env.BASE_URL+'models/couple_m.glb',ma:import.meta.env.BASE_URL+'models/aud_a.glb',fa:import.meta.env.BASE_URL+'models/aud_b.glb',fb:import.meta.env.BASE_URL+'models/aud_c.glb',rpm:import.meta.env.BASE_URL+'models/avatar_m.glb',fc:import.meta.env.BASE_URL+'models/aud_f.glb',mb:import.meta.env.BASE_URL+'models/aud_m.glb'};
/** cf/cm = the couple's own MetaPerson avatars (Person 1 / Person 2). ma/fa/fb/rpm/fc/mb + extra = audience + lobby crowd bases (never the couple's own faces). */
export const loadAvatars=async(progress)=>{const L=new GLTFLoader(),keys=Object.keys(FILES),p=keys.map(()=>0),rep=()=>progress?.(p.reduce((a,b)=>a+b,0)/keys.length),
 ld=(u,i)=>L.loadAsync(u,e=>{if(e.total){p[i]=e.loaded/e.total;rep()}}).then(g=>(p[i]=1,rep(),g));
 const out=await Promise.all(keys.map((k,i)=>ld(FILES[k],i))),gl={};keys.forEach((k,i)=>gl[k]=out[i]);
 gl.extra={f:[],m:[]};try{const idx=await(await fetch(import.meta.env.BASE_URL+'models/audience/index.json')).json();   // optional: more MetaPerson avatars dropped in /public/models/audience
  for(const g of['f','m'])for(const f of idx[g]||[]){try{gl.extra[g].push(await L.loadAsync(import.meta.env.BASE_URL+'models/audience/'+f))}catch{}}}catch{}
 return gl};
const _a1=new THREE.Vector3(),_a2=new THREE.Vector3(),_a3=new THREE.Vector3(),_qA=new THREE.Quaternion(),_qB=new THREE.Quaternion(),_qC=new THREE.Quaternion();
/** point bone b so that the direction b->c matches d. Uses shared scratch objects: no garbage per frame. */
function aim(b,c,d){b.updateWorldMatrix(true,true);c.getWorldPosition(_a1);b.getWorldPosition(_a2);_a1.sub(_a2).normalize();b.getWorldQuaternion(_qA);
 _qB.setFromUnitVectors(_a1,_a3.copy(d).normalize());b.parent.getWorldQuaternion(_qC).invert();b.quaternion.copy(_qC.multiply(_qB.multiply(_qA)));b.updateWorldMatrix(false,true)}
/** ring of reusable vectors for the per-frame pose directions (aim() consumes each one immediately) */
const VT=(()=>{const p=Array.from({length:96},()=>new THREE.Vector3());let i=0;return(x,y,z)=>p[i++%96].set(x,y,z)})();
/** opts: height (m), look (see look.js: per-part recolour), hide (mesh names), walker (can walk), seated (start seated, e.g. audience), headScale (number or [x,y,z]), relaxed (straight legs, straight arms: use for the couple), shadow (cast shadows, default true)
    Lobby body language (walkers only): av.act = 'talk' | 'talk2' | 'phone' | 'carry' | 'hand' | 'scoop' | 'pour' | 'type' | 'wipe' | 'push' | ''  ·  av.talk = 1 moves the mouth  ·  av.tly / av.tlp = look left-right / up-down (-1..1)  ·  av.wear(obj,'Head',[x,y,z]) fixes a prop to a bone (offset in metres) */
export function makeAvatar(gltf,{height=1.7,look,hide=[],walker=false,seated=false,headScale=1,relaxed=false,style='',shadow=true}={}){
 const m=clone(gltf.scene),group=new THREE.Group();group.add(m);const _q=new THREE.Quaternion(),_ad=new THREE.Vector3(),A=(b,c,d)=>aim(b,c,_ad.copy(d).applyQuaternion(group.getWorldQuaternion(_q)));   // pose directions are in the avatar's own frame, so limbs follow its facing
 const bn=n=>m.getObjectByName('mixamorig'+n)||m.getObjectByName(n),B={};NAMES.forEach(n=>B[n]=bn(n));const hips=bn('Hips');
 group.updateMatrixWorld(true);const ff=()=>(wp(B.LeftFoot).y+wp(B.RightFoot).y)/2;
 m.scale.multiplyScalar((height-.3)/(wp(B.Head).y-ff()));group.updateMatrixWorld(true);m.position.y-=ff()-.08;group.updateMatrixWorld(true);
 if(look)applyLook(m,look);
 m.traverse(k=>{if(k.isMesh){k.castShadow=shadow;k.receiveShadow=true;k.frustumCulled=false;if(hide.includes(k.name))k.visible=false;if(/Cornea/i.test(k.name))k.visible=false;
  else if(k.material.transparent&&!look){k.material=k.material.clone();k.material.transparent=false;k.material.alphaTest=.45;k.material.depthWrite=true}}});   // hair cards: alpha-test instead of blending (no sorting artefacts)
 const all=NAMES.map(n=>B[n]).concat([hips]),rest=all.map(b=>[b.quaternion.clone(),b.position.clone()]);
 const side=n=>Math.sign(wp(B[n+'UpLeg']).x-wp(hips).x)||1,sg={Left:side('Left'),Right:side('Right')};
 ['Left','Right'].forEach(S=>{const k=sg[S];A(B[S+'UpLeg'],B[S+'Leg'],V(.05*k,-.02,1));A(B[S+'Leg'],B[S+'Foot'],V(0,-1,.04));A(B[S+'Arm'],B[S+'ForeArm'],V(.12*k,-1,.1));A(B[S+'ForeArm'],B[S+'Hand'],V(.08*k,-.45,.9))});
 const hw=wp(hips).add(V(0,.08-ff(),0));hw.y=Math.max(hw.y,.58);hips.position.copy(hips.parent.worldToLocal(hw));
 const sb=all.map(b=>({b,q:b.quaternion.clone()})),hsit=hips.position.clone(),hrest=rest[all.length-1][1].clone();
 all.forEach((b,i)=>b.quaternion.copy(rest[i][0]));hips.position.copy(hrest);
 const wb=all.map((b,i)=>[b,rest[i][0]]),my=m.position.y,leg=wp(B.LeftUpLeg).y-wp(B.LeftFoot).y,headQ=sb.find(s=>s.b===B.Head).q,seed=Math.random()*9,yq=new THREE.Quaternion();
 if(Array.isArray(headScale))B.Head.scale.set(...headScale);else if(headScale!==1)B.Head.scale.setScalar(headScale);
 const ST={m:{sw:.4,as:.42,hy:.1,tw:.3,roll:.05,lean:.03,bend:.38,cad:6,bob:.014,chest:.025},f:{sw:.36,as:.3,hy:.18,tw:.26,roll:.09,lean:.02,bend:.3,cad:5.8,bob:.01,chest:.012}}[style],
  P={...(relaxed?{knee:.015,fore:.08,spread:.05,sw:.36,lift:.5,as:.5}:{knee:.12,fore:.5,spread:.12,sw:.46,lift:.75,as:.4}),...(ST?{sw:ST.sw,as:ST.as,lift:.55,spread:.07}:{})},_e=new THREE.Euler(0,0,0,'YXZ'),_r=new THREE.Quaternion(),_g=new THREE.Quaternion(),_p=new THREE.Quaternion(),_Rw=new THREE.Quaternion(),_gi=new THREE.Quaternion(),_pi=new THREE.Quaternion();
 /** rotate bone b by an (x pitch, y yaw, z roll) turn measured in the avatar's own frame (so it works whatever way it faces) */
 const rotW=(b,x,y,z)=>{group.getWorldQuaternion(_g);_r.setFromEuler(_e.set(x,y,z));_gi.copy(_g).invert();_Rw.copy(_g).multiply(_r).multiply(_gi);b.parent.getWorldQuaternion(_p);_pi.copy(_p).invert().multiply(_Rw).multiply(_p);b.quaternion.premultiply(_pi);b.updateWorldMatrix(false,true)};
 /** stylish body language: pelvis sway, counter-twisting shoulders, steady head, soft weight shift when idle */
 const stylePose=(a,t,ph)=>{const s=Math.sin(ph),c=Math.cos(ph),id=1-a,w=Math.sin(t*.55+seed),h=Math.sin(t*.33+seed*2);
  rotW(hips,ST.lean*a,-ST.hy*s*a,ST.roll*s*a+.03*w*id);
  rotW(B.Spine,ST.lean*.5*a-.01*id,ST.tw*.25*s*a,-ST.roll*.5*s*a-.02*w*id);
  rotW(B.Spine1,ST.lean*.3*a+ST.chest*id*Math.sin(t*1.6+seed),ST.tw*.35*s*a,-ST.roll*.3*s*a);
  rotW(B.Spine2,ST.lean*.2*a,ST.tw*.4*s*a,-ST.roll*.2*s*a);
  rotW(B.Neck,-ST.lean*.8*a,.3*(-ST.hy+ST.tw)*s*a*-1,0);
  rotW(B.Head,-ST.lean*.6*a,(.12*h+.05*Math.sin(t*.9+seed))*id,.04*h*id)};
/* ---- lobby body language: hand gestures / props poses, talking mouth, where the head looks, things worn on a bone ---- */
 const jaw=[];m.traverse(k=>{if(k.isMesh&&k.morphTargetDictionary){const d=k.morphTargetDictionary,i=d.jawOpen??d.mouthOpen;if(i!==undefined)jaw.push([k,i])}});
 /* lip-sync shapes (MetaPerson / Ready Player Me visemes) + a smile; avatars that only have a mouth-open shape still move their mouth through the jaw above */
 const VIS=['viseme_aa','viseme_O','viseme_E','viseme_I','viseme_U','viseme_PP','viseme_FF','viseme_DD','viseme_nn'],vis=[],smi=[];
 m.traverse(k=>{if(k.isMesh&&k.morphTargetDictionary){const d=k.morphTargetDictionary;VIS.forEach(n=>{if(d[n]!==undefined)vis.push({k,i:d[n],v:0,n})});['mouthSmile','mouthSmileLeft','mouthSmileRight'].forEach(n=>{if(d[n]!==undefined)smi.push([k,d[n]])})}});
 let vT=0,vCur=-1,sm=0;
 /** one arm: upper arm direction u and forearm direction f, in the avatar's own frame (x is out to the side for that arm, y up, z forward) */
 const arm=(S,ux,uy,uz,fx,fy,fz)=>{const k=sg[S];A(B[S+'Arm'],B[S+'ForeArm'],VT(ux*k,uy,uz));A(B[S+'ForeArm'],B[S+'Hand'],VT(fx*k,fy,fz))};
 const sn=Math.sin,ACT={
  talk:t=>arm('Right',.3,-.6+.1*sn(t*2.3+seed),.5,-.2+.25*sn(t*3.7+seed),.55+.3*sn(t*5.1+seed),.8),
  talk2:t=>{arm('Left',.28,-.65+.1*sn(t*2.1+seed),.5,-.25+.2*sn(t*3.3+seed),.5+.25*sn(t*4.7),.8);arm('Right',.3,-.6+.1*sn(t*2.6+seed),.5,-.2+.2*sn(t*3.9+seed),.5+.25*sn(t*5.3),.8)},
  phone:t=>{arm('Right',.15,-.6,.55,-.3+.04*sn(t*1.7+seed),.9,.35);arm('Left',.1,-.95,.15,-.4,-.25,.9)},
  carry:()=>{arm('Left',.12,-.9,.4,-.5,-.15,.85);arm('Right',.12,-.9,.4,-.5,-.15,.85)},
  hand:t=>{const s=.06*sn(t*4);arm('Left',.1,-.5,.8,-.15,.05+s,1);arm('Right',.1,-.5,.8,-.15,.05+s,1)},
  scoop:t=>{arm('Right',.5,-.45,.65,.25,-.3+.55*sn(t*4.5),.9);arm('Left',.15,-.55,.75,-.2,.0,1)},
  pour:t=>{arm('Left',.15,-.5,.8,-.2,.1,1);arm('Right',.15,-.45,.8,-.1,-.3+.25*sn(t*3),1)},
  type:t=>{arm('Left',.15,-.8,.5,-.2,-.5+.12*sn(t*9),.9);arm('Right',.15,-.8,.5,-.2,-.5+.12*sn(t*9+2),.9)},
  wipe:t=>arm('Right',.2,-.55,.75,-.4+.9*sn(t*4),-.45,.8),
  push:t=>{const s=.03*sn(t*3.1);arm('Left',.16,-.38,.85,-.06,.32+s,.95);arm('Right',.16,-.38,.85,-.06,.32-s,.95)}};
 let ly=0,lp=0,tk=0;
 const bodyLang=(dt,t)=>{const f=ACT[av.act];if(f)f(t);const a=Math.min(1,dt*6);ly+=(av.tly-ly)*a;lp+=(av.tlp-lp)*a;
  if(Math.abs(ly)>.004||Math.abs(lp)>.004){rotW(B.Neck,lp*.35,ly*.3,0);rotW(B.Head,lp*.55,ly*.55,0)}};
 const _wv=new THREE.Vector3(),_wq=new THREE.Quaternion(),_gq=new THREE.Quaternion();
 const wear=(obj,bone,off=[0,0,0])=>{const b=B[bone];if(!b)return;group.updateMatrixWorld(true);const h=new THREE.Group();b.add(h);
  b.getWorldScale(_wv);h.scale.set(1/_wv.x,1/_wv.y,1/_wv.z);                                    // 1 unit = 1 metre, whatever the rig's own scale
  b.getWorldQuaternion(_wq);group.getWorldQuaternion(_gq);h.quaternion.copy(_wq.invert().multiply(_gq));   // faces the way the avatar faces, whatever the bone axes
  b.getWorldPosition(_wv).add(new THREE.Vector3(off[0],off[1],off[2]).applyQuaternion(_gq));h.position.copy(b.worldToLocal(_wv));h.add(obj)};

 /* ---- SEATED CHAT (audience): while talking the person gestures with their hands, nods and turns their head toward who they talk to; while listening they look at the speaker, nod and smile.
        Poses are blended in and out (cw 0..1) over the normal seated pose, so nobody snaps. Set av.speak / av.listen / av.gaze (yaw, rad) / av.gest ('talk'|'talk2'); see seatedChatter() below. ---- */
 const SB=new Map(sb.map(x=>[x.b,x.q])),CB=[B.LeftArm,B.LeftForeArm,B.RightArm,B.RightForeArm,B.Spine2,B.Neck,B.Head],CQ=CB.map(()=>new THREE.Quaternion());let cw=0,gz=0,nodK=0;
 const chatPose=(dt,t,want)=>{
  cw+=(want-cw)*Math.min(1,dt*3.5);gz+=(av.gaze-gz)*Math.min(1,dt*3);
  if(cw<.004){if(cw>0){cw=0;CB.forEach(b=>b.quaternion.copy(SB.get(b)));B.Head.quaternion.copy(headQ)}return false}
  const sp=av.speak,s1=sn(t*2.1+seed),s2=sn(t*3.3+seed*1.7),s3=sn(t*5.1+seed);
  CB.forEach(b=>b.quaternion.copy(SB.get(b)));                                   // start from the seated pose
  B.Head.quaternion.copy(headQ).multiply(yq.setFromAxisAngle(YA,sn(t*.6+seed)*.3*(1-cw)));
  if(sp){                                                                         // hands: slow, small, simple. The forearm lifts a little while a sentence is going and rests again between sentences
   const e=.5+.5*sn(t*.42+seed*2),w=sn(t*.75+seed),w2=sn(t*.6+seed*1.3+1.7),up=.15+.3*e*(.6+.4*w);
   arm('Right',.2,-.82+.05*w,.38,-.12+.07*w2,up,.9);
   if(av.gest==='talk2')arm('Left',.2,-.84+.04*w2,.36,-.12+.06*w,.12+.26*e*(.6+.4*w2),.9)}
  const g=Math.max(-1.1,Math.min(1.1,gz));
  rotW(B.Spine2,.02*s1,g*.22,0);                                                  // shoulders turn a little toward the other person
  const nod=sp?.045*sn(t*1.7+seed)+.03*Math.max(0,sn(t*.8+seed)):.08*Math.max(0,sn(t*.9+seed))*Math.max(0,sn(t*.37+seed));   // speaker: rhythm nods; listener: slow agreeing nods
  rotW(B.Neck,nod*.4,g*.35,(sp?.02:.04)*s1);rotW(B.Head,nod*.6,g*.5,(sp?.02:.04)*s2);
  CB.forEach((b,i)=>{CQ[i].copy(b.quaternion);b.quaternion.copy(SB.get(b)).slerp(CQ[i],cw)});   // blend with the seated pose
  return true};
 let lastPose=-1;const av={group,sit:seated?1:0,walk:0,amp:0,ph:0,wave:0,act:'',talk:0,tly:0,tlp:0,wear,speak:false,listen:false,gaze:0,gest:'talk',emote(n){if(n==='wave')av.wave=2.2},
  walkPose(t=0){wb.forEach(([b,q])=>b.quaternion.copy(q));const a=av.amp;if(ST)stylePose(a,t,av.ph);
   ['Left','Right'].forEach((n,i)=>{const f=av.ph+i*Math.PI,k=sg[n],th=P.sw*a*Math.sin(f),ps=th-(P.knee+P.lift*a*Math.max(0,Math.cos(f))),al=-P.as*a*Math.sin(f);
    A(B[n+'UpLeg'],B[n+'Leg'],VT(.03*k,-Math.cos(th),Math.sin(th)));A(B[n+'Leg'],B[n+'Foot'],VT(0,-Math.cos(ps),Math.sin(ps)));A(B[n+'Foot'],B[n+'ToeBase'],VT(0,-.1,1));
    A(B[n+'Arm'],B[n+'ForeArm'],VT(P.spread*k,-Math.cos(al),Math.sin(al)));A(B[n+'ForeArm'],B[n+'Hand'],VT((P.spread*.6)*k,-Math.cos(al+P.fore+(ST?ST.bend*a*Math.max(0,-Math.sin(f))+.12*a:0)),Math.sin(al+P.fore+(ST?ST.bend*a*Math.max(0,-Math.sin(f))+.12*a:0))))});
   m.position.y=my-leg*a*(1-Math.cos(P.sw*Math.abs(Math.sin(av.ph))))+(ST?ST.bob*a*Math.cos(2*av.ph):0)},
  update(dt,t){if(walker){av.amp+=((av.walk&&av.sit<.5?1:0)-av.amp)*Math.min(1,dt*8);av.ph+=dt*(ST?ST.cad:6.8)*av.amp;if(av.sit<1&&(av.amp>.02||av.walk||av.sit>0||t-lastPose>.045||t<lastPose)){lastPose=t;av.walkPose(t);bodyLang(dt,t)}   // only a fully idle, standing avatar is refreshed at ~22 Hz
    hips.position.copy(hrest).lerp(hsit,av.sit);if(av.sit>0)for(const s of sb)s.b.quaternion.slerp(s.q,av.sit)}
   const mouthOn=av.talk||av.speak;
   if(jaw.length&&(mouthOn||tk>.002)){const v=mouthOn?.1+.3*Math.abs(sn(t*9+seed))*(.55+.45*sn(t*2.3+seed)):0;tk+=(v-tk)*Math.min(1,dt*18);for(const j of jaw)j[0].morphTargetInfluences[j[1]]=tk}
   if(vis.length&&(mouthOn||vT>.002||vCur>=0)){   // syllable-by-syllable mouth shapes: a new vowel / consonant every ~0.1-0.2 s, with short pauses between phrases
    const ph=sn(t*1.3+seed*3)>-.55;vT-=dt;if(vT<=0){vT=.09+Math.random()*.11;vCur=mouthOn&&ph?(Math.random()*vis.length|0):-1}
    for(let i=0;i<vis.length;i++){const q=vis[i],tg=mouthOn&&i===vCur?.45+.45*Math.abs(sn(t*7+i)):0;q.v+=(tg-q.v)*Math.min(1,dt*22);q.k.morphTargetInfluences[q.i]=q.v}
    if(!mouthOn&&vCur<0&&vis.every(q=>q.v<.003))vT=0}
   if(smi.length){const tg=av.listen&&sn(t*.5+seed*2)>.35?.45:av.speak?.2:0;sm+=(tg-sm)*Math.min(1,dt*3);for(const x of smi)x[0].morphTargetInfluences[x[1]]=sm}
   if(av.sit>.98){if(!(av.speak||av.listen||cw>.004)||!chatPose(dt,t,av.speak||av.listen?1:0))B.Head.quaternion.copy(headQ).multiply(yq.setFromAxisAngle(YA,Math.sin(t*.6+seed)*.3))}
   if(av.wave>0){av.wave-=dt;const k=sg.Right,s=Math.sin(t*11);A(B.RightArm,B.RightForeArm,VT(.55*k,.65,.25));A(B.RightForeArm,B.RightHand,VT((.2+.5*s)*k,.9,.15))}}};
 if(seated){sb.forEach(s=>s.b.quaternion.copy(s.q));hips.position.copy(hsit)}
 return av}
/** Fill the already-taken seats with a varied crowd. Never uses the couple's avatars: 4 different people models (+ any in /models/audience), shared out evenly, each with its own skin, hair, clothes, height and face proportions. */
export const CROWD_SHADOWS=false;   // the seated crowd is static: letting it cast shadows doubles the triangles the GPU draws for little visible gain
export function seatAudience(scene,hall,gl){const list=[],bases=[{g:gl.ma,k:'m'},{g:gl.fa,k:'f'},{g:gl.rpm,k:'rpm'},{g:gl.fb,k:'f',gl:1},...gl.extra.f.map(g=>({g,k:'f',x:1})),...gl.extra.m.map(g=>({g,k:'m',x:1}))];
 const seats=[...hall.taken].sort(()=>Math.random()-.5);let i=Math.random()*bases.length|0;
 seats.forEach(id=>{const s=hall.seats.get(id),b=bases[i++%bases.length],look=randomLook(b.k);if(b.x)look.skin=[1,1,1];
  const a=makeAvatar(b.g,{height:look.height,seated:true,look,headScale:look.head,hide:b.k==='rpm'?[...(look.capOn?[]:['Wolf3D_Headwear']),...(look.beard?[]:['Wolf3D_Beard'])]:b.gl&&Math.random()<.5?['Wolf3D_Glasses']:[]});
  a.group.position.copy(s.pos);a.group.rotation.y=Math.PI+(Math.random()-.5)*.12;if(!CROWD_SHADOWS)a.group.traverse(k=>{if(k.isMesh)k.castShadow=false});scene.add(a.group);list.push(a)});return list}

/** Gives the seated audience a social life. Each person is paired with their nearest neighbour (in the same or the next row); a pair now and then starts a chat:
    one talks (mouth shapes, hand gestures, nods, head turned to the other), the other listens (looks at them, nods, smiles), they swap turns a few times, then go quiet again.
    Never more than MAX_TALKERS people talk at once, and while the movie plays everyone watches the screen quietly (set QUIET_DURING_MOVIE=false to let them whisper). Call .update(dt,t,quiet) every frame. */
export const QUIET_DURING_MOVIE=true,MAX_TALKERS=6,CHAT_RANGE=3.4;
export function seatedChatter(list){
 const yawTo=(a,b)=>{const g=a.group,dx=b.group.position.x-g.position.x,dz=b.group.position.z-g.position.z,ry=g.rotation.y,lx=dx*Math.cos(ry)-dz*Math.sin(ry),lz=dx*Math.sin(ry)+dz*Math.cos(ry);return Math.atan2(lx,lz)};   // where the other person is, in my own frame
 const dist=(a,b)=>Math.hypot(a.group.position.x-b.group.position.x,(a.group.position.z-b.group.position.z)*1.4),pairs=[],seen=new Set();
 list.forEach((a,i)=>{let bj=-1,bd=CHAT_RANGE;list.forEach((b,j)=>{if(i===j)return;const d=dist(a,b);if(d<bd){bd=d;bj=j}});
  if(bj<0)return;const k=Math.min(i,bj)+'-'+Math.max(i,bj);if(seen.has(k))return;seen.add(k);pairs.push({a,b:list[bj],st:'rest',t:Math.random()*10,turns:0,who:0})});
 const clear=p=>{for(const x of[p.a,p.b]){x.speak=false;x.listen=false;x.gaze=0}};
 let wasQuiet=false;
 return{pairs,update(dt,t,quiet){
  const q=quiet&&QUIET_DURING_MOVIE;if(q){if(!wasQuiet){pairs.forEach(p=>{clear(p);p.st='rest';p.t=2+Math.random()*6})}wasQuiet=true;return}wasQuiet=false;
  let talking=pairs.filter(p=>p.st==='talk').length;
  for(const p of pairs){p.t-=dt;if(p.t>0)continue;
   if(p.st==='rest'){if(talking>=MAX_TALKERS){p.t=1+Math.random()*3;continue}
    p.st='talk';p.turns=2+(Math.random()*4|0);p.who=Math.random()<.5?0:1;talking++;p.t=2+Math.random()*3.5;
    const sp=p.who?p.b:p.a,ls=p.who?p.a:p.b;sp.speak=true;sp.listen=false;sp.gest=Math.random()<.5?'talk':'talk2';sp.gaze=yawTo(sp,ls)*.85;ls.listen=true;ls.speak=false;ls.gaze=yawTo(ls,sp)}
   else{p.turns--;
    if(p.turns<=0){clear(p);p.st='rest';p.t=6+Math.random()*14;talking--}
    else{p.who^=1;p.t=1.5+Math.random()*3.5;const sp=p.who?p.b:p.a,ls=p.who?p.a:p.b;sp.speak=true;sp.listen=false;sp.gest=Math.random()<.5?'talk':'talk2';sp.gaze=yawTo(sp,ls)*.85;ls.speak=false;ls.listen=true;ls.gaze=yawTo(ls,sp)}}}}}}
