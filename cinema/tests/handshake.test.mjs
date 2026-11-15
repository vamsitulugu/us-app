// Run: node tests/handshake.test.mjs   (no install needed beyond the cinema's own node_modules; DOM + network are stubbed)
// Tests the lobby bugs: partner "here" detection without the render loop, Start that reaches the partner even when
// realtime messages are lost, and an invite that survives a sleeping server.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hs-'));
const src=f=>fs.readFileSync(new URL('../src/'+f,import.meta.url),'utf8');
fs.writeFileSync(path.join(dir,'net.mjs'),src('net.js').replace(/import \{createClient\}[^\n]*\n/,"const createClient=()=>{throw new Error('offline test')};\n"));
fs.writeFileSync(path.join(dir,'lib-codec.js'),src('lib-codec.js'));
for(const n of['host','guest','host2'])fs.writeFileSync(path.join(dir,n+'.mjs'),src('invite.js')
 .replace("import {ONLINE} from './net.js';","const ONLINE=true;").replace("import {iconize} from './icons.js';","const iconize=(e,t)=>{e.textContent=t};").replace("from './lib-codec.js'","from './lib-codec.js'"));
let ok=0;const t=async(n,f)=>{await f();ok++;console.log('  ✓',n)};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- 1. presence (src/net.js) ---------- */
const {createSync}=await import(path.join(dir,'net.mjs'));
await t('both phones see each other WITHOUT the render loop (no tick() calls), and a leaving partner is noticed at once',async()=>{
 const ev={a:[],b:[]};
 const mk=(r,k)=>createSync('room1',r,{onJoin:()=>ev[k].push('join'),onLeave:()=>ev[k].push('leave'),onHello(){},onPos(){},onSit(){},onStand(){},onConflict:()=>ev[k].push('conflict')});
 const a=await mk(1,'a'),b=await mk(2,'b');
 await wait(400);
 assert.equal(a.present,true);assert.equal(b.present,true);
 assert.deepEqual(ev.a,['join']);assert.deepEqual(ev.b,['join']);
 b.close();await wait(200);
 assert.equal(a.present,false);assert.ok(ev.a.includes('leave'));
 a.close();
});
await t('a phone whose 3D frame is throttled (no tick() for 8 s) is still seen as "here" by the other phone (was: "partner left" after 6 s, Start button vanished)',async()=>{
 const mk=(r)=>createSync('room3',r,{onJoin(){},onLeave(){},onHello(){},onPos(){},onSit(){},onStand(){},onConflict(){}});
 const a=await mk(1),b=await mk(2);                  // a never calls tick (frame throttled), b renders normally
 const snap=()=>({x:0,z:0});const iv=setInterval(()=>b.tick(performance.now(),false,snap),100);
 await wait(8000);clearInterval(iv);
 assert.equal(b.present,true);a.close();b.close();
});
await t('a reload / echo of your own seat right after joining does NOT block you (was a permanent "seat already taken")',async()=>{
 let conflict=0;
 const a=await createSync('room2',1,{onJoin(){},onLeave(){},onHello(){},onPos(){},onSit(){},onStand(){},onConflict:()=>conflict++});
 const twin=await createSync('room2',1,{onJoin(){},onLeave(){},onHello(){},onPos(){},onSit(){},onStand(){},onConflict(){}});
 await wait(2500);twin.close();await wait(300);
 assert.equal(conflict,0);a.close();
});

/* ---------- 2. start + invite (src/invite.js), fake DOM and network ---------- */
const mkEl=()=>({style:{},children:[],classList:{add(){}},appendChild(c){this.children.push(c);return c},set textContent(v){this._t=v;if(v==='')this.children=[]},get textContent(){return this._t||''}});
const all=[];globalThis.document={createElement:()=>{const e=mkEl();all.push(e);return e},body:mkEl()};
globalThis.window=globalThis;globalThis.history={replaceState(){}};
const SID='11111111-1111-4111-8111-111111111111';
let posts=[],invites=[],failInvite=0;
globalThis.fetch=async(url,opt)=>{const p=String(url).replace(/^.*\/api\/cinema\/[^/]+/,'');
 if(opt&&opt.method==='POST'){if(p==='/invite'){invites.push('try');if(failInvite-->0)throw new TypeError('network down')}posts.push(p);return{ok:true,status:200,json:async()=>({ok:true})}}
 return{ok:true,status:200,json:async()=>({status:'invited'})}};
