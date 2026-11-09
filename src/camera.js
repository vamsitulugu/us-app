import * as THREE from 'three';
import {DOOR_Z,HALF,FRONT_Z,LW,LD,LH,floorY,rowZ,seatX,ROWS} from './hall.js';
const {Vector3}=THREE,V=new Vector3(),cl=(v,a,b)=>Math.max(a,Math.min(b,v)),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a)),damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));
/** The 10 "where do I watch from?" views shown in the full-screen popup.
    pov:* modes put the camera at eye height IN a seat (drag = look around from that seat); the others reuse the older shots. */
export const VIEWS=[
 {id:'pov:sweet',icon:'🎯',label:'Best seat'},{id:'pov:front',icon:'🔍',label:'Front row'},{id:'pov:back',icon:'🦅',label:'Back row'},
 {id:'pov:left',icon:'⬅️',label:'Left seat'},{id:'pov:right',icon:'➡️',label:'Right seat'},{id:'pov:me',icon:'👀',label:'My seat'},
 {id:'shoulder',icon:'👫',label:'Over shoulder'},{id:'couple',icon:'💞',label:'Together'},{id:'pov:hall',icon:'🏛️',label:'Whole hall'},{id:'flat',icon:'🖥️',label:'Full screen'}];
const EYE=1.28;                                                    // seated eye height above the row's floor
/** first free seat of a row, trying the columns in order (so the camera never sits inside someone's head) */
const seatAt=(c,r,cols)=>{for(const k of cols){const id=ROWS[r]+(k+1);if(!c.taken?.has(id)&&c.mine!==id)return[seatX(k),rowZ(r)]}return[seatX(cols[0]),rowZ(r)]};
const povFrom=(c,r,cols,dy=0,ly=-.15)=>{const[x,z]=seatAt(c,r,cols);return[x,floorY(z)+EYE+dy,z,0,c.sy+ly,FRONT_Z]};
/** each returns [camX,camY,camZ, lookX,lookY,lookZ] */
const POV={
 sweet:c=>povFrom(c,4,[7,6,8,5,9]),                                // middle of the middle, row E: the "perfect" seat
 front:c=>povFrom(c,0,[7,6,8,5,9],0,0),                            // row A: screen towers over you
 back:c=>povFrom(c,8,[6,8,5,9,4,10],.15,-.5),                      // last row: high and wide, the whole screen small and cinematic
 left:c=>povFrom(c,3,[1,0,2],0,-.2),                               // left block: screen at a diagonal
 right:c=>povFrom(c,3,[13,14,12],0,-.2),
 me:c=>c.seated?[c.me.x,c.me.y+EYE,c.me.z+.04,0,c.sy-.1,FRONT_Z]:POV.sweet(c),   // exactly what you see from your own seat
 hall:c=>[HALF-.8,floorY(DOOR_Z-.6)+3.4,DOOR_Z-.6,-.8,2.2,-4.5]};  // high back corner: the whole theatre, rows and screen
/** One camera, many shots. Modes: door, follow, seat, orbit (free 360), screen, couple, full.
    yaw/pitch/dist are what you ask for; vy/vp/vd are the smoothed values actually used (so drags glide and nothing snaps).
    Drag = free look all the way round (with inertia), wheel / two-finger pinch = zoom, orbit with {auto:true} slowly spins until you touch it. */
