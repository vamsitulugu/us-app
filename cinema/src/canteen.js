import {rail} from './rail.js';
import {ic,Coins,Popcorn,HeartHandshake,CupSoda,Coffee,IceCreamCone,Sandwich,Donut,ChefHat,ShoppingCart,ShoppingBasket} from './icons.js';
import {CATS as ALLCATS,MENU as ALL,slug} from './menu.js';
/* Real photos: drop them in src/food/<slug>.jpg (see src/food/README.txt). Once ANY photo exists the canteen lists ONLY the items that have one;
   with no photos at all it lists the whole curated menu on plum icon tiles (setup mode). */
const PHOTOS=Object.fromEntries(Object.entries(import.meta.glob('./food/*.{jpg,jpeg,png,webp}',{eager:true,query:'?url',import:'default'})).map(([p,u])=>[p.split('/').pop().replace(/\.\w+$/,''),u]));
const MENU=Object.keys(PHOTOS).length?ALL.filter(i=>PHOTOS[slug(i.name)]):ALL;
const CATS=ALLCATS.filter(c=>MENU.some(i=>i.cat===c.id));

/* ---- item pictures: put a real photo at public/food/<slug>.jpg (slug = item name, lower-case, words joined with '-').
   If a photo is missing, the card shows a Lucide icon on a plum tile instead. See public/food/README.txt for the full file list. ---- */
const CAT_ICON={popcorn:Popcorn,combo:HeartHandshake,drinks:CupSoda,hot:Coffee,ice:IceCreamCone,snacks:Sandwich,sweet:Donut};
const svg=(i,s=18)=>ic(i,s).outerHTML;
const byName=n=>MENU.find(i=>i.name===n);
const thumb=(it)=>{const m=typeof it==='string'?byName(it):it;if(!m)return`<span class="th"><i class="ph">${svg(Popcorn,26)}</i></span>`;
 const u=PHOTOS[slug(m.name)];return`<span class="th"><i class="ph">${svg(CAT_ICON[m.cat]||Popcorn,26)}</i>${u?`<img src="${u}" alt="${esc(m.name)}" loading="lazy" decoding="async" onerror="this.remove()">`:''}</span>`};
const money=n=>`<span class="co">${svg(Coins,14)}${n}</span>`,esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dot=v=>v===1?'<i class="vd v"></i>':v===0?'<i class="vd n"></i>':'';
let uid=1;

/** hooks: onOrder(order) when an order is placed (the seller starts working), onReady(order) when food is on the counter, onGift(lines) to send items to the partner, onBag({popcorn,drink}) when held items change,
    canGift() -> bool (partner is here), say(text) -> status line, sfx(name) */
