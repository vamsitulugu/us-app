import * as THREE from 'three';
import {AD} from './ads-config.js';

/* ------------------------------------------------------------------
   Lobby TVs.
   ONE playlist drives every TV in the lobby (wall TVs + the six canteen menu TVs):
     your Twin Hearts ad (AD.own.src, same file as the ad break; muted here because the lobby has music)
     -> promo slides: share with friends, new features, app images ... -> repeat.
   The canteen menu TVs show the same scene, but on every other slide they swap back to their own menu card
   (Beverages / Popcorn / Ice Cream), so the menu is never lost.
   Edit the slides in SLIDES below. Images live in public/tv/ (copied from us-app/public/images).
------------------------------------------------------------------- */
const W=800,H=450,SLIDE_SEC=6,AD_MAX_SEC=45,APP_URL='twinhearts.vercel.app';
const ORDER=['ad','share','features','games','hug','canteen','places','miss','more','touch'];   // scene order; 'ad' is skipped if the ad video is off or broken

/* ---------- tiny canvas helpers ---------- */
const mk=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c};
const imgs=new Map();
function getImg(n,cb){let e=imgs.get(n);if(!e){const im=new Image();e={im,ok:false,cbs:[]};im.onload=()=>{e.ok=true;e.cbs.forEach(f=>f());e.cbs=[]};im.src=import.meta.env.BASE_URL+'tv/'+n+'.webp';imgs.set(n,e)}
 if(!e.ok){cb&&e.cbs.push(cb);return null}return e.im}
const cover=(x,im,a,b,w,h,r=0)=>{x.save();if(r){x.beginPath();x.roundRect(a,b,w,h,r);x.clip()}const s=Math.max(w/im.width,h/im.height),dw=im.width*s,dh=im.height*s;x.drawImage(im,a+(w-dw)/2,b+(h-dh)/2,dw,dh);x.restore()};
const contain=(x,im,a,b,w,h)=>{const s=Math.min(w/im.width,h/im.height),dw=im.width*s,dh=im.height*s;x.drawImage(im,a+(w-dw)/2,b+(h-dh)/2,dw,dh)};
const T=(x,s,px,py,size,col='#fff',wt='600',al='left')=>{x.font=`${wt} ${size}px system-ui,"Segoe UI",sans-serif`;x.fillStyle=col;x.textAlign=al;x.textBaseline='alphabetic';x.fillText(s,px,py)};
const bg=x=>{const g=x.createLinearGradient(0,0,W,H);g.addColorStop(0,'#2b061d');g.addColorStop(.6,'#5a0b45');g.addColorStop(1,'#7c0a57');x.fillStyle=g;x.fillRect(0,0,W,H);
 x.fillStyle='rgba(255,255,255,.06)';[[70,60,26],[720,90,34],[640,380,22],[120,400,30],[410,40,18],[760,250,20]].forEach(([a,b,s])=>{x.font=`${s}px serif`;x.textAlign='center';x.fillText('♥',a,b)});
 x.fillStyle='#C21A8B';x.fillRect(0,0,W,5)};
const brand=x=>{T(x,'♥ Twin Hearts',24,38,20,'#ffd0ec','700');};
const pill=(x,s,cx,cy,size,fill='#C21A8B',col='#fff')=>{x.font=`700 ${size}px system-ui,sans-serif`;const w=x.measureText(s).width+size*1.6,h=size*1.9;x.fillStyle=fill;x.beginPath();x.roundRect(cx-w/2,cy-h/2,w,h,h/2);x.fill();T(x,s,cx,cy+size*.35,size,col,'700','center')};
const card=(x,a,b,w,h,fill='rgba(255,255,255,.1)')=>{x.fillStyle=fill;x.beginPath();x.roundRect(a,b,w,h,16);x.fill()};
const photoSlide=(name,line,sub)=>(x,I)=>{bg(x);const im=I(name);if(im)cover(x,im,0,0,W,H);const g=x.createLinearGradient(0,H*.58,0,H);g.addColorStop(0,'rgba(43,6,29,0)');g.addColorStop(1,'rgba(43,6,29,.92)');x.fillStyle=g;x.fillRect(0,H*.5,W,H*.5);
 T(x,line,36,H-62,42,'#fff','800');T(x,sub,36,H-24,22,'#ffd0ec','500');brand(x);x.fillStyle='rgba(0,0,0,.0)'};