const load=async(name,hash)=>{globalThis.location={hash,pathname:'/cinema/'};return import(path.join(dir,name+'.mjs'))};
const H=await load('host',`#s=${SID}&r=1&n=Asha&c=C1&u=user1&h=1&i=1`);
const G=await load('guest',`#s=${SID}&r=2&n=Ravi&c=C1&u=user2&h=0`);
const press=label=>{const b=all.filter(e=>e.onclick&&e._t&&e._t.includes(label)).pop();assert.ok(b,'button "'+label+'" not on screen');b.onclick()};

let guestEnter=0,goSent=0,goDropped=3,hostInv,guestInv,hostEnter=0;
await t('host Start reaches the partner even when the first 3 "go" messages are lost, and stops repeating after the partner answers',async()=>{
 const hostSync={present:true,send(m){if(m.t==='go'){goSent++;if(goDropped-->0)return;guestInv.onGo()}}};
 const guestSync={present:true,send(m){if(m.t==='goack')hostInv.onAck()}};
 hostInv=H.mountInvite({sync:()=>hostSync,enter:()=>hostEnter++,stat(){},hidden:()=>false});
 guestInv=G.mountInvite({sync:()=>guestSync,enter:()=>guestEnter++,stat(){},hidden:()=>false});
 await wait(800);press('Start movie night');
 assert.equal(hostEnter,1);                       // the host walks in at once
 assert.equal(guestEnter,0);                      // first message lost
 await wait(5200);                                // resend at 1.5 s, 3.0 s (lost), 4.5 s (arrives)
 assert.equal(guestEnter,1,'the partner must have walked in');
 assert.equal(guestInv.isStarted(),true);
 const sent=goSent;await wait(3300);
 assert.equal(goSent,sent,'"go" must stop once the partner answered');
 assert.ok(posts.includes('/status'),'server told the night started');
});
await t('a second "go" (late hello / resend) never makes the partner enter twice',async()=>{guestInv.onGo();guestInv.onGo();assert.equal(guestEnter,1)});
await t('invite is retried through a sleeping server: 2 network failures, then it goes through (and the host sees "waiting for your partner")',async()=>{
 const H2=await load('host2',`#s=${SID}&r=1&n=Asha&c=C1&u=user1&h=1`);
 const sync={present:false,send(){}};invites.length=0;posts.length=0;failInvite=2;
 H2.mountInvite({sync:()=>sync,enter(){},stat(){},hidden:()=>false});
 await wait(800);press('Invite partner');
 await wait(4600);                                   // retry waits 1.2 s then 2.4 s
 assert.equal(invites.length,3,'two failed tries and one that went through');
 assert.equal(posts.filter(p=>p==='/invite').length,1);
 const texts=all.map(e=>e._t||'');
 assert.ok(!texts.some(x=>x.startsWith('Could not send the invite')),'no error shown to the user');
 assert.ok(texts.some(x=>x.includes('Invite sent')),'the host is told the invite is out');
});
await t('an invite that keeps failing tells the user what to do instead of failing silently',async()=>{
 const H3=await load('host2',`#s=${SID}&r=1&n=Asha&c=C1&u=user1&h=1`);void H3;
 invites.length=0;failInvite=99;
 press('Invite again');
 await wait(9500);                                   // 4 tries: 1.2 + 2.4 + 3.6 s of waiting
 assert.equal(invites.length,4);
 assert.ok(all.map(e=>e._t||'').some(x=>x.startsWith('Could not send the invite')&&x.includes('Tap Invite again')));
});
console.log(`\n${ok} passed`);process.exit(0);
