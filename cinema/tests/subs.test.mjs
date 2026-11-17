// node tests/subs.test.mjs : the subtitle parser (.srt / .vtt) and cue lookup. No install needed.
import {parseSubs,cueAt,secs} from '../src/subs.js';
let n=0,bad=0;const ok=(c,m)=>{n++;if(c)console.log('ok  - '+m);else{bad++;console.log('FAIL - '+m)}};
ok(secs('00:00:01,500')===1.5&&secs('01:02.250')===62.25&&secs('1:00:00.5')===3600.5,'times: srt comma, vtt dot, short mm:ss, hour, 1-digit millis');
const srt='\uFEFF1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello</i> {\\an8}there\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nSecond line\r\nwith two rows\r\n\r\n3\r\nnot a cue\r\n';
const a=parseSubs(srt);
ok(a.length===2,'srt: two cues, junk block skipped');ok(a[0].t==='Hello there','srt: tags and {\\an8} removed');ok(a[1].t==='Second line\nwith two rows','srt: two-row cue kept');
const vtt='WEBVTT\n\nNOTE a comment\n\nSTYLE\n::cue{color:red}\n\nintro\n00:01.500 --> 00:02.000 align:start position:10%\nShort &amp; sweet\n\n01:00:00.250 --> 01:00:01.000\nHour one';
const b=parseSubs(vtt);ok(b.length===2&&b[0].s===1.5&&b[0].e===2&&b[0].t==='Short & sweet','vtt: cue id, settings and entities handled');ok(b[1].s===3600.25,'vtt: hour times');
ok(parseSubs('').length===0&&parseSubs(null).length===0&&parseSubs('hello world').length===0,'empty / garbage gives no cues');
ok(parseSubs('00:00:05,000 --> 00:00:04,000\nbackwards').length===0,'end before start is dropped');
ok(parseSubs('00:00:09,000 --> 00:00:10,000\nlate\n\n00:00:01,000 --> 00:00:02,000\nearly').map(c=>c.t).join()==='early,late','cues are sorted by start');
ok(cueAt(a,0.5)===null&&cueAt(a,1).t==='Hello there'&&cueAt(a,3.5).t==='Hello there'&&cueAt(a,3.7)===null&&cueAt(a,4.5).t.startsWith('Second'),'cueAt: before, inside, edge, gap, second cue');
ok(cueAt(a,99)===null&&cueAt([],1)===null,'cueAt: after the last cue / no cues');
const o=[{s:1,e:10,t:'long'},{s:2,e:3,t:'short'}];ok(cueAt(o,2.5).t==='short'&&cueAt(o,5).t==='long','overlapping cues: the latest that started wins, the long one comes back when the short one ends');
console.log(`\n${n-bad} passed${bad?`, ${bad} FAILED`:''}`);process.exit(bad?1:0);
