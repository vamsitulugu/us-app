// Run: node tests/watch-sync.test.mjs   (no install needed; three.js, the DOM and the realtime channel are stubbed)
// Tests the cinema's OWN movie system (src/watch.js): shared timeline, nobody waits for anybody, choose a file / cloud movie, ready gate.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ws-'));
const code=fs.readFileSync(new URL('../src/watch.js',import.meta.url),'utf8')
 .replace("import * as THREE from 'three';","const THREE={VideoTexture:class{dispose(){}},SRGBColorSpace:'srgb'};")
 .replace("import {openChannel} from './net.js';","const openChannel=(c,f)=>globalThis.__open(c,f);");
fs.writeFileSync(path.join(dir,'watch.mjs'),code);
let clock=1_000_000;Date.now=()=>clock;globalThis.performance={now:()=>clock};
class FakeVideo{constructor(){this.listeners={};this.paused=true;this.seeking=false;this.readyState=4;this.currentTime=0;this.duration=100;this.playbackRate=1;this._src='';this.error=null;this.buffered={length:0};this.ended=false;this.nextDur=0}
 addEventListener(n,f){(this.listeners[n]??=[]).push(f)}emit(n){(this.listeners[n]||[]).forEach(f=>f())}
 set src(x){this._src=x;this.readyState=0;setTimeout(()=>{this.readyState=4;this.duration=this.nextDur||100;this.onloadedmetadata?.()},0)}get src(){return this._src}
 removeAttribute(){this._src=''}load(){}play(){this.paused=false;return Promise.resolve()}pause(){this.paused=true}}
globalThis.document={createElement:()=>new FakeVideo(),body:{appendChild(){}},hidden:false,visibilityState:'visible',addEventListener(){},removeEventListener(){}};
globalThis.addEventListener=()=>{};globalThis.removeEventListener=()=>{};
globalThis.URL={createObjectURL:()=>'blob:x',revokeObjectURL(){}};
// the realtime channel: two phones in one room, messages arrive in order; `drop` simulates a lost message
let peers=[],drop=()=>false;
globalThis.__open=async(room,onMsg)=>{const me={onMsg};peers.push(me);return{send:m=>{if(drop(m))return;for(const p of peers)if(p!==me)queueMicrotask(()=>p.onMsg(JSON.parse(JSON.stringify(m))))},close(){peers=peers.filter(p=>p!==me)}}};
const {Watch}=await import(path.join(dir,'watch.mjs'));
const tick=()=>new Promise(r=>setTimeout(r,0)),ticks=async k=>{for(let i=0;i<k;i++)await tick()};
let n=0;const t=(name,fn)=>Promise.resolve().then(fn).then(()=>{n++;console.log('ok  -',name)},e=>{console.log('FAIL-',name,'\n',e.stack.split('\n').slice(0,4).join('\n'));process.exitCode=1});
const cloud={M1:{url:'https://r2/x.mp4?sig=1',title:'Cloud Film',durationSec:100}};
const mk=async(role,live=true)=>{const w=new Watch({cloudUrl:async id=>{if(!cloud[id])throw new Error('That movie is no longer in your cloud');return cloud[id]}});await w.connect('room-1',role);w.timers.forEach(clearInterval);w.timers=[];w.live=live;return w};
const pair=async()=>{peers=[];drop=()=>false;const a=await mk(1),b=await mk(2);await ticks(2);return[a,b]};
// two phones that both already have a movie loaded (the playback tests need a real video, not the 30 s demo clock)
const playing=async(live=true)=>{peers=[];drop=()=>false;const a=await mk(1),b=await mk(2,live);await ticks(2);await a.chooseCloud(item);await ticks(5);a.v.currentTime=0;b.v.currentTime=0;a.v.paused=true;b.v.paused=true;return[a,b]};
const file=(name,dur)=>({name,size:1e8});
const withFile=(w,name,dur,force)=>{w.v.nextDur=dur;return w.chooseFile(file(name,dur),force)};
const item={id:'M1',title:'Cloud Film',durationSec:100,sizeBytes:1e9};

