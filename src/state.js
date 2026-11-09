// Story state machine. Every screen of the experience is one state; illegal jumps are rejected.
export const S={DOOR:'door',ENTER:'enter',EXPLORE:'explore',SEATED:'seated',WATCH:'watch',PAUSED:'paused',BREAK:'break',END:'end'};
const NEXT={door:['enter'],enter:['explore'],explore:['seated'],seated:['explore','watch'],watch:['paused','break','end'],paused:['watch','break','end'],break:['watch','end'],end:['watch']};
export function createMachine(initial=S.DOOR){let cur=initial;const subs=new Set();
 return{get state(){return cur},is:(...a)=>a.includes(cur),on(f){subs.add(f);return()=>subs.delete(f)},
  go(n){if(n===cur)return true;if(n===S.DOOR||NEXT[cur]?.includes(n)){const p=cur;cur=n;subs.forEach(f=>f(n,p));return true}console.warn(`blocked ${cur} -> ${n}`);return false}}}