/* ---------- the slides ---------- */
const SLIDES={
 share:(x,I)=>{bg(x);const im=I('couple');if(im)contain(x,im,24,80,320,320);brand(x);
  T(x,'Share Twin Hearts',360,140,42,'#fff','800');T(x,'with your friends ♥',360,192,36,'#ff8fd0','800');
  T(x,'Know a couple who would love this?',360,243,22,'#ffe7f4','500');T(x,'Send them the app and grow the love',360,274,22,'#ffe7f4','500');T(x,'together.',360,305,22,'#ffe7f4','500');
  pill(x,APP_URL,570,365,26,'#C21A8B');T(x,'Invite a couple · Share the link',570,420,18,'#ffd0ec','500','center')},
 features:x=>{bg(x);brand(x);pill(x,'WHAT’S NEW',W-120,40,18,'#ffc93c','#4a0d35');T(x,'New in Twin Hearts',40,100,44,'#fff','800');
  [['🎮','Couple Games','Real-time multiplayer mini-games, right in the app'],['🎬','Watch Together','Twin Cinemas: movies, lobby and canteen for two'],['🗺️','Meet Planner & Live Map','Plan meetups and track each other live'],['🌍','Memory Globe','Pin every place you have been on a 3D globe']]
  .forEach(([e,t,d],i)=>{const b=130+i*74;card(x,40,b,W-80,62);x.font='34px serif';x.textAlign='left';x.fillStyle='#fff';x.fillText(e,56,b+43);T(x,t,112,b+28,24,'#fff','700');T(x,d,112,b+52,16,'#f3c6e3','400')})},
 games:(x,I)=>{bg(x);brand(x);pill(x,'NEW',W-70,40,18,'#ffc93c','#4a0d35');T(x,'Couple Games',40,100,44,'#fff','800');
  ['ludo','tod','ttt','memory','puzzle','bomb','draw','mindreader'].forEach((n,i)=>{const a=24+(i%4)*(179+12),b=122+Math.floor(i/4)*(106+12),im=I('g-'+n);x.fillStyle='rgba(255,255,255,.1)';x.beginPath();x.roundRect(a,b,179,101,12);x.fill();if(im)cover(x,im,a,b,179,101,12)});
  T(x,'Ludo · Truth or Dare · Tic-Tac-Toe · Memory · Puzzle · Bomb · Draw · Mind Reader',W/2,400,17,'#ffd0ec','500','center');T(x,'Play together, live, from anywhere',W/2,430,20,'#fff','700','center')},
 places:(x,I)=>{bg(x);brand(x);T(x,'Plan your next meetup',40,100,44,'#fff','800');
  ['goa','ooty','munnar','coorg','pondicherry','visakhapatnam','hyderabad','chennai'].forEach((n,i)=>{const a=40+(i%4)*(172+12),b=118+Math.floor(i/4)*(132+12),im=I('p-'+n);x.fillStyle='rgba(255,255,255,.1)';x.beginPath();x.roundRect(a,b,172,132,14);x.fill();if(im)cover(x,im,a,b,172,132,14)});
  T(x,'Meet Planner & Live Map: stops, budget, and track each other live',W/2,426,20,'#ffe7f4','600','center')},
 canteen:x=>{bg(x);brand(x);T(x,'Order with Gold Coins',40,110,46,'#fff','800');x.font='96px serif';x.textAlign='center';x.fillText('🍿',W-90,190);
  T(x,'Popcorn, drinks and sweets from the canteen,',40,175,24,'#ffe7f4','500');T(x,'ready on the counter or gifted to your love.',40,210,24,'#ffe7f4','500');
  card(x,40,250,W-80,130);T(x,'Earn Gold Coins in Twin Hearts',64,292,24,'#ffc93c','700');T(x,'Daily check-in  ·  Spin & Win  ·  Scratch cards',64,334,22,'#fff','500');T(x,'Open the cinema from the app to order ♥',64,366,18,'#f3c6e3','400')},
 more:x=>{bg(x);brand(x);T(x,'Made for just the two of you',40,100,44,'#fff','800');
  [['💬','Private Chat & Voice Notes'],['📞','Video & Voice Calls'],['📖','Shared Journal'],['🌟','Bucket List'],['📅','Calendar & Reminders'],['🔒','Secret Vault']]
  .forEach(([e,t],i)=>{const a=40+(i%2)*(W/2-30),b=130+Math.floor(i/2)*84;card(x,a,b,W/2-50,70);x.font='34px serif';x.textAlign='left';x.fillStyle='#fff';x.fillText(e,a+16,b+46);T(x,t,a+66,b+43,22,'#fff','600')});
  T(x,'No feeds. No strangers. Just us.  ·  '+APP_URL,W/2,420,20,'#ffd0ec','500','center')},
 hug:photoSlide('hug','Send a hug, from anywhere','Twin Hearts · everything together'),
 miss:photoSlide('miss','Missing them? Tell them.','Twin Hearts · everything together'),
 touch:photoSlide('touch','Stay close, even far apart','Twin Hearts · everything together'),
};