export class CameraRig{
 constructor(cam,dom,{onManual}={}){Object.assign(this,{cam,mode:'door',yaw:0,pitch:.55,dist:4,vy:0,vp:.55,vd:4,ks:3,k:3,yv:0,pv:0,idle:99,auto:false,_t:0,onManual,moved:0,dragging:false,ctx:{me:new Vector3(),couple:new Vector3(),chatT:new Vector3(),sw:9.6,sh:4.2,sy:3.45,lobbyY:1.9,lobby:false,seated:false,taken:null,mine:null}});
  this.D=new Vector3();this.L=new Vector3();this.S=new Vector3();this.look=new Vector3(0,2,7);
  const ptrs=new Map(),pd=()=>{const a=[...ptrs.values()];return Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1])};let pinch=0;
  dom.addEventListener('pointerdown',e=>{ptrs.set(e.pointerId,[e.clientX,e.clientY]);this.idle=0;if(ptrs.size===1){this.moved=0;this.dragging=true;this.yv=this.pv=0;this._t=0}else if(ptrs.size===2)pinch=pd()});
  const up=e=>{ptrs.delete(e.pointerId);if(!ptrs.size){this.dragging=false;pinch=0}else if(ptrs.size===1)pinch=0};addEventListener('pointerup',up);addEventListener('pointercancel',up);
  dom.addEventListener('pointermove',e=>{const p=ptrs.get(e.pointerId);if(!p)return;const dx=e.clientX-p[0],dy=e.clientY-p[1];p[0]=e.clientX;p[1]=e.clientY;this.idle=0;
   if(ptrs.size>=2){const d=pd();if(pinch)this.dist=cl(this.dist-(d-pinch)*.012,2,9);pinch=d;this.moved+=99;return}
   this.moved+=Math.abs(dx)+Math.abs(dy);if(this.moved<8||['door','full'].includes(this.mode))return;
   if(this.mode.startsWith('pov:')){this.yaw=cl(this.yaw+dx*.0045,-.95,.95);this.pitch=cl(this.pitch+dy*.0032,-.45,.5);return}   // seat views: turn your head, you can't leave the seat
   if(['screen','shoulder','side','couple','chat'].includes(this.mode)){this.dist=4.5;this.pitch=.35;onManual?.()}
   const ay=-dx*.0055,ap=dy*.0038;this.yaw+=ay;this.pitch=cl(this.pitch+ap,-.15,1.35);
   const now=e.timeStamp||performance.now(),dtm=this._t?cl(now-this._t,8,50):16;this._t=now;this.yv=cl(this.yv*.4+ay/dtm*1000*.6,-3,3);this.pv=cl(this.pv*.4+ap/dtm*1000*.6,-2,2)});
  dom.addEventListener('wheel',e=>{this.dist=cl(this.dist+e.deltaY*.004,2,9);this.idle=0},{passive:true})}
 /** returns true if the last pointer gesture was a tap rather than a drag */
 get wasTap(){return this.moved<6}
 setMode(m,o={}){this.mode=m;if(m.startsWith('pov:')){this.yaw=this.vy=0;this.pitch=this.vp=0;this.auto=false;this.yv=this.pv=0;this.idle=0;return}if(o.yaw!==undefined)this.yaw=this.vy+wrap(o.yaw-this.vy);if(o.pitch!==undefined)this.pitch=o.pitch;if(o.dist!==undefined)this.dist=o.dist;this.auto=!!o.auto;this.yv=this.pv=0;this.idle=0}
 /** camera distance from the screen at which the whole screen just fits the frame (works for landscape and portrait) */
 fit(pad=1.08){const c=this.ctx,vt=Math.tan(this.cam.fov*Math.PI/360),ht=vt*this.cam.aspect;return Math.max(c.sw/2/ht,c.sh/2/vt)*pad}
 /** look point that keeps both A and B in frame: averages the yaw/pitch towards them (w = weight of A) */
 between(A,B,w){const D=this.D,ya=Math.atan2(A.x-D.x,A.z-D.z),yb=Math.atan2(B.x-D.x,B.z-D.z),y=ya+wrap(yb-ya)*(1-w),
  p=Math.atan2(A.y-D.y,Math.hypot(A.x-D.x,A.z-D.z))*w+Math.atan2(B.y-D.y,Math.hypot(B.x-D.x,B.z-D.z))*(1-w);
  return this.L.set(D.x+Math.sin(y)*Math.cos(p)*10,D.y+Math.sin(p)*10,D.z+Math.cos(y)*Math.cos(p)*10)}
 pose(t){const c=this.ctx,m=this.mode;this.k=3;
  if(m==='door'){this.D.set(0,c.lobbyY+1.55,DOOR_Z+4.9);this.L.set(0,c.lobbyY+1.4,DOOR_Z-.1)}
  else if(m==='screen'){const d=this.fit(1.08),z=cl(FRONT_Z+d,FRONT_Z+4,DOOR_Z-.5);       // best view: whole screen fills the frame, dead centre, above the heads
   this.D.set(c.couple.x*.15+Math.sin(t*.25)*.1,Math.max(c.sy-.4,floorY(z)+2.2),z);this.L.set(0,c.sy,FRONT_Z);this.k=1.6}
  else if(m.startsWith('pov:')){const a=(POV[m.slice(4)]||POV.sweet)(c),dx=a[3]-a[0],dy=a[4]-a[1],dz=a[5]-a[2],y0=Math.atan2(dx,dz)+this.vy,p0=Math.atan2(dy,Math.hypot(dx,dz))+this.vp,cp=Math.cos(p0);
   this.D.set(a[0],a[1],a[2]);this.L.set(a[0]+Math.sin(y0)*cp*10,a[1]+Math.sin(p0)*10,a[2]+Math.cos(y0)*cp*10);this.k=2.2}   // vy/vp = how far you've turned your head
  else if(m==='shoulder'){this.D.set(c.couple.x*.8,c.couple.y+2.6,Math.min(DOOR_Z-.4,c.couple.z+2.4));                 // over the couple's shoulders: heads low in frame, screen ahead
   this.between(V.set(c.couple.x,c.couple.y+1.15,c.couple.z),this.S.set(0,c.sy,FRONT_Z),.45);this.k=1.8}
  else if(m==='side'){this.D.set(HALF-.9,c.couple.y+2.4,Math.min(DOOR_Z-.4,c.couple.z+1.2));                          // diagonal from the side wall: couple in profile, screen at an angle
   this.between(V.set(c.couple.x,c.couple.y+1.15,c.couple.z),this.S.set(0,c.sy,FRONT_Z),this.cam.aspect<1?.9:.55);this.k=1.8}
  else if(m==='couple'){this.D.set(c.couple.x+.4,c.couple.y+1.8,c.couple.z-3.6);this.L.set(c.couple.x,c.couple.y+1.05,c.couple.z);this.k=1.8}
  else if(m==='chat'){const t2=c.chatT;this.D.set(t2.x+.3,t2.y+1.55,t2.z-2.6);this.L.set(t2.x,t2.y+1.5,t2.z);this.k=2.2}   // a little closer, heads + bubbles in frame
  else if(m==='full'){const z=cl(FRONT_Z+this.fit(1.03),FRONT_Z+2,DOOR_Z-.5);this.D.set(0,c.sy,z);this.L.set(0,c.sy,FRONT_Z);this.k=2.5}
  else{const tg=(m==='orbit'?c.couple:c.me),cp=Math.cos(this.vp);this.L.set(tg.x,tg.y+1.2,tg.z);
   this.D.set(Math.sin(this.vy)*cp,Math.sin(this.vp),Math.cos(this.vy)*cp).multiplyScalar(this.vd).add(this.L);
   if(c.lobby)this.D.set(cl(this.D.x,-LW+.5,LW-.5),cl(this.D.y,c.lobbyY+.7,c.lobbyY+LH-.5),cl(this.D.z,DOOR_Z+.5,DOOR_Z+LD-.5));
   else this.D.set(cl(this.D.x,-HALF+.4,HALF-.4),cl(this.D.y,.6,6.4),cl(this.D.z,FRONT_Z+1.2,DOOR_Z-.3));this.k=this.dragging?14:8}}
 /** instantly put another camera where view `id` would stand (used for the popup thumbnails; leaves this rig untouched) */
 poseFor(id,cam){const k={mode:this.mode,vy:this.vy,vp:this.vp,k:this.k};this.mode=id;this.vy=this.vp=0;this.pose(0);cam.position.copy(this.D);cam.lookAt(this.L);Object.assign(this,k)}
 update(dt,t){
  // inertia after you let go; stale velocity fades while the finger is held still
  if(this.dragging){const f=Math.exp(-dt*12);this.yv*=f;this.pv*=f}
  else if(['follow','seat','orbit'].includes(this.mode)&&(Math.abs(this.yv)>.01||Math.abs(this.pv)>.01)){this.yaw+=this.yv*dt;this.pitch=cl(this.pitch+this.pv*dt,-.15,1.35);const f=Math.exp(-dt*5.5);this.yv*=f;this.pv*=f}
  this.idle+=dt;if(this.auto&&this.mode==='orbit'&&!this.dragging&&this.idle>3)this.yaw+=dt*.3;       // gentle 360 spin
  const rr=this.dragging?30:14;this.vy=damp(this.vy,this.yaw,rr,dt);this.vp=damp(this.vp,this.pitch,rr,dt);this.vd=damp(this.vd,this.dist,8,dt);
  this.pose(t);this.ks=damp(this.ks,this.k,4,dt);                                                   // blend between shots instead of switching speed
  this.cam.position.lerp(this.D,1-Math.exp(-dt*this.ks));this.look.lerp(this.L,1-Math.exp(-dt*this.ks*1.1));this.cam.lookAt(this.look)}}