await t('play: the partner starts and plays',async()=>{const[a,b]=await playing();a.play();a.send(true);await tick();assert.equal(b.ref.playing,true);assert.equal(b.v.paused,false)});
await t('pause: the partner pauses where I paused',async()=>{const[a,b]=await playing();a.v.currentTime=42;a.send(false);await tick();assert.equal(b.v.paused,true);assert.equal(Math.round(b.v.currentTime),42)});
await t('partner played at 30 s and 5 s have passed: this video jumps to about 35 s',async()=>{const[a,b]=await playing();b._rx({k:'st',seq:Date.now()+1,playing:true,pos:30,by:1,r:1});clock+=5000;b.follow();assert.ok(Math.abs(b.v.currentTime-35)<.4,String(b.v.currentTime))});
await t('seeking on one phone moves the other',async()=>{const[a,b]=await playing();a.v.currentTime=10;a.send(true);await tick();a.v.currentTime=70;a.send(true);await tick();assert.ok(Math.abs(b.v.currentTime-70)<.5)});
await t('stale and repeated actions are ignored',async()=>{const[a,b]=await playing();a.send(false);await tick();const seq=b.ref.seq;b._rx({k:'st',seq:seq-5,playing:true,pos:9,by:1,r:1});b._rx({k:'st',seq,playing:true,pos:9,by:1,r:1});assert.equal(b.ref.seq,seq);assert.equal(b.ref.playing,false)});
await t('NOBODY WAITS: my video stalls, the partner keeps playing and the timeline is untouched',async()=>{const[a,b]=await playing();a.send(true);b.play();await tick();
 a.v.readyState=1;a.v.paused=false;a._waiting();await new Promise(r=>setTimeout(r,1400));
 assert.equal(a.buffering,true,'I know I am buffering');assert.equal(b.v.paused,false,'the partner must keep playing');assert.equal(b.ref.playing,true);assert.equal(a.ref.playing,true)});
await t('the partner is told (a note, no pause) that I am buffering',async()=>{const[a,b]=await playing();const st=[];b.onstatus=x=>st.push(x);b._rx({k:'buf',on:1,r:1});assert.match(st.at(-1),/partner/);b._rx({k:'buf',on:0,r:1});assert.equal(st.at(-1),'')});
await t('after a stall my video catches up to the timeline with one hard seek',async()=>{const[a,b]=await playing();a.v.currentTime=0;a.play();a.send(true);await tick();clock+=9000;a.lastSeek=0;a.v.currentTime=1;a._drift();assert.ok(a.v.currentTime>8,'caught up: '+a.v.currentTime)});
await t('drift 0.4-2 s: a speed nudge, not a seek',async()=>{const[a,b]=await playing();a.play();a.send(true);await tick();clock+=10000;a.lastSeek=0;a.v.currentTime=9;a._drift();assert.equal(a.v.playbackRate,1.06);assert.equal(a.v.currentTime,9)});
await t('no seek storm: a second hard seek within 7 s is not made',async()=>{const[a,b]=await playing();a.send(true);await tick();clock+=20000;a.lastSeek=0;a.v.currentTime=1;a._drift();const t1=a.v.currentTime;clock+=3000;a.v.currentTime=1;a._drift();assert.equal(a.v.currentTime,1);assert.ok(t1>15)});
await t('while my video is still loading (not enough data) the drift loop does not touch it',async()=>{const[a,b]=await playing();a.play();a.send(true);await tick();clock+=20000;a.lastSeek=0;a.v.readyState=2;a.v.currentTime=1;a._drift();assert.equal(a.v.currentTime,1)});
await t('the owner repeats the timeline: a lost message is recovered',async()=>{peers=[];const a=await mk(1),b=await mk(2);await tick();drop=m=>m.k==='st'&&!m.hb;a.send(true);await tick();assert.equal(b.ref.playing,false);drop=()=>false;a._hb();await tick();assert.equal(b.ref.playing,true)});
await t('a phone that joins late asks and gets the movie, the timeline and the ready flag',async()=>{peers=[];drop=()=>false;const a=await mk(1);await tick();await a.chooseCloud(item);a.send(true);clock+=4000;const b=await mk(2);await ticks(4);assert.equal(b.ref.playing,true);assert.equal(b.media.id,'M1');assert.equal(b.myReady,true);assert.equal(a.partnerReady,true)});
await t('an ad break travels as a reason and the timeline pauses',async()=>{const[a,b]=await playing();a.send(false,'ad');await tick();assert.equal(b.reason,'ad');assert.equal(b.v.paused,true)});
await t('not in the scene yet (not live): the action is kept and applied by follow()',async()=>{const[a,b]=await playing(false);a.send(true);await tick();assert.equal(b.v.paused,true);b.live=true;b.follow();assert.equal(b.v.paused,false)});