export function createCanteen(h={}){
 let cat=CATS[0]?.id||'popcorn',orderFor='me',open=false,cart=[],bag=[],view='menu',busy=false,bal=null,payId=null;
 const root=document.createElement('div');root.id='canteen';root.innerHTML=`<div class="cn-head"><b>${svg(Popcorn,20)}Twin Cinema’s Canteen</b><span>Counter 1 · made fresh for the two of you</span><em class="cn-bal"></em><button class="cn-x" aria-label="Close">✕</button></div>
  <div class="cn-tabs"></div><div class="cn-body"></div><div class="cn-foot"></div><div class="cn-sheet"></div>`;document.body.appendChild(root);
 const $=s=>root.querySelector(s),tabs=$('.cn-tabs'),body=$('.cn-body'),foot=$('.cn-foot'),sheet=$('.cn-sheet');
 const bagBtn=document.createElement('button');bagBtn.id='bagbtn';bagBtn.style.display='none';bagBtn.title=bagBtn.ariaLabel='My snacks';rail.appendChild(bagBtn);
 const bagPanel=document.createElement('div');bagPanel.id='bagpanel';document.body.appendChild(bagPanel);
 const toastEl=document.createElement('div');toastEl.id='toast';document.body.appendChild(toastEl);let tt;
 const toast=t=>{toastEl.textContent=t;toastEl.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>toastEl.classList.remove('on'),4200)};

 const balEl=root.querySelector('.cn-bal');
 const renderBal=()=>{balEl.innerHTML=!h.pay?`${svg(Coins,15)}<i>Open from Twin Hearts to pay</i>`:`${svg(Coins,15)}<i><strong>${bal==null?'…':bal}</strong> Gold Coins</i>`};
 const canPay=()=>!!h.pay&&(bal==null||total()<=bal);
 const payHint=()=>!h.pay?'<small class="hint warn">Orders are paid with your Twin Hearts Gold Coins. Open the cinema from the Twin Hearts app to order.</small>':bal!=null&&total()>bal?`<small class="hint warn">You need ${total()-bal} more Gold Coins. Earn them in Twin Hearts: daily check-in, Spin &amp; Win, scratch cards.</small>`:'';
 const total=()=>cart.reduce((a,l)=>a+l.unit*l.qty,0),count=()=>cart.reduce((a,l)=>a+l.qty,0);

 function renderTabs(){tabs.innerHTML=CATS.map(c=>`<button data-c="${c.id}" class="${c.id===cat?'on':''}">${svg(CAT_ICON[c.id],16)}${c.name}</button>`).join('');
  tabs.onclick=e=>{const b=e.target.closest('button');if(!b)return;cat=b.dataset.c;view='menu';render()}}
 function renderMenu(){body.innerHTML='<div class="cn-grid">'+MENU.filter(i=>i.cat===cat).map(i=>`<button class="cn-card" data-id="${esc(i.id)}"><div class="e">${thumb(i)}</div><div class="t">${dot(i.veg)}${esc(i.name)}</div><div class="d">${esc(i.desc)}</div><div class="p">from ${money(i.price)}</div></button>`).join('')+'</div>';
  body.onclick=e=>{const b=e.target.closest('.cn-card');if(!b)return;openSheet(MENU.find(i=>i.id===b.dataset.id))}}

 /* option sheet for one item */
 function openSheet(item){const sel=item.groups.map(g=>new Set(g.req&&!g.multi?[0]:[]));let qty=1,note='';
  const unit=()=>item.price+item.groups.reduce((a,g,gi)=>a+[...sel[gi]].reduce((s,oi)=>s+g.opts[oi].p,0),0);
  const draw=()=>{sheet.innerHTML=`<div class="cn-sh"><div class="cn-sh-h"><div class="e">${thumb(item)}</div><div><b>${dot(item.veg)}${esc(item.name)}</b><small>${esc(item.desc)}</small></div><button class="cn-x2">✕</button></div>
   <div class="cn-sh-b">${item.groups.map((g,gi)=>`<div class="grp"><h4>${esc(g.name)} <small>${g.multi?'pick any':g.req?'pick one':'optional'}</small></h4><div class="chips">${g.opts.map((o,oi)=>`<button class="chip ${sel[gi].has(oi)?'on':''}" data-g="${gi}" data-o="${oi}">${esc(o.n)}${o.p?` <em>+${money(o.p)}</em>`:''}</button>`).join('')}</div></div>`).join('')}
   <div class="grp"><h4>Special instructions <small>optional</small></h4><input class="cn-note" maxlength="60" placeholder="e.g. less spicy, extra napkins, for my love ♥" value="${esc(note)}"></div></div>
   <div class="cn-sh-f"><div class="qty"><button data-q="-1">−</button><b>${qty}</b><button data-q="1">+</button></div><button class="main add">Add to order · ${money(unit()*qty)}</button></div></div>`;
   const sh=sheet.firstElementChild;sh.onclick=e=>{const c=e.target.closest('.chip'),q=e.target.closest('[data-q]');
    if(c){const gi=+c.dataset.g,oi=+c.dataset.o,g=item.groups[gi],s=sel[gi];if(g.multi)s.has(oi)?s.delete(oi):s.add(oi);else if(g.req||!s.has(oi)){s.clear();s.add(oi)}else s.clear();draw()}
    else if(q){qty=Math.max(1,Math.min(20,qty+ +q.dataset.q));draw()}
    else if(e.target.closest('.cn-x2')){sheet.style.display='none'}
    else if(e.target.closest('.add')){const picks=item.groups.flatMap((g,gi)=>[...sel[gi]].map(oi=>g.opts[oi].n));addLine(item,picks,note,qty,unit(),sel.map(x=>[...x]));sheet.style.display='none'}};
   const ni=sh.querySelector('.cn-note');ni.oninput=()=>note=ni.value;ni.onkeydown=e=>e.stopPropagation()};
  draw();sheet.style.display='flex'}
 function addLine(item,picks,note,qty,unit,sel){payId=null;const key=item.id+'|'+JSON.stringify(sel)+'|'+note,ex=cart.find(l=>l.key===key);ex?ex.qty+=qty:cart.push({id:uid++,key,item,picks,note,qty,unit,sel});h.sfx?.('add');render()}

 /* cart view */
 function renderCart(){const lines=cart.map(l=>`<div class="cn-line" data-id="${l.id}"><div class="e">${thumb(l.item)}</div><div class="m"><b>${esc(l.item.name)}</b><small>${esc(l.picks.join(' · '))}${l.note?` · “${esc(l.note)}”`:''}</small></div><div class="qty"><button data-a="-">−</button><b>${l.qty}</b><button data-a="+">+</button></div><div class="lp">${money(l.unit*l.qty)}</div></div>`).join('');
  const gift=h.canGift?.();if(!gift&&orderFor!=='me')orderFor='me';
  body.innerHTML=`<div class="cn-cart"><h3>${svg(ShoppingCart,20)} Your order</h3>${lines||'<p class="empty">Nothing here yet. Pick something tasty from the menu ♥</p>'}
   ${cart.length?`<div class="grp"><h4>Who is it for?</h4><div class="chips for"><button class="chip ${orderFor==='me'?'on':''}" data-f="me">🙋 Me</button><button class="chip ${orderFor==='partner'?'on':''}" data-f="partner" ${gift?'':'disabled'}>🎁 My love</button><button class="chip ${orderFor==='both'?'on':''}" data-f="both" ${gift?'':'disabled'}>💑 Both of us</button></div>${gift?'':'<small class="hint">Your partner is not in the lobby yet, so this order is for you.</small>'}</div>
   ${payHint()}<div class="cn-sum"><span>Items</span><b>${count()}</b></div><div class="cn-sum big"><span>Total</span><b>${money(total())}</b></div>`:''}</div>`;
  body.onclick=e=>{const f=e.target.closest('[data-f]');if(f&&!f.disabled){orderFor=f.dataset.f;renderCart();renderFoot();return}
   const a=e.target.closest('[data-a]');if(a){const id=+a.closest('.cn-line').dataset.id,l=cart.find(x=>x.id===id);payId=null;l.qty+=a.dataset.a==='+'?1:-1;if(l.qty<=0)cart=cart.filter(x=>x!==l);render()}}}

 function renderFoot(){const n=count();
  if(view==='cart')foot.innerHTML=`<button data-a="back">← Menu</button><button class="main" data-a="place" ${n&&!busy&&canPay()?'':'disabled'}>Place order · ${money(total())}</button>`;
  else foot.innerHTML=`<button class="main cartbtn" data-a="cart">🛒 ${n?`${n} item${n>1?'s':''} · ${money(total())} · View order`:'Your order is empty'}</button>`;
  foot.onclick=e=>{const a=e.target.closest('[data-a]')?.dataset.a;if(a==='cart'){view='cart';render()}else if(a==='back'){view='menu';render()}else if(a==='place')place()}}
 function render(){renderTabs();view==='cart'?renderCart():renderMenu();renderFoot();tabs.style.display=view==='cart'?'none':'flex'}

 /* placing the order: preparing -> ready on the counter */
 async function place(){if(!cart.length||busy)return;
  if(!h.pay){toast('Open the cinema from Twin Hearts to pay with your Gold Coins');return}
  if(bal!=null&&total()>bal){toast(`You need ${total()-bal} more Gold Coins`);return}
  busy=true;payId=payId||('c'+Date.now().toString(36)+Math.random().toString(36).slice(2,10));const order={id:payId,code:String(100+Math.floor(Math.random()*900)),lines:cart,for:orderFor,total:total()};
  const mine=order.for!=='partner';
  body.innerHTML=`<div class="cn-prep"><div class="big">${svg(ChefHat,64)}</div><h3>Order #${order.code}</h3><p>Preparing your order…</p><div class="bar"><i></i></div></div>`;foot.innerHTML='';
  let res;try{res=await h.pay({id:order.id,for:order.for,lines:order.lines.map(l=>({id:l.item.id,qty:l.qty,sel:l.sel}))})}catch(e){res={ok:false,error:'Could not reach Twin Hearts. Nothing was charged.'}}
  if(typeof res?.balance==='number'){bal=res.balance;renderBal()}
  if(!res?.ok){busy=false;view='cart';render();toast(res?.code==='insufficient'?`Not enough Gold Coins: you have ${res.balance}, this order needs ${res.need}`:(res?.error||'Payment failed. Nothing was charged.'));return}
  payId=null;h.sfx?.('bell');h.onOrder?.(order);
  setTimeout(()=>{busy=false;const kinds=order.lines.flatMap(l=>Array(Math.min(3,l.qty)).fill(0).flatMap(()=>l.item.vis2||[l.item.vis]));
   cart=[];orderFor='me';view='menu';close();
   addBag(order.lines,mine);
   if(order.for!=='me')h.onGift?.(order.lines.map(l=>({name:l.item.name,e:l.item.e,vis:l.item.vis,vis2:l.item.vis2,picks:l.picks,qty:l.qty})));
   h.onReady?.(order,kinds,mine);toast(mine?`Order #${order.code} is ready on the counter ♥ Enjoy!`:`Order #${order.code} sent to your love 🎁`)},3200)}

 /* ---------- snack bag (what you carry) ---------- */
 const bagState=()=>({popcorn:bag.some(b=>b.vis==='popcorn'||b.vis2?.includes('popcorn')),drink:bag.some(b=>b.vis==='drink'||b.vis2?.includes('drink'))});
 function addBag(lines,mine){if(!mine)return;for(const l of lines){const it=l.item||l,name=it.name,key=name+'|'+(l.picks||[]).join(',');const ex=bag.find(b=>b.key===key);if(ex)ex.left+=l.qty;else bag.push({key,name,e:it.e,vis:it.vis,vis2:it.vis2,picks:l.picks||[],left:l.qty})}bagChanged()}
 function receive(items){for(const l of items){const key=l.name+'|'+(l.picks||[]).join(','),ex=bag.find(b=>b.key===key);if(ex)ex.left+=l.qty;else bag.push({key,name:l.name,e:l.e,vis:l.vis,vis2:l.vis2,picks:l.picks||[],left:l.qty})}bagChanged();toast('💝 Your partner treated you: '+items.map(l=>`${l.qty}× ${l.name}`).join(', '));h.sfx?.('gift')}
 function bagChanged(){const n=bag.reduce((a,b)=>a+b.left,0);bagBtn.innerHTML=svg(ShoppingBasket,22)+(n?`<b class="bd">${n>99?'99+':n}</b>`:'');h.onBag?.(bagState());renderBag()}
 function renderBag(){bagPanel.innerHTML=`<div class="bp-h"><b>${svg(ShoppingBasket,18)} My snacks</b><button class="cn-x2">✕</button></div>`+(bag.length?bag.map((b,i)=>`<div class="bp-i"><span class="e">${thumb(b.name)}</span><span class="m"><b>${esc(b.name)}</b><small>${esc(b.picks.slice(0,4).join(' · '))}</small></span><span class="k">×${b.left}</span><button data-i="${i}">😋 Enjoy</button></div>`).join(''):'<p class="empty">Nothing yet. Order from the canteen in the lobby ♥</p>');
  bagPanel.onclick=e=>{if(e.target.closest('.cn-x2')){setBagOpen(false);return}const b=e.target.closest('button[data-i]');if(!b)return;const it=bag[+b.dataset.i];it.left--;h.sfx?.(it.vis==='drink'?'sip':it.vis==='popcorn'?'crunch':'bite');if(it.left<=0)bag.splice(+b.dataset.i,1);bagChanged();setBagOpen(true)}}
 const setBagOpen=o=>{bagPanel.style.display=o?'block':'none';bagBtn.classList.toggle('on',o);if(o)document.dispatchEvent(new CustomEvent('rail-open',{detail:'bag'}))};
 document.addEventListener('rail-open',e=>{if(e.detail!=='bag')setBagOpen(false)});
 bagBtn.onclick=()=>{renderBag();setBagOpen(bagPanel.style.display!=='block')};bagChanged();

 function openMenu(){if(open)return;open=true;view='menu';root.style.display='flex';renderBal();render();
  h.balance?.().then(b=>{if(typeof b==='number'){bal=b;renderBal();if(open){renderFoot();if(view==='cart')renderCart()}}}).catch(()=>{})}
 function close(){open=false;root.style.display='none';sheet.style.display='none';h.onClose?.()}
 $('.cn-x').onclick=()=>{if(!busy)close()};
 return{open:openMenu,close,get isOpen(){return open},receive,toast,showBag(on){bagBtn.style.display=on?'grid':'none';if(!on)setBagOpen(false)},get bagState(){return bagState()}}}
