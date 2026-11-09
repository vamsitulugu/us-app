import * as THREE from 'three';
import {makeAvatar} from './avatar.js';
import {crowdLook} from './look.js';

/* ------------------------------------------------------------------
   Lobby / canteen life. A believable foyer on a busy evening:
   - 2 canteen sellers in uniform behind the counter (greet you, scoop popcorn, pour drinks, hand over orders, work the till)
   - people queueing at both counters, being served, walking off with popcorn / drinks / ice cream
   - friends chatting in small circles (talking mouths, hand gestures, head turns, speech bubbles), going to buy snacks and coming back
   - visitors browsing the posters and menu, taking selfies at the standees, checking the time at the hall door
   - public-address announcements with a chime, crowd murmur, popcorn pops, the till bell
   The crowd only exists while you are in the lobby (hidden + not updated anywhere else), so it costs nothing during the movie.
   Everything is in lobby-local coordinates: x across, z from the hall door wall (0) to the back wall; the counter is at z ~ 11.7.
------------------------------------------------------------------- */
const rnd=(a,b)=>a+Math.random()*(b-a),pick=a=>a[Math.random()*a.length|0],wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),shuffle=a=>a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);

const LINES={
 chat:['Did you watch the trailer?','Row E is the best, always','I\'m so excited for this one!','Popcorn first, always','Which screen are we in?','No spoilers please!','The ending is supposed to be amazing','Let\'s grab drinks before it starts','This place smells like caramel','I booked the couple seats','Shh, it\'s about to start','Best date night ever','Have you seen her last film?','We\'re early, thank God','Want to share a large tub?'],
 order:['One large popcorn, please','Two cold coffees, please','Is the combo still on?','Extra butter please!','Caramel popcorn, please','A mango shake and nachos','Large cola, no ice'],
 sell:['Welcome! What can I get you?','Hello! Popcorn today?','Next please!','Hi there, what will it be?'],
 give:['Here you go, enjoy the show!','Fresh and hot!','Enjoy your movie!','Thank you, come again!'],
 hi:['Welcome to the canteen!','Hi you two! Popcorn for the movie?','Couple combos are on today!','Take your time, what would you like?'],
 coming:['Coming right up!','Fresh batch, one moment!','Just a minute!'],
 ready:['Here you go! Enjoy the show!','All set! Have a lovely time!','Your order is ready!'],
 pa:['Attention please: the next show is now open for seating at the main hall.','Couple combos are 20% off at the canteen counter!','Please keep your phones on silent during the movie. Thank you.','Reminder: no outside food or drinks inside the hall.','A pink umbrella has been left at the help desk.'],
};
const BASES=[['ma','m',2],['fa','f'],['fb','f'],['rpm','rpm'],['fc','f'],['mb','m']];   // [model key, kind, darkest skin index (models with painted-on hair)]

/* tiny carried props (shared geometry/materials; clones are free) */
const M=(c,o)=>new THREE.MeshStandardMaterial({color:c,roughness:.6,...o});
const PROPS=(()=>{const red=M(0xd8283c),wh=M(0xffffff),pop=M(0xfff0b8,{roughness:.9}),cup=M(0xf1f1f1,{roughness:.5}),pink=M(0xffc8dc),cone=M(0xd9a15a),bun=M(0xe8d9b0),meat=M(0xc98a45);
 const bucket=()=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.CylinderGeometry(.14,.1,.26,12),red));const st=new THREE.Mesh(new THREE.CylinderGeometry(.141,.101,.07,12),wh);st.position.y=.04;g.add(st);
  for(let i=0;i<7;i++){const s=new THREE.Mesh(new THREE.SphereGeometry(.065,6,5),pop);s.position.set(rnd(-.08,.08),.16+rnd(0,.05),rnd(-.08,.08));g.add(s)}return g};
 const drink=()=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.CylinderGeometry(.065,.05,.2,10),cup));const l=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.02,10),red);l.position.y=.11;g.add(l);return g};
 const ice=()=>{const g=new THREE.Group(),c=new THREE.Mesh(new THREE.ConeGeometry(.06,.18,10),cone);c.rotation.x=Math.PI;g.add(c);const s=new THREE.Mesh(new THREE.SphereGeometry(.08,10,8),pink);s.position.y=.14;g.add(s);return g};
 const food=()=>{const g=new THREE.Group(),b=new THREE.Mesh(new THREE.BoxGeometry(.24,.09,.17),bun);b.position.y=.05;g.add(b);const t=new THREE.Mesh(new THREE.SphereGeometry(.09,10,6,0,Math.PI*2,0,Math.PI/2),meat);t.position.y=.09;g.add(t);return g};
 return{popcorn:bucket,drink,ice,food}})();
