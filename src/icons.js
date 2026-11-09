import {createElement,Play,RotateCcw,LogOut,Cloud,FolderOpen,Mail,ArrowRight,ArrowLeft,Heart,
 Coins,Popcorn,HeartHandshake,Hand,Sparkles,Armchair,Hourglass,Clapperboard,Pause,Maximize,VolumeX,Volume1,Volume2,Coffee,DoorOpen,
 MessageCircle,Bell,BellOff,Send,SlidersHorizontal,Music,SkipForward,Film,X,ScanFace,Users,User,RefreshCw,Target,Search,Eye,
 Binoculars,Monitor,Building2,Smile,Laugh,Footprints,Megaphone,Smartphone,Star,TriangleAlert,Moon,PersonStanding,Video,
 PanelsTopLeft,ShoppingCart,ShoppingBasket,Gift,ChefHat,Plus,Square,ArrowLeftFromLine,ArrowRightFromLine,Layers,
 IceCreamCone,CupSoda,Sandwich,Pizza,Croissant,Donut,Cake,Candy,Lollipop,Citrus,GlassWater,Cookie,Utensils,Drumstick,Wheat,Beef,Cherry,Dessert,Flame,HandHeart,Ticket,Rotate3d,Milk} from 'lucide';

/** Lucide icons for every button in the theatre. ic(icon) -> an <svg>.
    mountIcons() watches the page and swaps a leading emoji/symbol in any button (even ones built later) for a Lucide icon,
    so labels like '🍿 Popcorn' or '⏸' just work. Elements inside [data-keep-emoji] (the meme sound-board) keep their emoji. */
export const ic=(icon,size=18,fill)=>{const s=createElement(icon,{width:size,height:size,'stroke-width':2,class:'lc'});if(fill)s.setAttribute('fill','currentColor');return s};

// emoji (without the FE0F selector) -> [Lucide icon, filled?]
const MAP={
 '💌':[Mail],'▶':[Play,1],'⏸':[Pause,1],'⏹':[Square,1],'🎞':[FolderOpen],'☁':[Cloud],'↻':[RotateCcw],'✕':[X],'←':[ArrowLeft],'➤':[Send],'⛶':[Maximize],
 '💗':[Heart,1],'💙':[Heart,1],'❤':[Heart,1],'💜':[Heart,1],'💕':[HeartHandshake],'💞':[HeartHandshake],'💑':[Users],'💝':[Gift],
 '🚪':[DoorOpen],'🎬':[Clapperboard],'🙂':[ScanFace],'🧍':[PersonStanding],'🔄':[RefreshCw],'💬':[MessageCircle],'🔔':[Bell],'🔕':[BellOff],
 '🔊':[Volume2],'🔉':[Volume1],'🔈':[Volume1],'🔇':[VolumeX],'🎥':[Video],'🪑':[Armchair],'⏳':[Hourglass],'☕':[Coffee],'🍿':[Popcorn],
 '👋':[Hand],'👏':[HandHeart],'🪟':[PanelsTopLeft],'🎚':[SlidersHorizontal],'🎵':[Music],'⏭':[SkipForward],'😂':[Laugh],'😊':[Smile],
 '🎯':[Target],'🔍':[Search],'🦅':[Binoculars],'⬅':[ArrowLeftFromLine],'➡':[ArrowRightFromLine],'👀':[Eye],'👫':[Users],'🏛':[Building2],'🖥':[Monitor],
 '🛒':[ShoppingCart],'🧺':[ShoppingBasket],'🙋':[User],'🎁':[Gift],'👩‍🍳':[ChefHat],'😋':[Utensils],'➕':[Plus],'📢':[Megaphone],'📱':[Smartphone],
 '⭐':[Star,1],'★':[Star,1],'⚠':[TriangleAlert],'🌙':[Moon],'👥':[Users],'👣':[Footprints],'🎟':[Ticket],'🔭':[Binoculars],'✨':[Sparkles]
};
const KEYS=Object.keys(MAP).sort((a,b)=>b.length-a.length);
const clean=s=>s.replace(/\uFE0F/g,'');
const mk=k=>{const [i,f]=MAP[k];const s=ic(i,18,f);s.setAttribute('data-ic',k);return s};

/** puts the text in el with a Lucide icon in front when it starts with a mapped emoji (existing labels keep working) */
export function iconize(el,text){el.textContent='';const t=clean(text),k=KEYS.find(k=>t.startsWith(k));
 if(k){el.append(mk(k),t.slice(k.length).trim())}else el.append(text);return el}

const SEL='#ov,#st-user i,.vw-c i,button,label.pick,a.inv-b,.btn,.cn-x,.cn-x2,.chip,.cn-tabs button,.bp-i button,#vw button,#volpanel label span';
function fix(el){
 if(el.closest('[data-keep-emoji]'))return;
 for(const n of [...el.childNodes]){
  if(n.nodeType!==3)continue;const t=clean(n.nodeValue),s=t.trimStart(),k=KEYS.find(k=>s.startsWith(k));
  if(!k)continue;
  // only a leading symbol is swapped; emoji in the middle of a sentence stay as written
  if(el.firstChild!==n&&!(el.firstChild?.nodeType===1&&el.firstChild.tagName==='SPAN'&&!el.firstChild.textContent.trim()))continue;
  const rest=s.slice(k.length).replace(/^\s+/,'');
  n.nodeValue=rest;n.before(mk(k));break}
}
function scan(root){if(root.nodeType!==1)return;if(root.matches?.(SEL))fix(root);root.querySelectorAll?.(SEL).forEach(fix)}

/** call once at start */
export function mountIcons(){
 scan(document.body);
 let q=new Set(),raf=0;
 const flush=()=>{raf=0;const a=[...q];q=new Set();mo.disconnect();a.forEach(n=>{if(n.isConnected)scan(n)});mo.observe(document.body,OPT)};
 const OPT={childList:true,subtree:true,characterData:true};
 const mo=new MutationObserver(ms=>{for(const m of ms){const n=m.target.nodeType===3?m.target.parentElement:m.target;if(n)q.add(n);m.addedNodes.forEach(a=>{if(a.nodeType===1)q.add(a)})}
  if(!raf)raf=requestAnimationFrame(flush)});
 mo.observe(document.body,OPT);
}
export {Megaphone,SkipForward,Hourglass,Coins,Play,RotateCcw,LogOut,Cloud,FolderOpen,Mail,ArrowRight,ArrowLeft,Heart,Popcorn,Layers,Rotate3d,Flame,HandHeart,
 IceCreamCone,CupSoda,Sandwich,Pizza,Croissant,Donut,Cake,Candy,Lollipop,Citrus,GlassWater,Cookie,Utensils,Drumstick,Wheat,Beef,Cherry,Dessert,Milk,ChefHat,Coffee,Gift,HeartHandshake,ShoppingCart,ShoppingBasket,Film,Sparkles,Plus,X};