export function createTVs({scene}){
 const wallMat=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}),body=new THREE.MeshStandardMaterial({color:0x0b0a0a,roughness:.45,metalness:.3});
 const menus=[];           // {mat,menuTex}
 let order=ORDER.slice(),idx=0,sceneT=0,adEnded=false,adBad=false,lt=0,lv=1,seen=0,active=true,vtex=null,v=null,pokeT=0,adWait=0;

 /* slide canvases + textures (built lazily on first use; repainted when an image finishes loading) */
 const slides={};
 function slide(id){let s=slides[id];if(s)return s;const c=mk(),x=c.getContext('2d'),tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.generateMipmaps=false;tex.minFilter=THREE.LinearFilter;tex.anisotropy=4;
  const paint=()=>{SLIDES[id](x,n=>getImg(n,paint));tex.needsUpdate=true};paint();return slides[id]={tex}}

 /* the ad video (shared, muted) */
 function video(){if(v||!AD.own.enabled||!AD.own.src)return v;v=document.createElement('video');Object.assign(v,{src:AD.own.src,muted:true,loop:false,playsInline:true,preload:'auto',className:'hv'});v.setAttribute('playsinline','');
  v.addEventListener('ended',()=>{adEnded=true});v.addEventListener('error',()=>{adBad=true});document.body.appendChild(v);return v}
 const adReady=()=>!!v&&v.readyState>=2&&!adBad;
 const sceneTex=id=>{if(id==='ad'){if(adReady()){if(!vtex){vtex=new THREE.VideoTexture(v);vtex.colorSpace=THREE.SRGBColorSpace}return vtex}return slide('share').tex}return slide(id).tex};
 const playAd=()=>{if(!v)return;v.currentTime=0;v.play()?.catch(()=>{})};
 function enter(){sceneT=0;adEnded=false;adWait=0;const id=order[idx];if(id==='ad'){video();playAd()}else if(v&&!v.paused)v.pause()}
 function next(){idx=(idx+1)%order.length;enter();apply()}
 function apply(){const id=order[idx],t=sceneTex(id);wallMat.map=t;wallMat.needsUpdate=true;
  menus.forEach((m,i)=>{const showMenu=id!=='ad'&&((idx+i)%2===0);m.mat.map=showMenu?m.menuTex:t;m.mat.needsUpdate=true})}
 const screenMesh=(w,h,mat)=>new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);

 setInterval(()=>{if(v&&!v.paused&&performance.now()-seen>800)v.pause()},1000);        // nobody is looking at the lobby (studio / hall): stop decoding the video

 return{
  /** a wall TV. (x,y,z) = centre, ry = which way it faces (same convention as the posters), w = screen width (16:9) */
  wall(x,y,z,ry,w=1.9){const h=w*9/16,g=new THREE.Group();
   const b=new THREE.Mesh(new THREE.BoxGeometry(w+.12,h+.12,.08),body);g.add(b);
   const s=screenMesh(w,h,wallMat);s.position.z=.042;g.add(s);
   const led=new THREE.Mesh(new THREE.BoxGeometry(.18,.012,.01),new THREE.MeshBasicMaterial({color:0xc21a8b,toneMapped:false}));led.position.set(0,-(h/2+.035),.042);g.add(led);
   g.position.set(x,y,z);g.rotation.y=ry;scene.add(g);return g},
  /** turn an existing hanging menu screen (a mesh with the menu card as its map) into a TV that also plays the playlist */
  menu(mesh){const menuTex=mesh.material.map;mesh.material.dispose();const mat=new THREE.MeshBasicMaterial({map:menuTex,toneMapped:false});mesh.material=mat;menus.push({mat,menuTex})},
  setOn(on){active=on;if(!on&&v)v.pause();else if(on&&order[idx]==='ad')playAd()},
  setLights(k){lv=.4+.6*k;wallMat.color.setScalar(lv)},
  update(t){const dt=Math.min(.1,Math.max(0,t-lt));lt=t;seen=performance.now();if(!active)return;
   if(!wallMat.map){if(AD.own.enabled&&AD.own.src)video();else order=order.filter(s=>s!=='ad');enter();apply()}
   sceneT+=dt;const id=order[idx];
   if(id==='ad'){
    if(adBad||!AD.own.enabled){order=order.filter(s=>s!=='ad');idx=Math.min(idx,order.length-1);enter();apply()}
    else if(adReady()){
     if(!adWait){adWait=1;apply()}                                    // the video is ready: switch from the placeholder slide to the video
     pokeT+=dt;if(v.paused&&!adEnded&&pokeT>1){pokeT=0;v.play()?.catch(()=>{})}
     if(adEnded||sceneT>AD_MAX_SEC)next()}
    else if(sceneT>10){order=order.filter(s=>s!=='ad');idx=Math.min(idx,order.length-1);enter();apply()}   // never loaded -> carry on without the ad
   }else if(sceneT>SLIDE_SEC)next();
   menus.forEach((m,i)=>m.mat.color.setScalar(lv*(.94+.06*Math.sin(t*2+i))))}}}
