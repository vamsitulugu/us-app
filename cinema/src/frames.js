import * as THREE from 'three';
/** Lobby movie frames: every frame shows a DIFFERENT movie from the couple's Twin Hearts library. The posters slide one by one
    (next movie every 2 s); when someone stands in front of a frame the sliding pauses and the app shows the movie's full details.
    A name plaque floats above each frame. No movies -> every frame says so. */
const SLIDE=2,TRANS=.6,PW=.94,PH=1.44,ASP=PW/PH;
const mkc=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const cTex=c=>{const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t};
const wrap=(x,txt,mw,lh,y,maxL)=>{const w=txt.split(/\s+/),L=[];let l='';for(const s of w){if(x.measureText(l?l+' '+s:s).width>mw&&l){L.push(l);l=s}else l=l?l+' '+s:s}if(l)L.push(l);L.slice(0,maxL).forEach((s,i)=>x.fillText(L.length>maxL&&i===maxL-1?s.replace(/.{0,2}$/,'…'):s,128,y+i*lh));return Math.min(L.length,maxL)};
function artCanvas(title,sub,hue,icon){const c=mkc(256,384),x=c.getContext('2d'),g=x.createLinearGradient(0,0,0,384);g.addColorStop(0,`hsl(${hue},55%,20%)`);g.addColorStop(.6,`hsl(${hue},60%,34%)`);g.addColorStop(1,`hsl(${(hue+30)%360},60%,14%)`);x.fillStyle=g;x.fillRect(0,0,256,384);
 x.strokeStyle='rgba(255,255,255,.18)';x.lineWidth=2;x.strokeRect(10,10,236,364);x.textAlign='center';x.fillStyle='#fff';x.shadowColor='rgba(0,0,0,.5)';x.shadowBlur=8;
 if(icon){x.font='54px system-ui';x.fillText(icon,128,130)}x.font='bold 27px Georgia,serif';const n=wrap(x,title.toUpperCase(),208,32,icon?190:150,4);
 if(sub){x.shadowBlur=0;x.fillStyle='rgba(255,255,255,.7)';x.font='15px system-ui';wrap(x,sub,200,20,(icon?190:150)+n*32+16,3)}return c}
const hue=s=>{let h=0;for(const ch of s)h=(h*31+ch.charCodeAt(0))%360;return h};
function plaqueCanvas(t){const c=mkc(512,112),x=c.getContext('2d');x.fillStyle='rgba(14,17,38,.82)';x.beginPath();x.roundRect(6,10,500,92,22);x.fill();x.strokeStyle='rgba(255,177,92,.8)';x.lineWidth=3;x.stroke();
 x.fillStyle='#fff';x.textAlign='center';x.textBaseline='middle';let f=46;do{x.font=`bold ${f}px system-ui`;f-=2}while(x.measureText(t).width>470&&f>20);x.fillText(t.length>40&&f<=20?t.slice(0,38)+'…':t,256,58);return c}
