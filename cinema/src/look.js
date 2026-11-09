import * as THREE from 'three';
/** Per-part recolouring so every audience member looks like a different person (skin, hair, top, trousers, shoes). */
const rnd=(a,b)=>a+Math.random()*(b-a),pick=a=>a[Math.random()*a.length|0];
const SKIN=[[1.1,1.04,.98],[1,.93,.86],[.9,.8,.7],[.78,.66,.55],[.64,.52,.43],[.52,.42,.35]];          // multipliers on the avatar's own skin texture
const TOP=[0x1f2a44,0x6e1f2b,0x4d5b2f,0xc79a2c,0xe9e4d8,0x7b7f86,0x1d6a72,0x3b6ea5,0x17171a,0xa8512f,0xd36a8e,0x8a78b8,0x2f5d3a,0xb8b2a2,0x5a3a2e];
const BOT=[0x2d4a78,0x1f2f4d,0x4a6a96,0x17181c,0x7a6a52,0x55595f,0x3c4a2c,0x23324f,0x8c7a60];
const SHOE=[0xf2f2f2,0x17171a,0x5a3b27,0x8a8d92,0xb33a30,0x2a3550];
const HAIR=[0x0d0b0a,0x1a1210,0x2b1b13,0x4a2e1c,0x6b3f22,0x9a6b3a,0xc9a45a,0xa8a8a8,0x5a1f14];
const kt='look1';
export function dye(src,hex,amt){const m=src.clone(),tint=new THREE.Color(hex),u={uTint:{value:tint},uDye:{value:amt}};
 if(m.transparent&&m.name&&!/Cornea/i.test(m.name)){m.transparent=false;m.alphaTest=.45;m.depthWrite=true}
 m.onBeforeCompile=sh=>{sh.uniforms.uTint=u.uTint;sh.uniforms.uDye=u.uDye;
  sh.fragmentShader='uniform vec3 uTint;uniform float uDye;\n'+sh.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\n{float l=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));diffuseColor.rgb=mix(diffuseColor.rgb*uTint,uTint*(.3+1.4*l),uDye);}')};
 m.customProgramCacheKey=()=>kt;return m}
/** One-mesh avatar (old female base): rotate hue of non-skin pixels (clothes), tone the skin pixels. */
export function dyeAuto(src,skin,hue){const m=src.clone(),u={uSkin:{value:skin},uHue:{value:hue}};
 m.onBeforeCompile=sh=>{sh.uniforms.uSkin=u.uSkin;sh.uniforms.uHue=u.uHue;
  sh.fragmentShader='uniform vec3 uSkin;uniform float uHue;\n'+sh.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
{vec3 c=diffuseColor.rgb;float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b)),sat=(mx-mn)/(mx+1e-4),q=(c.g-c.b)/(c.r-c.b+1e-4);
float sk=smoothstep(.15,.3,sat)*step(c.g,c.r)*step(c.b,c.g)*smoothstep(.15,.3,q)*(1.-smoothstep(.8,.95,q));
float cs=cos(uHue),sn=sin(uHue);vec3 y=vec3(dot(c,vec3(.299,.587,.114)),dot(c,vec3(.596,-.274,-.322)),dot(c,vec3(.211,-.523,.312)));
vec2 iq=mat2(cs,-sn,sn,cs)*y.yz;vec3 h=vec3(y.x+.956*iq.x+.621*iq.y,y.x-.272*iq.x-.647*iq.y,y.x-1.106*iq.x+1.703*iq.y);
diffuseColor.rgb=mix(max(h,vec3(0.)),c*uSkin,sk);}`)};
 m.customProgramCacheKey=()=>kt+'auto';return m}
const skinMul=a=>new THREE.Color().setRGB(a[0],a[1],a[2],THREE.LinearSRGBColorSpace);
/** Roll a random look. kind: 'f' | 'm' | 'rpm' (separate-mesh Ready Player Me man). */
export function randomLook(kind){const hair=pick(HAIR),sk=pick(SKIN);
 return{skin:sk,top:pick(TOP),bottom:pick(BOT),shoes:pick(SHOE),hair,cap:pick(TOP),
  hue:rnd(0,6.28),height:(kind==='f'||kind==='of')?rnd(1.54,1.7):rnd(1.64,1.86),head:[rnd(.93,1.07),rnd(.95,1.06),rnd(.93,1.07)],
  beard:kind!=='f'&&kind!=='of'&&Math.random()<.35,capOn:kind==='rpm'&&Math.random()<.3}}
/** Lobby crowd: every person different. Tops are dealt from a shuffled deck, so nobody in the lobby wears the same colour as someone else.
    role 'staff' = canteen uniform (red top, black trousers). minSkin = lightest skin allowed (models with hair painted on the head keep dark hair that way). */
let deck=[];const nextTop=()=>{if(!deck.length)deck=TOP.map(v=>[Math.random(),v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);return deck.pop()};
export function crowdLook(kind,role,minSkin=0){const l=randomLook(kind),sk=pick(SKIN.slice(Math.max(0,Math.min(minSkin||0,SKIN.length-1))));
 if(role==='staff')return{...l,skin:sk,top:0xb3121b,bottom:0x17181c,shoes:0x17171a,hair:pick([0x0d0b0a,0x1a1210,0x2b1b13]),beard:false,capOn:false,height:kind==='f'?rnd(1.58,1.68):rnd(1.7,1.8)};
 return{...l,skin:sk,top:nextTop()}}
/** Apply a look to every mesh of a cloned avatar by mesh name (MetaPerson: outfit_*, haircut, Avatar*; RPM: Wolf3D_*). */
export function applyLook(root,l){root.traverse(k=>{if(!k.isMesh)return;const n=k.name,mt=k.material;
 if(/^Ch03/.test(n)){k.material=dyeAuto(mt,skinMul(l.skin),l.hue);return}
 if(/Cornea/i.test(n)){k.visible=false;return}
 if(/outfit_top|Outfit_Top|avaturn_look/.test(n))k.material=dye(mt,l.top,1);
 else if(/outfit_bottom|Outfit_Bottom/.test(n))k.material=dye(mt,l.bottom,1);
 else if(/outfit_shoes|Footwear|avaturn_shoes/.test(n))k.material=dye(mt,l.shoes,1);
 else if(/haircut|Beard|Wolf3D_Hair|avaturn_hair/.test(n))k.material=dye(mt,l.hair,1);
 else if(/Headwear/.test(n))k.material=dye(mt,l.cap,1);
 else if(/^AvatarBody|^AvatarHead|^Body_Mesh|^Head_Mesh|Wolf3D_Head|Wolf3D_Body|Wolf3D_Skin/.test(n))k.material=dye(mt,skinMul(l.skin),0)})}
