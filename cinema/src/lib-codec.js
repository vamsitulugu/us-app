/** The movie library travels from Twin Hearts to the cinema inside the URL hash (&lib=...), so it never touches a server and works for
    each phone's own list. Compact keys: i id, t title, y year, g genre, r rating(0-5), s status, v review, p poster url, o owner, f favourite. */
const STATUS=['watchlist','watching','watched'],OWNER=['my','partner','both'];
const str=(v,n)=>typeof v==='string'?v.slice(0,n):v==null?'':String(v).slice(0,n);
/** -> [{id,title,year,genre,rating,max,status,overview,posterUrl,owner,fav}] or null when absent / unreadable */
export function decodeLib(b64){
 if(!b64)return null;
 try{const s=atob(b64.replace(/-/g,'+').replace(/_/g,'/')),j=JSON.parse(decodeURIComponent(escape(s)));if(!Array.isArray(j))return null;
  return j.slice(0,60).filter(m=>m&&typeof m==='object'&&str(m.t,1)).map((m,k)=>{const p=str(m.p,600);
   return{id:str(m.i,40)||('l'+k),title:str(m.t,120),year:str(m.y,8),genre:str(m.g,40),rating:Number.isFinite(+m.r)&&m.r!==''&&m.r!=null?Math.max(0,Math.min(5,+m.r)):null,max:5,
    status:STATUS.includes(m.s)?m.s:'',overview:str(m.v,400),posterUrl:/^https?:\/\//i.test(p)?p:'',backdropUrl:'',owner:OWNER.includes(m.o)?m.o:'',fav:!!m.f}})}
 catch(e){return null}}