const VS='varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const FS='uniform sampler2D tA,tB;uniform vec4 cA,cB;uniform float p;varying vec2 vUv;void main(){vec2 a=vec2(vUv.x+p,vUv.y),b=vec2(vUv.x+p-1.,vUv.y);vec4 c=a.x<=1.?texture2D(tA,a*cA.xy+cA.zw):texture2D(tB,b*cB.xy+cB.zw);gl_FragColor=vec4(c.rgb,1.);\n#include <colorspace_fragment>\n}';
export function createFrames(){
 const slots=[],cache=new Map(),loader=new THREE.TextureLoader();loader.setCrossOrigin('anonymous');
 let movies=[],state='loading',why='',step=0,clock=0,trans=-1,hold=false,sig='';
 const crop=(img)=>{const a=img&&img.width?img.width/img.height:ASP;return a>ASP?new THREE.Vector4(ASP/a,1,(1-ASP/a)/2,0):new THREE.Vector4(1,a/ASP,0,(1-a/ASP)/2)};
 const art=(key,title,sub,h,icon,movie)=>{let e=cache.get(key);if(!e){e={tex:cTex(artCanvas(title,sub,h,icon)),crop:crop(),movie:movie||null,title};cache.set(key,e)}return e};
 const entryOf=m=>{const key='m'+m.id;let e=cache.get(key);if(e)return e;
  e=art(key,m.title,[m.year,m.genre].filter(Boolean).join(' · '),hue(m.title),'🎬',m);       // pretty title card until the real poster arrives (or if it never does)
  const url=[m.posterUrl,m.backdropUrl].find(u=>/^https?:\/\//i.test(u||''));
  if(url)loader.load(url,t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;e.tex=t;e.crop=crop(t.image)},undefined,()=>{});return e};
 const phE=()=>state==='loading'?art('ph-load','Loading movies…','',230,'⏳'):state==='none'?art('ph-none:'+why,'No movies yet',why==='app'?'Open the cinema from Twin Hearts to see your library':why==='err'?'Could not load your library right now':'Add movies in Twin Hearts → Movie → Library',350,'🎞️'):null;
 const moreE=()=>art('ph-more','No more movies','Add more in Twin Hearts → Library',260,'➕');
 const entryAt=(k,s)=>{const p=phE();if(p)return p;const n=movies.length;return k>=n?moreE():entryOf(movies[(s+k)%n])};
 const nameOf=e=>e.movie?e.movie.title:state==='ready'?'＋ Add more movies':state==='none'?'No movies':'Loading…';
 const setPlaque=(s,e)=>{const nm=nameOf(e);if(s.nm===nm)return;s.nm=nm;s.plaque.map?.dispose();s.plaque.map=cTex(plaqueCanvas(nm));s.plaque.needsUpdate=true};
 const sync=()=>{slots.forEach((s,k)=>{s.A=s.B=entryAt(k,step);setPlaque(s,s.A)});trans=-1};
 const api={
  /** register a frame; returns the mesh group parts the lobby should add */
  add(x,y,z,ry){const u={tA:{value:null},tB:{value:null},cA:{value:new THREE.Vector4(1,1,0,0)},cB:{value:new THREE.Vector4(1,1,0,0)},p:{value:0}};
   const mat=new THREE.ShaderMaterial({uniforms:u,vertexShader:VS,fragmentShader:FS,toneMapped:false}),
    plane=new THREE.Mesh(new THREE.PlaneGeometry(PW,PH),mat),plq=new THREE.MeshBasicMaterial({transparent:true,toneMapped:false,depthWrite:false}),
    plate=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.285),plq);
   const s={x,z,ry,u,plaque:plq,A:null,B:null,nm:''};slots.push(s);s.A=s.B=entryAt(slots.length-1,step);setPlaque(s,s.A);return{plane,plate}},
  /** list of movies, or null when it could not be loaded; why: 'app' (not opened from the app) | 'err' */
  set(list,reason){const sg=list===null?'x:'+reason:list.map(m=>m&&m.id).join(','),same=sg===sig&&state!=='loading';sig=sg;if(same)return;   // a refresh with the same library must not restart the slideshow
  if(list===null){movies=[];state='none';why=reason||'err'}else{movies=list.filter(m=>m&&m.title);if(!movies.length){state='none';why=''}else{state='ready';why=''}}step=0;clock=0;sync()},
  get hold(){return hold},set hold(v){hold=!!v},
  /** which frame is someone standing in front of? (-1 = none) */
  near(p){let best=-1,bd=9;slots.forEach((s,k)=>{const dx=p.x-s.x,dz=p.z-s.z,nx=Math.sin(s.ry),nz=Math.cos(s.ry),f=dx*nx+dz*nz,sd=dx*nz-dz*nx;if(f>.2&&f<2.7&&Math.abs(sd)<1.5){const d=f+Math.abs(sd);if(d<bd){bd=d;best=k}}});return best},
  /** the movie currently on frame k (null for placeholders) */
  movie(k){const s=slots[k];return s&&(trans>=0&&trans>.5?s.B:s.A).movie||null},
  update(dt){
   if(state==='ready'&&movies.length>1&&!hold){clock+=dt;if(clock>=SLIDE&&trans<0){clock=0;step++;slots.forEach((s,k)=>{s.A=s.B;s.B=entryAt(k,step)});trans=0}}
   if(trans>=0){trans+=dt/TRANS;if(trans>=1){slots.forEach(s=>{s.A=s.B;setPlaque(s,s.A)});trans=-1}else if(trans>.5)slots.forEach(s=>setPlaque(s,s.B))}
   const p=trans<0?0:trans*trans*(3-2*trans);
   for(const s of slots){const u=s.u;u.tA.value=s.A.tex;u.tB.value=s.B.tex;u.cA.value=s.A.crop;u.cB.value=s.B.crop;u.p.value=p}}};
 return api}