const mkCap=c=>{const g=new THREE.Group(),m=M(c,{roughness:.7}),top=new THREE.Mesh(new THREE.SphereGeometry(.12,14,8,0,Math.PI*2,0,Math.PI/2),m);top.scale.set(1.04,.95,1.18);top.position.z=.012;g.add(top);
 const brim=new THREE.Mesh(new THREE.CylinderGeometry(.115,.115,.012,14,1,false,-Math.PI/2,Math.PI),m);brim.scale.set(1,1,1.0);brim.position.set(0,.004,.098);g.add(brim);return g};

export function createLobbyCrowd(scene,gl,{y0,DOOR_Z,boxes,LW,LD,audio,hall}){
 const root=new THREE.Group();root.visible=false;scene.add(root);
 const Z=z=>DOOR_Z+z,npcs=[],discs=[],timers=[],groups=[],lanes=[],bubbles=[];
 const frustum=new THREE.Frustum(),pm=new THREE.Matrix4(),inv=new THREE.Matrix4(),sph=new THREE.Sphere(),hv=new THREE.Vector3();
 let active=false,frame=0,players=[],doorBias=0,paT=rnd(14,22),popT=2,cam=null,time=0;
 const delay=s=>new Promise(r=>timers.push([s,r]));

 /* ---------- speech bubbles + announcement banner (DOM) ---------- */
 const pa=document.createElement('div');pa.className='pa';document.body.appendChild(pa);let paHide=0;
 function say(n,text,ms=3400){let b=bubbles.find(b=>b.n===n)||bubbles.find(b=>!b.n||b.until<time);
  if(!b){if(bubbles.length>=4)return;const el=document.createElement('div');el.className='bubble npc';document.body.appendChild(el);b={el,n:null,until:0};bubbles.push(b)}
  b.n=n;b.until=time+ms/1000;b.el.textContent=text}
 function bubblesTick(){for(const b of bubbles){const n=b.n;if(!n||b.until<time||!n.g.visible||!active){b.el.style.opacity=0;continue}
   hv.set(n.p.x,n.p.y+1.95,n.p.z).project(cam);if(hv.z>=1||Math.abs(hv.x)>1.1||Math.abs(hv.y)>1.1){b.el.style.opacity=0;continue}
   b.el.style.left=(hv.x*.5+.5)*innerWidth+'px';b.el.style.top=(-hv.y*.5+.5)*innerHeight+'px';b.el.style.opacity=1}}

 /* ---------- people ---------- */
 const bag=shuffle(BASES);let bi=0;
 function hideFor(key,look){return key==='rpm'?[...(look.capOn?[]:['Wolf3D_Headwear']),...(look.beard?[]:['Wolf3D_Beard'])]:key==='fb'&&Math.random()<.5?['Wolf3D_Glasses']:[]}
 function mk(key,kind,ms,{staff=false}={}){const look=crowdLook(kind,staff?'staff':undefined,ms),av=makeAvatar(gl[key],{height:look.height,look,headScale:look.head,walker:true,style:kind==='f'?'f':'m',shadow:false,hide:hideFor(key,look)});
  root.add(av.group);const n={av,g:av.group,p:av.group.position,sp:rnd(1.05,1.3),path:[],arrive:null,faceTo:null,acc:0,item:null,away:false,staff,disc:{x:0,z:0,r:.3},baseLp:0,glance:0};
  n.p.y=y0;npcs.push(n);discs.push(n.disc);return n}
 const person=()=>{const[k,kind,ms]=bag[bi++%bag.length];return mk(k,kind==='rpm'?'rpm':kind,ms)};
 const putAt=(n,x,z,face)=>{n.p.set(x,y0,Z(z));n.g.rotation.y=face;n.faceTo=face;return n};
 function give(n,kind){drop(n);const o=PROPS[kind]();o.position.set(0,.97,.36);n.g.add(o);n.item=o;n.av.act='carry'}
 function drop(n){if(n.item){n.g.remove(n.item);n.item=null}n.av.act=''}
 const reset=n=>{n.av.act=n.item?'carry':'';n.av.tly=0;n.av.tlp=n.baseLp=0;n.av.talk=0};

 /* ---------- movement: waypoints around pillars/sofas, soft separation from people ---------- */
 const PAD=.4;
 function hits(ax,az,bx,bz,b){let t0=0,t1=1;const dx=bx-ax,dz=bz-az;for(const[p,d,lo,hi]of[[ax,dx,b.x0-PAD,b.x1+PAD],[az,dz,b.z0-PAD,b.z1+PAD]]){if(Math.abs(d)<1e-9){if(p<lo||p>hi)return false}else{let a=(lo-p)/d,c=(hi-p)/d;if(a>c)[a,c]=[c,a];t0=Math.max(t0,a);t1=Math.min(t1,c);if(t0>t1)return false}}return true}
 const clear=(ax,az,bx,bz)=>!boxes.some(b=>hits(ax,az,bx,bz,b));
 function route(ax,az,bx,bz){if(clear(ax,az,bx,bz))return[[bx,bz]];
  let best=null,bd=1e9;for(const b of boxes){const e=PAD+.1;for(const[cx,cz]of[[b.x0-e,b.z0-e],[b.x1+e,b.z0-e],[b.x0-e,b.z1+e],[b.x1+e,b.z1+e]]){
    if(Math.abs(cx)>LW-.5||cz<DOOR_Z+.9||cz>DOOR_Z+LD-.5)continue;const d=Math.hypot(cx-ax,cz-az)+Math.hypot(bx-cx,bz-cz);if(d<bd&&clear(ax,az,cx,cz)&&clear(cx,cz,bx,bz)){bd=d;best=[cx,cz]}}}
  return best?[best,[bx,bz]]:[[bx,bz]]}
 const goto=(n,x,zl,sp)=>new Promise(r=>{n.path=route(n.p.x,n.p.z,x,Z(zl));n.arrive=r;if(sp)n.sp=sp});
 function pushBox(p,r,b){const cx=Math.max(b.x0,Math.min(p.x,b.x1)),cz=Math.max(b.z0,Math.min(p.z,b.z1)),dx=p.x-cx,dz=p.z-cz,d2=dx*dx+dz*dz;if(d2>=r*r)return;
  if(d2>1e-8){const d=Math.sqrt(d2);p.x=cx+dx/d*r;p.z=cz+dz/d*r}else{const l=p.x-b.x0,rr=b.x1-p.x,t=p.z-b.z0,bt=b.z1-p.z,m=Math.min(l,rr,t,bt);if(m===l)p.x=b.x0-r;else if(m===rr)p.x=b.x1+r;else if(m===t)p.z=b.z0-r;else p.z=b.z1+r}}
 function step(n,dt){let moving=false,head=0;
  if(n.path.length){const w=n.path[0];let dx=w[0]-n.p.x,dz=w[1]-n.p.z;const d=Math.hypot(dx,dz),st=n.sp*dt;
   if(d<=Math.max(st,.04)){n.p.x=w[0];n.p.z=w[1];n.path.shift();if(!n.path.length){const f=n.arrive;n.arrive=null;f&&f()}}
   else{dx/=d;dz/=d;let sx=0,sz=0;
    for(const o of npcs){if(o===n)continue;const ox=n.p.x-o.p.x,oz=n.p.z-o.p.z,od=Math.hypot(ox,oz);if(od<.8&&od>.001){const k=(.8-od)/.8;sx+=ox/od*k;sz+=oz/od*k}}
    for(const pl of players){if(!pl)continue;const ox=n.p.x-pl.pos.x,oz=n.p.z-pl.pos.z,od=Math.hypot(ox,oz);if(od<1&&od>.001){const k=(1-od)/1;sx+=ox/od*k*1.4;sz+=oz/od*k*1.4}}
    dx+=sx*1.1;dz+=sz*1.1;const m=Math.hypot(dx,dz)||1;n.p.x+=dx/m*st;n.p.z+=dz/m*st;moving=true;head=Math.atan2(dx,dz)}}
  for(const b of boxes)pushBox(n.p,.28,b);n.p.x=Math.max(-LW+.5,Math.min(LW-.5,n.p.x));n.p.z=Math.max(DOOR_Z+.9,Math.min(DOOR_Z+LD-.4,n.p.z));
  const target=moving?head:n.faceTo;if(target!=null)n.g.rotation.y+=wrap(target-n.g.rotation.y)*Math.min(1,dt*(moving?9:5));
  n.av.walk=moving?1:0;n.disc.x=n.p.x;n.disc.z=n.p.z}

 /* ---------- the canteen: two counters, two sellers ---------- */
 const mkSeller=(key,kind,x,work)=>{const n=mk(key,kind,undefined,{staff:true});putAt(n,x,13.35,Math.PI);
  const cap=mkCap(0xb3121b);n.av.wear(cap,'Head',[0,.105,.0]);n.work=work;return n};
 const sL=mkSeller('fc','f',-2.1,'scoop'),sR=mkSeller('mb','m',3.2,'type');   // left stands beside the popcorn machine, right at the till next to the soda dispenser (behind the dispenser itself he would be hidden)
 const mkLane=(x,seller)=>({x,seller,q:[],busy:false,slots:[0,1,2,3].map(i=>[x,Z(11.2-i*.95)])});
 lanes.push(mkLane(-2.1,sL),mkLane(2.6,sR));
 async function serve(l,c){l.busy=true;const s=l.seller;c.servicing=true;s.av.act='';s.av.wave=1.4;say(s,pick(LINES.sell),2400);audio?.pop?.();
  await delay(1.4);say(c,pick(LINES.order),2400);s.av.act=s.work;await delay(rnd(2.6,3.6));
  s.av.act='hand';await delay(.9);give(c,pick(['popcorn','popcorn','drink','drink','ice','food']));audio?.ching?.();say(s,pick(LINES.give),2400);
  await delay(1);s.av.act='';l.q.shift();l.busy=false;c.servicing=false;const f=c.served;c.served=null;f&&f()}
 function laneTick(l){l.q.forEach((n,i)=>{const sl=l.slots[Math.min(i,3)];if(!n.path.length&&Math.hypot(n.p.x-sl[0],n.p.z-sl[1])>.06){n.path=[sl]}n.faceTo=0});
  const c=l.q[0];if(c&&!l.busy&&!c.servicing&&!c.path.length&&Math.hypot(c.p.x-l.slots[0][0],c.p.z-l.slots[0][1])<.12)serve(l,c)}
 /** walk to the shorter queue, wait to be served, come away with something to eat */
 function buy(n){const l=lanes.reduce((a,b)=>a.q.length<=b.q.length?a:b);n.item&&drop(n);n.av.talk=0;n.av.tly=n.av.tlp=0;l.q.push(n);return new Promise(r=>n.served=r)}
 async function sellerLoop(n,l){await delay(rnd(0,3));while(true){if(l.busy||n.lock){await delay(.4);continue}const r=Math.random();n.av.act=r<.4?'type':r<.6?'wipe':'';n.av.tly=r<.3?rnd(-.6,.6):0;await delay(rnd(3,6));if(!l.busy&&!n.lock){n.av.act='';n.av.tly=0}}}
 const nearest=x=>Math.abs(sL.p.x-x)<=Math.abs(sR.p.x-x)?[sL,lanes[0]]:[sR,lanes[1]];
 async function lockSeller(n,secs,fn){n.lock=true;fn?.();await delay(secs);n.lock=false;n.faceTo=Math.PI;n.av.tly=0}

 /* ---------- friends chatting ---------- */
 function mkGroup(cx,cz,size){const members=[];for(let i=0;i<size;i++){const n=person(),a=i/size*Math.PI*2+rnd(-.3,.3),x=cx+Math.sin(a)*.85,z=cz+Math.cos(a)*.85;putAt(n,x,z,Math.atan2(cx-x,cz-z));n.home=[x,z,n.g.rotation.y];members.push(n)}
  const g={members,t:rnd(1,3),err:rnd(18,35),speaker:null,cx,cz};groups.push(g);
  members.forEach(n=>n.av.act='');return g}
 function groupTick(g,dt){g.t-=dt;g.err-=dt;
  if(g.t<=0){const here=g.members.filter(n=>!n.away);g.t=rnd(3.8,6.5);if(here.length>1){const sp=pick(here);g.speaker=sp;
    for(const n of here){const isS=n===sp;n.av.talk=isS?1:0;if(!n.item)n.av.act=isS?pick(['talk','talk','talk2']):Math.random()<.16?'phone':'';
     const tgt=isS?pick(here.filter(o=>o!==n)):sp;n.av.tly=Math.max(-1,Math.min(1,wrap(Math.atan2(tgt.p.x-n.p.x,tgt.p.z-n.p.z)-n.g.rotation.y)));n.av.tlp=0}
    sp.av.act=sp.item?'carry':sp.av.act;say(sp,pick(LINES.chat),3600)}}
  if(g.err<=0){g.err=rnd(28,50);const c=g.members.filter(n=>!n.away&&n!==g.speaker&&!n.item);if(c.length>1)errand(pick(c),g)}}
 async function errand(n,g){n.away=true;reset(n);await buy(n);const[x,z,f]=n.home;await goto(n,x,z);n.faceTo=f;n.away=false;await delay(rnd(30,50));drop(n)}

 /* ---------- people on their own ---------- */
 const POIS=[...[5.6,8.6,11.0].map(z=>({k:'poster',x:-7.55,z,f:-Math.PI/2})),...[5.6,8.6,11.0].map(z=>({k:'poster',x:7.55,z,f:Math.PI/2})),
  {k:'selfie',x:-3.2,z:8.9,f:0},{k:'selfie',x:3.2,z:8.9,f:0},{k:'menu',x:-.2,z:9.2,f:0},{k:'menu',x:.9,z:9.4,f:0},
  {k:'wait',x:-6.6,z:3.8,f:Math.PI*.8},{k:'wait',x:6.7,z:5.9,f:-Math.PI*.8},{k:'wait',x:0,z:4.8,f:0},{k:'door',x:-.9,z:1.9,f:Math.PI},{k:'door',x:1,z:1.8,f:Math.PI}];
 async function browse(n){await delay(rnd(0,5));
  while(true){const r=Math.random();
   if(r<.2&&!n.item){await buy(n);await delay(rnd(2,5))}
   else{const pool=POIS.filter(p=>!p.who&&(doorBias>0&&p.k==='door'?Math.random()<.8:p.k!=='door'||Math.random()<.2)),p=pick(pool.length?pool:POIS.filter(q=>!q.who&&q.k!=='door'));p.who=n;
    await goto(n,p.x,p.z);n.faceTo=p.f;reset(n);
    if(p.k==='poster'){n.av.tlp=n.baseLp=-.1;n.av.tly=rnd(-.4,.4)}else if(p.k==='menu')n.av.tlp=n.baseLp=-.3;else if(p.k==='selfie'||p.k==='door')n.av.act='phone';else if(Math.random()<.5)n.av.act=n.item?'carry':'phone';
    await delay(rnd(6,13));reset(n);p.who=null;if(n.item&&Math.random()<.5)drop(n)}}}

 /* ---------- build the scene ---------- */
 const gA=mkGroup(-6.4,7.0,3),gB=mkGroup(6.0,3.6,2);
 const walkers=[0,1,2,3,4].map(()=>person());
 putAt(walkers[0],-2.1,11.2,0);putAt(walkers[1],-2.1,10.25,0);putAt(walkers[2],2.6,11.2,0);
 putAt(walkers[3],-7.55,8.6,-Math.PI/2);putAt(walkers[4],3.2,8.9,0);
 lanes[0].q.push(walkers[0],walkers[1]);lanes[1].q.push(walkers[2]);
 walkers[0].served=walkers[1].served=walkers[2].served=null;
 [[walkers[0],lanes[0]],[walkers[1],lanes[0]],[walkers[2],lanes[1]]].forEach(([n])=>{n.served=()=>{browse(n)}});
 walkers[3].p.x=-7.55;browse(walkers[3]);browse(walkers[4]);
 sellerLoop(sL,lanes[0]);sellerLoop(sR,lanes[1]);
 npcs.forEach(n=>{n.g.visible=false});

 /* ---------- public announcements ---------- */
 function announce(text){pa.textContent='📢  '+text;pa.classList.add('on');paHide=time+7;audio?.chime?.();
  for(const n of npcs){if(n.glance>0)continue;n.keepLp=n.av.tlp;n.glance=2.6;n.av.tlp=-.32}
  if(/seating/.test(text))doorBias=22}

 /* ---------- per frame ---------- */
 function update(dt,t,camera,pl){if(!active)return;cam=camera;players=pl;frame++;time+=dt;
  for(let i=timers.length-1;i>=0;i--){const T=timers[i];T[0]-=dt;if(T[0]<=0){timers.splice(i,1);T[1]()}}
  groups.forEach(g=>groupTick(g,dt));lanes.forEach(laneTick);
  if(doorBias>0)doorBias-=dt;
  paT-=dt;if(paT<=0){paT=rnd(55,90);announce(pick(LINES.pa))}if(paHide&&time>paHide){paHide=0;pa.classList.remove('on')}
  popT-=dt;if(popT<=0){popT=rnd(.6,2.4);audio?.pop?.()}
  camera.updateMatrixWorld();inv.copy(camera.matrixWorld).invert();pm.multiplyMatrices(camera.projectionMatrix,inv);frustum.setFromProjectionMatrix(pm);
  npcs.forEach((n,i)=>{step(n,dt);
   if(n.glance>0){n.glance-=dt;if(n.glance<=0)n.av.tlp=n.keepLp||0}
   sph.center.set(n.p.x,n.p.y+.9,n.p.z);sph.radius=1.3;const vis=frustum.intersectsSphere(sph);n.g.visible=vis;
   n.acc+=dt;if(vis&&((frame+i)&1)===0){n.av.update(n.acc,t);n.acc=0}else if(!vis)n.acc=0});
  bubblesTick()}

 return{discs,update,
  get active(){return active},
  setActive(on){if(on===active)return;active=on;root.visible=on;if(!on){pa.classList.remove('on');bubbles.forEach(b=>b.el.style.opacity=0);hall.discs=[];audio?.murmur?.(0)}else{hall.discs=discs;audio?.murmur?.(.08)}},
  /** the couple walks up to the counter */
  greet(px){if(!active||!players[0])return;const[s,l]=nearest(px);s.av.wave=1.8;say(s,pick(LINES.hi),3600);if(!l.busy)lockSeller(s,5,()=>{s.av.act='';s.faceTo=Math.atan2(players[0].pos.x-s.p.x,players[0].pos.z-s.p.z)})},
  /** an order was placed: the seller starts working on it */
  orderPlaced(px){if(!active)return;const[s]=nearest(px);s.lock=true;s.av.act=s.work;s.faceTo=Math.PI;say(s,pick(LINES.coming),2600)},
  /** the order is ready on the counter: hand it over */
  orderReady(px){if(!active)return;const[s]=nearest(px);s.lock=true;s.av.act='hand';audio?.ching?.();say(s,pick(LINES.ready),3200);delay(1.6).then(()=>{s.av.act='';s.lock=false;s.faceTo=Math.PI})},
  announce}}