await t('CLOUD: one picks, the other loads the same movie by itself; both ready',async()=>{const[a,b]=await pair();const r=await a.chooseCloud(item);assert.equal(r.ok,true);await ticks(4);
 assert.equal(a.media.kind,'cloud');assert.equal(b.media.id,'M1');assert.equal(b.src,true);assert.equal(b.v._src,'https://r2/x.mp4?sig=1');assert.equal(a.bothReady,true);assert.equal(b.bothReady,true)});
await t('CLOUD: a movie that is gone from the cloud is reported and nothing is announced',async()=>{const[a,b]=await pair();const r=await a.chooseCloud({id:'GONE',title:'x',durationSec:5});assert.equal(r.ok,false);assert.match(r.msg,/no longer in your cloud/);assert.equal(b.media,null);assert.equal(a.myReady,false)});
await t('DEVICE: the partner is asked for the same file, then both are ready',async()=>{const[a,b]=await pair();assert.equal((await withFile(a,'Titanic.mp4',200)).ok,true);await ticks(2);
 assert.equal(b.media.title,'Titanic');assert.equal(b.needsFile,true);assert.equal(b.myReady,false);assert.equal(a.partnerReady,false);
 assert.equal((await withFile(b,'Titanic (1).mp4',201)).ok,true);await ticks(2);assert.equal(b.needsFile,false);assert.equal(a.bothReady,true);assert.equal(b.bothReady,true)});
await t('DEVICE: a file of another length is refused (3 s tolerance); forced, it replaces the movie',async()=>{const[a,b]=await pair();await withFile(a,'Titanic.mp4',200);await ticks(2);
 const r=await withFile(b,'Other.mp4',500);assert.equal(r.ok,false);assert.equal(r.len,true);assert.equal(b.src,false);
 const r2=await withFile(b,'Other.mp4',500,true);assert.equal(r2.ok,true);await ticks(2);assert.equal(a.media.title,'Other');assert.equal(a.needsFile,true)});
await t('both choose at the same moment: one choice wins on both phones',async()=>{const[a,b]=await pair();await Promise.all([withFile(a,'A.mp4',100),withFile(b,'B.mp4',300)]);await ticks(3);assert.equal(a.media.mid,b.media.mid)});
await t('the partner restarts (hello): their old ready flag is dropped until they have the movie again',async()=>{const[a,b]=await pair();await a.chooseCloud(item);await ticks(4);assert.equal(a.partnerReady,true);a._rx({k:'want',hello:1,r:2});assert.equal(a.partnerReady,false)});
await t('a plain resync request (wake / focus) does NOT clear the partner\'s ready flag',async()=>{const[a,b]=await pair();await a.chooseCloud(item);await ticks(4);a._rx({k:'want',r:2});assert.equal(a.partnerReady,true)});
await t('the file I already have is the movie my partner announces later: ready at once',async()=>{peers=[];drop=()=>false;const a=await mk(1);await withFile(a,'Film.mp4',200);const b=await mk(2);await withFile(b,'Film.mp4',200);await ticks(4);
 assert.equal(a.media.mid,b.media.mid);assert.equal(a.bothReady,true);assert.equal(b.bothReady,true)});
await t('a cloud movie that errors while playing is reloaded with a fresh URL at the same second',async()=>{const[a,b]=await pair();await a.chooseCloud(item);a.v.currentTime=40;a.lastGood=40;a.v.paused=false;cloud.M1={...cloud.M1,url:'https://r2/x.mp4?sig=2'};a.v.error={code:2};a.v.emit('error');await new Promise(r=>setTimeout(r,20));assert.equal(a.v._src,'https://r2/x.mp4?sig=2');assert.equal(Math.round(a.v.currentTime),40)});
console.log(`\n${n} passed`);
