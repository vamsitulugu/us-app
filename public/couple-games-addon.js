/* ═══════════════════════════════════════════════════════════════
   COUPLE GAMES — ADDON PACK
   Adds 2 new premium games to the existing hub without touching
   any existing game code:
     🌍 Around The World   (id: 'atw')   — integrates with Memory Globe
     🚀 Space Date Adventure (id: 'space') — co-op space missions

   HOW TO INSTALL (3 tiny edits to the main file, nothing else):
   1) Add this line right before the closing </script> of the main
      Couple Games file (just before `Hub.init();`):
          <script src="couple-games-addon.js"></script>
      ...or simply paste this file's contents right before `Hub.init();`.

   2) Inside Hub.openGame(id), add two branches next to the existing
      ones (anywhere in that if/else chain):
          else if(id==='atw') AroundWorld.open(body);
          else if(id==='space') SpaceDate.open(body);

   3) Inside Hub.exitGame(), add 'AroundWorld' and 'SpaceDate' to the
      array of module names that get closed:
          ['LoveAdventure','Island','Draw','Escape','TOD','DreamHome','AroundWorld','SpaceDate']

   Everything else (GAMES card, achievements, CSS) is injected
   automatically by this file at load time — no other edits needed.
═══════════════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ── inject CSS ── */
const css = `
/* ═══ AROUND THE WORLD ═══ */
.atw-wrap{display:flex;flex-direction:column;height:100%}
.atw-tabs{display:flex;gap:8px;padding:10px 14px;overflow-x:auto;border-bottom:1px solid var(--border);flex-shrink:0}
.atw-tabs::-webkit-scrollbar{height:0}
.atw-tab{flex-shrink:0;padding:8px 14px;border-radius:14px;background:var(--g1);border:1px solid var(--border);cursor:pointer;font-size:12px;font-weight:700;color:var(--text2);transition:var(--t)}
.atw-tab.sel{color:#fff;border-color:var(--accent);background:var(--g2);box-shadow:0 0 0 2px var(--accent-glow)}
.atw-body{flex:1;overflow-y:auto;padding:14px}
.atw-hero{border-radius:20px;padding:20px;position:relative;overflow:hidden;margin-bottom:14px;background:linear-gradient(135deg,rgba(126,232,255,.18),rgba(255,107,157,.10));border:1px solid var(--border2);text-align:center}
.atw-hero-emoji{font-size:44px;margin-bottom:6px}
.atw-hero-title{font-family:var(--ff-serif);font-size:19px;color:#fff}
.atw-hero-sub{font-size:12px;color:var(--text2);margin-top:4px}
.atw-stat-row{display:flex;gap:8px;margin-top:12px;justify-content:center;flex-wrap:wrap}
.atw-stat{background:rgba(255,255,255,.08);border:1px solid var(--border2);border-radius:14px;padding:8px 14px;font-size:11px;font-weight:700;color:#fff}
.atw-stat b{display:block;font-family:var(--ff-serif);font-size:18px;color:var(--dia)}
.atw-passport{background:linear-gradient(160deg,#1a2a0d,#0d1a2a);border:1px solid var(--border2);border-radius:20px;padding:16px;margin-bottom:14px}
.atw-passport-title{font-family:var(--ff-serif);font-size:16px;color:#ffe9a8;display:flex;align-items:center;gap:8px;margin-bottom:10px}
.atw-stamp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:10px}
.atw-stamp{aspect-ratio:1;border-radius:14px;border:2px dashed var(--border2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;position:relative;transition:var(--ts);cursor:pointer}
.atw-stamp.done{border-style:solid;border-color:var(--gold);background:rgba(255,201,74,.12);transform:rotate(-3deg)}
.atw-stamp.done:nth-child(even){transform:rotate(2deg)}
.atw-stamp-emoji{font-size:26px}
.atw-stamp-name{font-size:8.5px;font-weight:700;color:var(--text2);text-align:center;padding:0 3px}
.atw-stamp.done .atw-stamp-name{color:#ffe9a8}
.atw-country-card{background:var(--g1);border:1px solid var(--border);border-radius:16px;padding:14px;margin-bottom:10px}
.atw-country-top{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.atw-country-flag{font-size:30px}
.atw-country-name{font-weight:700;color:#fff;font-size:14px}
.atw-country-sub{font-size:10.5px;color:var(--text3)}
.atw-landmark-row{display:flex;gap:7px;overflow-x:auto;margin-top:6px}
.atw-landmark-row::-webkit-scrollbar{height:0}
.atw-landmark{flex-shrink:0;width:58px;text-align:center;padding:6px 4px;border-radius:12px;background:var(--g1);border:1px solid var(--border);opacity:.35}
.atw-landmark.unlocked{opacity:1;border-color:var(--dia);background:rgba(126,232,255,.1)}
.atw-landmark-emoji{font-size:19px}
.atw-landmark-name{font-size:7.5px;color:var(--text3);font-weight:700;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.atw-souvenir-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.atw-souvenir{padding:4px 10px;border-radius:20px;background:rgba(255,201,74,.12);border:1px solid rgba(255,201,74,.3);color:var(--gold);font-size:10.5px;font-weight:700}
.atw-add-form{background:var(--g1);border:1px solid var(--border);border-radius:16px;padding:14px;margin-bottom:14px}
.atw-input-row{display:flex;gap:8px;margin-bottom:8px}
.atw-input-row input,.atw-input-row select{flex:1;padding:10px 13px;border-radius:12px;background:var(--g2);border:1px solid var(--border);color:#fff;font-size:12.5px}
.atw-memory-badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(52,211,153,.15);color:var(--green);border:1px solid rgba(52,211,153,.3);margin-top:6px}
.atw-challenge-card{background:linear-gradient(135deg,rgba(255,201,74,.12),rgba(126,232,255,.08));border:1px solid rgba(255,201,74,.25);border-radius:16px;padding:14px;margin-bottom:10px;display:flex;align-items:center;gap:12px}
.atw-challenge-ico{font-size:28px;flex-shrink:0}
.atw-challenge-title{font-size:12.5px;font-weight:700;color:#fff}
.atw-challenge-sub{font-size:10.5px;color:var(--text2);margin-top:2px}

/* ═══ SPACE DATE ADVENTURE ═══ */
.sp-wrap{display:flex;flex-direction:column;height:100%;background:radial-gradient(ellipse at 50% 0%,#1a1040,#04040c 70%);border-radius:14px;overflow:hidden;position:relative}
.sp-stars{position:absolute;inset:0;pointer-events:none}
.sp-topbar{display:flex;align-items:center;gap:8px;padding:10px 14px;position:relative;z-index:2;flex-wrap:wrap}
.sp-chip{font-size:10.5px;font-weight:800;padding:5px 11px;border-radius:20px;background:rgba(255,255,255,.08);border:1px solid var(--border2);color:#fff;display:flex;align-items:center;gap:5px}
.sp-hpbar{flex:1;min-width:80px;height:9px;border-radius:6px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid var(--border2)}
.sp-hpfill{height:100%;background:linear-gradient(90deg,#ff6b6b,#ffd166);transition:width .4s}
.sp-fuelfill{height:100%;background:linear-gradient(90deg,#4fa8ff,#7ee8ff);transition:width .4s}
.sp-galaxy-select{position:relative;z-index:2;padding:8px 14px;display:flex;gap:8px;overflow-x:auto}
.sp-galaxy-select::-webkit-scrollbar{height:0}
.sp-galaxy-chip{flex-shrink:0;padding:8px 14px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid var(--border2);color:var(--text2);font-size:11.5px;font-weight:700;cursor:pointer}
.sp-galaxy-chip.sel{color:#fff;border-color:var(--accent2);background:rgba(219,80,255,.15);box-shadow:0 0 0 2px var(--accent2-glow)}
.sp-galaxy-chip.locked{opacity:.35}
.sp-scene{flex:1;position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px;text-align:center;overflow:hidden}
.sp-planet{font-size:80px;filter:drop-shadow(0 0 30px rgba(126,232,255,.4));animation:spFloat 4s ease-in-out infinite}
@keyframes spFloat{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-14px) rotate(3deg)}}
.sp-mission-title{font-family:var(--ff-serif);font-size:19px;color:#fff;margin-top:10px}
.sp-mission-desc{font-size:12.5px;color:var(--text2);margin-top:6px;max-width:320px;line-height:1.6}
.sp-astronauts{display:flex;gap:16px;margin-top:14px}
.sp-astro{font-size:34px;animation:spBob 2.6s ease-in-out infinite}
.sp-astro:nth-child(2){animation-delay:.4s}
@keyframes spBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
#spGameCanvas{border-radius:16px;background:linear-gradient(180deg,#0a0a20,#000);touch-action:none;max-width:100%}
.sp-hud-score{position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.5);color:#fff;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:800;z-index:3}
.sp-btnrow{display:flex;gap:10px;margin-top:14px;position:relative;z-index:2;flex-wrap:wrap;justify-content:center}
.sp-powerup-row{display:flex;gap:8px;margin-top:10px;justify-content:center;flex-wrap:wrap}
.sp-powerup{padding:7px 13px;border-radius:20px;background:rgba(255,255,255,.08);border:1px solid var(--border2);font-size:11px;font-weight:700;color:#fff;cursor:pointer;transition:var(--t)}
.sp-powerup:hover{background:rgba(255,255,255,.16)}
.sp-powerup.used{opacity:.3;pointer-events:none}
.sp-repair-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;max-width:280px}
.sp-repair-btn{aspect-ratio:1;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid var(--border2);font-size:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:var(--t)}
.sp-repair-btn.fixed{background:rgba(52,211,153,.25);border-color:var(--green)}
.sp-galaxy-map{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:10px;padding:14px;position:relative;z-index:2}
.sp-galaxy-node{aspect-ratio:1;border-radius:16px;background:rgba(255,255,255,.05);border:1px solid var(--border2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;transition:var(--ts)}
.sp-galaxy-node:hover{transform:scale(1.05)}
.sp-galaxy-node.locked{opacity:.3;pointer-events:none}
.sp-galaxy-node-emoji{font-size:28px}
.sp-galaxy-node-name{font-size:9.5px;font-weight:700;color:var(--text2)}
`;
const styleTag = document.createElement('style');
styleTag.textContent = css;
document.head.appendChild(styleTag);

/* wait for main hub globals to exist */
function ready(fn){
  if (window.GameCore && window.GameChannel && window.GAMES && window.ACHIEVEMENTS && window.Snd) fn();
  else setTimeout(()=>ready(fn), 60);
}

ready(function(){

/* ── register hub cards ── */
GAMES.push(
  {id:'atw', title:'Around The World', emoji:'🌍', badge:'new', grad:'linear-gradient(135deg,#0d2a1a,#0d3a5c)',
    desc:'Log real trips, collect passport stamps, unlock landmarks & souvenirs. Syncs with Memory Globe.',
    tags:['✈️ Travel','⏱ Ongoing','✨ 30 XP/country']},
  {id:'space', title:'Space Date Adventure', emoji:'🚀', badge:'trend', grad:'linear-gradient(135deg,#1a0d3a,#0d0d2a)',
    desc:'Two astronauts, one ship. Dodge meteors, collect stars, repair the hull & unlock galaxies together.',
    tags:['🪐 Co-op','⏱ 5-15m','✨ 25 XP/mission']}
);

/* ── register achievements ── */
[
  {id:'atw_first',ico:'🛂',name:'First Stamp',desc:'Log your first country'},
  {id:'atw_5countries',ico:'🌍',name:'Globetrotters',desc:'Visit 5 countries together'},
  {id:'atw_passport_full',ico:'📔',name:'Full Passport',desc:'Fill every passport page'},
  {id:'atw_landmark',ico:'🗿',name:'Landmark Hunter',desc:'Unlock a landmark'},
  {id:'atw_memory_sync',ico:'🔗',name:'True Story',desc:'Log a country backed by a real Memory Globe pin'},
  {id:'space_first',ico:'👩‍🚀',name:'Liftoff',desc:'Complete your first mission'},
  {id:'space_repair',ico:'🔧',name:'Fix-It Duo',desc:'Repair the ship together'},
  {id:'space_1000stars',ico:'✨',name:'Star Collectors',desc:'Collect 1000 stars combined'},
  {id:'space_galaxy2',ico:'🌌',name:'Galaxy Hopper',desc:'Unlock a second galaxy'},
  {id:'space_meteorwave',ico:'☄️',name:'Meteor Master',desc:'Survive a full meteor wave without damage'},
].forEach(a=>{ if(!ACHIEVEMENTS.find(x=>x.id===a.id)) ACHIEVEMENTS.push(a); });

/* ═══════════════════════════════════════════════════════
   🌍 AROUND THE WORLD
═══════════════════════════════════════════════════════ */
const ATW_COUNTRIES = [
  {name:'India',flag:'🇮🇳',landmarks:[['Taj Mahal','🕌'],['Gateway of India','🚪'],['Kerala Backwaters','🚤']],souvenir:'Handwoven Scarf'},
  {name:'France',flag:'🇫🇷',landmarks:[['Eiffel Tower','🗼'],['Louvre','🖼️'],['Nice Coast','🏖️']],souvenir:'Perfume Bottle'},
  {name:'Japan',flag:'🇯🇵',landmarks:[['Mt. Fuji','🗻'],['Fushimi Torii','⛩️'],['Shibuya','🏙️']],souvenir:'Ceramic Cup'},
  {name:'Italy',flag:'🇮🇹',landmarks:[['Colosseum','🏛️'],['Venice Canals','🚣'],['Leaning Tower','🗼']],souvenir:'Gelato Spoon'},
  {name:'United States',flag:'🇺🇸',landmarks:[['Statue of Liberty','🗽'],['Grand Canyon','🏜️'],['Golden Gate','🌉']],souvenir:'Snow Globe'},
  {name:'Thailand',flag:'🇹🇭',landmarks:[['Grand Palace','🏯'],['Phi Phi Islands','🏝️'],['Floating Market','🛶']],souvenir:'Silk Pouch'},
  {name:'United Kingdom',flag:'🇬🇧',landmarks:[['Big Ben','🕰️'],['London Eye','🎡'],['Stonehenge','🪨']],souvenir:'Tea Tin'},
  {name:'Maldives',flag:'🇲🇻',landmarks:[['Overwater Villa','🏝️'],['Coral Reef','🐠'],['Sandbank','🏖️']],souvenir:'Seashell Necklace'},
  {name:'Switzerland',flag:'🇨🇭',landmarks:[['Matterhorn','⛰️'],['Lake Geneva','🚤'],['Chocolate House','🍫']],souvenir:'Cuckoo Clock'},
  {name:'Indonesia',flag:'🇮🇩',landmarks:[['Bali Temples','🛕'],['Borobudur','🕍'],['Rice Terraces','🌾']],souvenir:'Batik Cloth'},
  {name:'UAE',flag:'🇦🇪',landmarks:[['Burj Khalifa','🏙️'],['Desert Safari','🐪'],['Palm Jumeirah','🌴']],souvenir:'Gold Trinket'},
  {name:'Greece',flag:'🇬🇷',landmarks:[['Parthenon','🏛️'],['Santorini','🌅'],['Ancient Agora','🏺']],souvenir:'Evil Eye Charm'},
];
const ATW_CHALLENGES = [
  {ico:'🛂',title:'Log a new country to your passport',reward:30},
  {ico:'🗿',title:'Unlock a landmark in a visited country',reward:25},
  {ico:'🎁',title:'Collect a souvenir from any country',reward:20},
  {ico:'📖',title:'Add trip notes to a Memory Globe pin',reward:25},
];
function atwToday(){ const d=new Date(); const idx=(d.getFullYear()*400+d.getMonth()*31+d.getDate())%ATW_CHALLENGES.length; return ATW_CHALLENGES[idx]; }

const AroundWorld = {
  chan:null, state:null, tab:'passport', globeMemories:null,
  async open(body){
    this.chan = new window.GameChannel('atw');
    let st = await this.chan.load();
    if(!st) st = { visited:{}, landmarks:{}, souvenirs:{} }; // visited[country]=true, landmarks[country]=[names], souvenirs[country]=true
    this.state = st;
    this.chan.listen(payload=>{ if(payload.type==='sync'){ this.state=payload.state; this.render(); } });
    await this.fetchGlobeMemories();
    this.render();
  },
  close(){ if(this.chan) this.chan.close(); },
  sync(){ this.chan.send({type:'sync',state:this.state}); this.chan.persist(this.state); },
  async fetchGlobeMemories(){
    try{
      let coupleId=null;
      try{ const raw=localStorage.getItem('uwl_v5'); if(raw) coupleId=JSON.parse(raw).coupleId; }catch(e){}
      if(!coupleId){ this.globeMemories=[]; return; }
      const res = await fetch(`https://us-app-av6d.onrender.com/api/globe/${coupleId}`);
      this.globeMemories = res.ok ? await res.json() : [];
    }catch(e){ this.globeMemories = []; }
  },
  countryHasMemory(name){ return (this.globeMemories||[]).some(m=>(m.country||'').toLowerCase()===name.toLowerCase()); },
  render(){
    const body=document.getElementById('goBody'); if(!body) return;
    body.className='gobody nopad';
    body.innerHTML = `<div class="atw-wrap">
      <div class="atw-tabs" id="atwTabs"></div>
      <div class="atw-body" id="atwBody"></div>
    </div>`;
    this.renderTabs(); this.renderBody();
  },
  renderTabs(){
    const el=document.getElementById('atwTabs'); if(!el) return;
    const tabs=[['passport','🛂 Passport'],['countries','🌍 Countries'],['challenges','🎯 Challenges']];
    el.innerHTML = tabs.map(([id,label])=>`<div class="atw-tab ${this.tab===id?'sel':''}" onclick="AroundWorld.setTab('${id}')">${label}</div>`).join('');
  },
  setTab(t){ this.tab=t; window.Snd.tap(); this.renderTabs(); this.renderBody(); },
  countriesVisitedCount(){ return Object.keys(this.state.visited).length; },
  landmarksCount(){ return Object.values(this.state.landmarks).reduce((s,a)=>s+a.length,0); },
  renderBody(){
    const el=document.getElementById('atwBody'); if(!el) return;
    const visitedN = this.countriesVisitedCount();
    if(this.tab==='passport'){
      el.innerHTML = `
        <div class="atw-hero">
          <div class="atw-hero-emoji">🧳</div>
          <div class="atw-hero-title">Our Travel Passport</div>
          <div class="atw-hero-sub">Every trip you log together fills a page</div>
          <div class="atw-stat-row">
            <div class="atw-stat"><b>${visitedN}</b>Countries</div>
            <div class="atw-stat"><b>${this.landmarksCount()}</b>Landmarks</div>
            <div class="atw-stat"><b>${Object.keys(this.state.souvenirs).length}</b>Souvenirs</div>
          </div>
        </div>
        <div class="atw-passport">
          <div class="atw-passport-title">📔 Passport Pages <span style="color:var(--text3);font-weight:400;font-size:11px;margin-left:auto">${visitedN}/${ATW_COUNTRIES.length}</span></div>
          <div class="atw-stamp-grid">
            ${ATW_COUNTRIES.map(c=>`<div class="atw-stamp ${this.state.visited[c.name]?'done':''}" onclick="AroundWorld.setTab('countries')" title="${c.name}">
              <div class="atw-stamp-emoji">${this.state.visited[c.name]?c.flag:'❔'}</div>
              <div class="atw-stamp-name">${this.state.visited[c.name]?c.name:'???'}</div>
            </div>`).join('')}
          </div>
        </div>
        <button class="btn btn-accent" style="width:100%;justify-content:center" onclick="AroundWorld.setTab('countries')">✈️ Log a New Trip</button>
      `;
      return;
    }
    if(this.tab==='countries'){
      el.innerHTML = `
        <div class="atw-add-form">
          <div style="font-size:12.5px;font-weight:700;color:#fff;margin-bottom:8px">✈️ Log a Country You've Visited</div>
          <div class="atw-input-row">
            <select id="atwCountrySelect">
              <option value="">Choose a country...</option>
              ${ATW_COUNTRIES.map(c=>`<option value="${c.name}">${c.flag} ${c.name}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-pink btn-sm" style="width:100%;justify-content:center" onclick="AroundWorld.logCountry()">📍 Add to Passport</button>
        </div>
        ${ATW_COUNTRIES.filter(c=>this.state.visited[c.name]).map(c=>this.renderCountryCard(c)).join('') || '<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">No countries logged yet — add your first above!</div>'}
      `;
      return;
    }
    // challenges
    const dc = atwToday();
    const doneKey = 'atw_daily_'+todayStr();
    const done = localStorage.getItem(doneKey)==='1';
    el.innerHTML = `
      <div class="atw-challenge-card">
        <div class="atw-challenge-ico">${dc.ico}</div>
        <div style="flex:1">
          <div class="atw-challenge-title">${done?'✅ Completed today':dc.title}</div>
          <div class="atw-challenge-sub">Reward: 🪙 ${dc.reward} coins</div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);line-height:1.7;padding:0 4px">
        Complete travel actions in the Countries tab (log a country, unlock a landmark, or collect a souvenir) to auto-complete today's challenge. Trips that already exist as pins on your Memory Globe are recognized automatically and marked with a 🔗 badge.
      </div>
    `;
  },
  renderCountryCard(c){
    const landmarksUnlocked = this.state.landmarks[c.name]||[];
    const hasSouvenir = !!this.state.souvenirs[c.name];
    const hasRealMemory = this.countryHasMemory(c.name);
    return `<div class="atw-country-card">
      <div class="atw-country-top">
        <div class="atw-country-flag">${c.flag}</div>
        <div style="flex:1">
          <div class="atw-country-name">${c.name}</div>
          <div class="atw-country-sub">${landmarksUnlocked.length}/${c.landmarks.length} landmarks unlocked</div>
        </div>
      </div>
      ${hasRealMemory ? `<div class="atw-memory-badge">🔗 Backed by a real Memory Globe pin</div>` : ''}
      <div class="atw-landmark-row">
        ${c.landmarks.map(([name,emoji])=>{
          const un = landmarksUnlocked.includes(name);
          return `<div class="atw-landmark ${un?'unlocked':''}" onclick="AroundWorld.unlockLandmark('${c.name}','${name}')">
            <div class="atw-landmark-emoji">${un?emoji:'🔒'}</div>
            <div class="atw-landmark-name">${name}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="atw-souvenir-row">
        ${hasSouvenir ? `<span class="atw-souvenir">🎁 ${c.souvenir}</span>` : `<button class="btn btn-glass btn-xs" onclick="AroundWorld.collectSouvenir('${c.name}')">🎁 Collect Souvenir (🪙15)</button>`}
      </div>
    </div>`;
  },
  completeDailyIfPending(){
    const doneKey = 'atw_daily_'+todayStr();
    if(localStorage.getItem(doneKey)!=='1'){
      localStorage.setItem(doneKey,'1');
      const dc=atwToday();
      window.GameCore.addCoins(dc.reward);
      window.toast('🎉 Daily travel challenge complete! +'+dc.reward+' coins',3000);
    }
  },
  logCountry(){
    const sel=document.getElementById('atwCountrySelect');
    const name=sel.value; if(!name){ window.toast('Pick a country first ✈️'); return; }
    if(this.state.visited[name]){ window.toast('Already in your passport! 📔'); return; }
    this.state.visited[name]=true;
    if(!this.state.landmarks[name]) this.state.landmarks[name]=[];
    window.GameCore.unlock('atw_first');
    if(this.countryHasMemory(name)) window.GameCore.unlock('atw_memory_sync');
    if(this.countriesVisitedCount()>=5) window.GameCore.unlock('atw_5countries');
    if(this.countriesVisitedCount()>=ATW_COUNTRIES.length) window.GameCore.unlock('atw_passport_full');
    window.GameCore.addXP(30);
    this.completeDailyIfPending();
    window.Snd.success(); window.confetti(60);
    this.sync(); this.render();
    window.showReward('🛂','New Stamp!',[name,'✨ 30 XP']);
  },
  unlockLandmark(country,landmark){
    if(!this.state.visited[country]){ window.toast('Log this country first!'); return; }
    if(!this.state.landmarks[country]) this.state.landmarks[country]=[];
    if(this.state.landmarks[country].includes(landmark)) return;
    if(window.GameCore.me().coins<20){ window.toast('Need 🪙20 to unlock a landmark'); return; }
    window.GameCore.addCoins(-20);
    this.state.landmarks[country].push(landmark);
    window.GameCore.unlock('atw_landmark');
    window.GameCore.addXP(15);
    this.completeDailyIfPending();
    window.Snd.unlock();
    this.sync(); this.render();
  },
  collectSouvenir(country){
    if(this.state.souvenirs[country]) return;
    if(window.GameCore.me().coins<15){ window.toast('Need 🪙15 to collect a souvenir'); return; }
    window.GameCore.addCoins(-15);
    this.state.souvenirs[country]=true;
    window.GameCore.addXP(10);
    this.completeDailyIfPending();
    window.Snd.coin();
    this.sync(); this.render();
  }
};
function todayStr(){ return new Date().toISOString().slice(0,10); }
window.AroundWorld = AroundWorld;

/* ═══════════════════════════════════════════════════════
   🚀 SPACE DATE ADVENTURE
═══════════════════════════════════════════════════════ */
const SP_GALAXIES = [
  {id:'nebula', name:'Rosy Nebula', emoji:'🌸', unlockStars:0, planet:'🪐'},
  {id:'crystal', name:'Crystal Belt', emoji:'💎', unlockStars:400, planet:'🌕'},
  {id:'aurora', name:'Aurora Field', emoji:'🌌', unlockStars:1000, planet:'🌎'},
  {id:'golden', name:'Golden Reach', emoji:'✨', unlockStars:2000, planet:'☀️'},
];
const SP_MISSIONS = [
  {type:'collect', title:'Star Collection Run', desc:'Fly through the field and collect as many stars as you can in 30 seconds. Dodge the meteors!'},
  {type:'repair', title:'Hull Repair', desc:'The ship took damage! Tap the flashing panels together, fast, to patch every leak before time runs out.'},
];

const SpaceDate = {
  chan:null, state:null, galaxy:'nebula', mode:'map', raf:null, canvas:null, ctx:null,
  ship:null, stars:[], meteors:[], gameTimer:null, timeLeft:30, running:false, powerupsUsed:{},
  async open(body){
    this.chan = new window.GameChannel('space');
    let st = await this.chan.load();
    if(!st) st = { totalStars:0, hp:100, fuel:100, galaxiesUnlocked:['nebula'], missionsDone:0, repaired:0 };
    this.state = st;
    this.chan.listen(payload=>{
      if(payload.type==='sync'){ this.state=payload.state; if(this.mode==='map') this.renderMap(); }
      if(payload.type==='repairTap'){ this.remoteRepairTap(payload.idx); }
    });
    this.mode='map';
    this.render(body);
  },
  close(){ this.stopLoop(); clearInterval(this.gameTimer); if(this.chan) this.chan.close(); },
  sync(){ this.chan.send({type:'sync',state:this.state}); this.chan.persist(this.state); },
  render(body){
    body = body || document.getElementById('goBody');
    body.className='gobody nopad';
    if(this.mode==='map') this.renderMap(body);
    else if(this.mode==='mission') this.renderMissionIntro(body);
    else if(this.mode==='play') this.renderPlay(body);
    else if(this.mode==='repair') this.renderRepair(body);
  },
  isGalaxyUnlocked(g){ return this.state.totalStars>=g.unlockStars; },
  renderMap(body){
    body = body || document.getElementById('goBody');
    body.innerHTML = `<div class="sp-wrap" style="min-height:420px">
      <canvas class="sp-stars" id="spBgStars" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
      <div class="sp-topbar">
        <div class="sp-chip">✨ ${this.state.totalStars} stars</div>
        <div class="sp-chip">❤️ HP</div><div class="sp-hpbar"><div class="sp-hpfill" style="width:${this.state.hp}%"></div></div>
        <div class="sp-chip">⛽</div><div class="sp-hpbar"><div class="sp-fuelfill" style="width:${this.state.fuel}%"></div></div>
      </div>
      <div class="sp-galaxy-map">
        ${SP_GALAXIES.map(g=>{
          const unlocked=this.isGalaxyUnlocked(g);
          return `<div class="sp-galaxy-node ${unlocked?'':'locked'}" onclick="${unlocked?`SpaceDate.enterGalaxy('${g.id}')`:''}" title="${unlocked?g.name:'Unlocks at '+g.unlockStars+' stars'}">
            <div class="sp-galaxy-node-emoji">${unlocked?g.emoji:'🔒'}</div>
            <div class="sp-galaxy-node-name">${unlocked?g.name:g.unlockStars+'✨ to unlock'}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="sp-scene" style="flex:0 0 auto;padding-bottom:20px">
        <div class="sp-planet">${(SP_GALAXIES.find(g=>g.id===this.galaxy)||SP_GALAXIES[0]).planet}</div>
        <div class="sp-mission-title">${(SP_GALAXIES.find(g=>g.id===this.galaxy)||SP_GALAXIES[0]).name}</div>
        <div class="sp-mission-desc">Choose a co-op mission below — you and ${window.ID?window.ID.partnerName:'your partner'} share the same ship, HP and fuel.</div>
        <div class="sp-astronauts"><div class="sp-astro">👩‍🚀</div><div class="sp-astro">🧑‍🚀</div></div>
        <div class="sp-btnrow">
          <button class="btn btn-accent" onclick="SpaceDate.startMission('collect')">🌠 Star Collection Run</button>
          <button class="btn btn-pink" onclick="SpaceDate.startMission('repair')">🔧 Hull Repair</button>
        </div>
      </div>
    </div>`;
    this.drawBgStars();
  },
  enterGalaxy(id){ this.galaxy=id; window.Snd.whoosh(); this.renderMap(); },
  drawBgStars(){
    const c=document.getElementById('spBgStars'); if(!c) return;
    const ctx=c.getContext('2d'); const wrap=c.parentElement;
    c.width=wrap.clientWidth; c.height=wrap.clientHeight;
    const stars=Array.from({length:80},()=>({x:Math.random()*c.width,y:Math.random()*c.height,r:Math.random()*1.6,a:Math.random()}));
    let t=0;
    const draw=()=>{
      if(this.mode!=='map'){ return; }
      t+=0.02; ctx.clearRect(0,0,c.width,c.height);
      stars.forEach(s=>{ const al=0.3+0.7*Math.abs(Math.sin(t+s.a*10)); ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,7); ctx.fillStyle=`rgba(255,255,255,${al})`; ctx.fill(); });
      requestAnimationFrame(draw);
    };
    draw();
  },
  startMission(type){
    this.currentMission = SP_MISSIONS.find(m=>m.type===type);
    if(type==='repair'){ this.mode='repair'; this.render(); }
    else { this.mode='play'; this.render(); }
  },
  /* ── STAR COLLECTION MINI GAME (canvas) ── */
  renderPlay(body){
    body = body || document.getElementById('goBody');
    body.innerHTML = `<div class="sp-wrap" style="min-height:420px">
      <div class="sp-topbar">
        <button class="gohead-btn" style="width:30px;height:30px;font-size:12px" onclick="SpaceDate.exitToMap()">←</button>
        <div class="sp-chip">⏱ <span id="spTimeLeft">30</span>s</div>
        <div class="sp-chip">✨ <span id="spRoundScore">0</span></div>
      </div>
      <div class="sp-scene" style="padding:6px">
        <div class="sp-hud-score" style="position:static;margin-bottom:6px">Drag / move your finger to fly · avoid ☄️ · grab ⭐</div>
        <canvas id="spGameCanvas" width="320" height="320"></canvas>
      </div>
      <div class="sp-powerup-row">
        <div class="sp-powerup" id="spPUShield" onclick="SpaceDate.usePowerup('shield')">🛡️ Shield</div>
        <div class="sp-powerup" id="spPUSlow" onclick="SpaceDate.usePowerup('slow')">🐌 Slow-Mo</div>
        <div class="sp-powerup" id="spPUMagnet" onclick="SpaceDate.usePowerup('magnet')">🧲 Magnet</div>
      </div>
    </div>`;
    this.initPlayCanvas();
  },
  initPlayCanvas(){
    this.canvas = document.getElementById('spGameCanvas');
    const wrap = this.canvas.parentElement;
    const size = Math.min(wrap.clientWidth-4, 340);
    this.canvas.width = size; this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.ship = { x:size/2, y:size-40, r:14 };
    this.stars = []; this.meteors = []; this.roundScore = 0; this.timeLeft = 30;
    this.powerupsUsed = {}; this.effects = { shield:0, slow:0, magnet:0 };
    document.querySelectorAll('.sp-powerup').forEach(b=>b.classList.remove('used'));

    const pos = (e)=>{ const r=this.canvas.getBoundingClientRect(); const p=e.touches?e.touches[0]:e; return {x:(p.clientX-r.left)*(this.canvas.width/r.width), y:(p.clientY-r.top)*(this.canvas.height/r.height)}; };
    const move = (e)=>{ e.preventDefault(); const p=pos(e); this.ship.x=Math.max(this.ship.r,Math.min(this.canvas.width-this.ship.r,p.x)); this.ship.y=Math.max(this.ship.r,Math.min(this.canvas.height-this.ship.r,p.y)); };
    this.canvas.addEventListener('mousemove', e=>{ if(e.buttons===1) move(e); });
    this.canvas.addEventListener('touchmove', move, {passive:false});
    this.canvas.addEventListener('touchstart', move, {passive:false});

    this.running = true;
    clearInterval(this.gameTimer);
    this.gameTimer = setInterval(()=>{
      this.timeLeft--;
      const tl=document.getElementById('spTimeLeft'); if(tl) tl.textContent=this.timeLeft;
      if(this.effects.shield>0) this.effects.shield--;
      if(this.effects.slow>0) this.effects.slow--;
      if(this.effects.magnet>0) this.effects.magnet--;
      if(this.timeLeft<=0){ this.endPlayRound(); }
    },1000);
    this.stopLoop();
    this.playLoop();
  },
  stopLoop(){ if(this.raf) cancelAnimationFrame(this.raf); this.raf=null; },
  playLoop(){
    if(!this.running || !this.ctx) return;
    const ctx=this.ctx, c=this.canvas;
    ctx.fillStyle='#04040f'; ctx.fillRect(0,0,c.width,c.height);
    // spawn
    const slowFactor = this.effects.slow>0 ? 0.4 : 1;
    if(Math.random()<0.045) this.stars.push({x:Math.random()*c.width,y:-10,r:9,vy:(1+Math.random())*slowFactor});
    if(Math.random()<0.028) this.meteors.push({x:Math.random()*c.width,y:-10,r:12,vy:(1.4+Math.random()*1.6)*slowFactor});
    // magnet pull
    if(this.effects.magnet>0){
      this.stars.forEach(s=>{ s.x += (this.ship.x-s.x)*0.06; });
    }
    // update+draw stars
    ctx.font='20px sans-serif';
    this.stars = this.stars.filter(s=>{
      s.y+=s.vy;
      ctx.fillText('⭐', s.x-10, s.y+7);
      const d=Math.hypot(s.x-this.ship.x, s.y-this.ship.y);
      if(d<this.ship.r+s.r){ this.roundScore+=10; const rs=document.getElementById('spRoundScore'); if(rs) rs.textContent=this.roundScore; window.Snd.coin(); return false; }
      return s.y < c.height+20;
    });
    // update+draw meteors
    this.meteors = this.meteors.filter(m=>{
      m.y+=m.vy;
      ctx.fillText('☄️', m.x-10, m.y+7);
      const d=Math.hypot(m.x-this.ship.x, m.y-this.ship.y);
      if(d<this.ship.r+m.r-4){
        if(this.effects.shield>0){ window.Snd.tap(); }
        else { this.state.hp=Math.max(0,this.state.hp-12); window.Snd.fail(); this.sync(); }
        return false;
      }
      return m.y < c.height+20;
    });
    // ship
    ctx.font='26px sans-serif';
    ctx.fillText(this.effects.shield>0?'🛡️':'🚀', this.ship.x-13, this.ship.y+9);
    if(this.state.hp<=0){ this.endPlayRound(true); return; }
    this.raf = requestAnimationFrame(()=>this.playLoop());
  },
  usePowerup(type){
    if(this.powerupsUsed[type]) return;
    this.powerupsUsed[type]=true;
    document.getElementById('spPU'+type[0].toUpperCase()+type.slice(1))?.classList.add('used');
    this.effects[type] = type==='shield'?6:type==='slow'?6:5;
    window.Snd.unlock(); window.toast('⚡ '+type+' activated!');
  },
  endPlayRound(destroyed){
    this.running=false; clearInterval(this.gameTimer); this.stopLoop();
    this.state.totalStars += this.roundScore;
    this.state.missionsDone = (this.state.missionsDone||0)+1;
    window.GameCore.unlock('space_first');
    if(this.state.totalStars>=1000) window.GameCore.unlock('space_1000stars');
    if(this.isGalaxyUnlocked(SP_GALAXIES[1]) && !this.state.galaxiesUnlocked.includes('crystal')){
      this.state.galaxiesUnlocked.push('crystal'); window.GameCore.unlock('space_galaxy2');
    }
    if(!destroyed && this.state.hp>=100) window.GameCore.unlock('space_meteorwave');
    window.GameCore.addXP(Math.min(50, 15+Math.floor(this.roundScore/20)));
    window.GameCore.addCoins(Math.floor(this.roundScore/10));
    this.sync();
    window.Snd.success();
    window.showReward(destroyed?'💥':'🌠', destroyed?'Ship Damaged!':'Mission Complete!', ['✨ '+this.roundScore+' stars this run','🪙 '+Math.floor(this.roundScore/10)+' coins']);
    this.mode='map'; this.render();
  },
  exitToMap(){ this.running=false; clearInterval(this.gameTimer); this.stopLoop(); this.mode='map'; this.render(); },
  /* ── HULL REPAIR MINI GAME (co-op tap) ── */
  renderRepair(body){
    body = body || document.getElementById('goBody');
    this.repairPanels = this.repairPanels || Array.from({length:8},()=>false);
    this.repairPanels = Array.from({length:8},()=>false);
    body.innerHTML = `<div class="sp-wrap" style="min-height:380px">
      <div class="sp-topbar">
        <button class="gohead-btn" style="width:30px;height:30px;font-size:12px" onclick="SpaceDate.exitToMap()">←</button>
        <div class="sp-chip">🔧 Repair the Hull</div>
      </div>
      <div class="sp-scene">
        <div class="sp-planet" style="font-size:56px">🛸</div>
        <div class="sp-mission-title">Patch the Leaks!</div>
        <div class="sp-mission-desc">Tap every flashing panel before they all light up red. Both of you can tap — it syncs live.</div>
        <div class="sp-repair-grid" id="spRepairGrid"></div>
        <div style="font-size:11px;color:var(--text3);margin-top:10px" id="spRepairStatus">0 / 8 panels fixed</div>
      </div>
    </div>`;
    this.renderRepairGrid();
  },
  renderRepairGrid(){
    const el=document.getElementById('spRepairGrid'); if(!el) return;
    el.innerHTML = this.repairPanels.map((fixed,i)=>`<div class="sp-repair-btn ${fixed?'fixed':''}" onclick="SpaceDate.tapRepair(${i})">${fixed?'✅':'⚠️'}</div>`).join('');
    const status=document.getElementById('spRepairStatus');
    if(status) status.textContent = this.repairPanels.filter(Boolean).length+' / 8 panels fixed';
  },
  tapRepair(i){
    if(this.repairPanels[i]) return;
    this.repairPanels[i]=true;
    window.Snd.tap();
    this.chan.send({type:'repairTap',idx:i});
    this.renderRepairGrid();
    if(this.repairPanels.every(Boolean)) this.finishRepair();
  },
  remoteRepairTap(i){
    if(this.mode!=='repair' || !this.repairPanels) return;
    if(this.repairPanels[i]) return;
    this.repairPanels[i]=true;
    this.renderRepairGrid();
    if(this.repairPanels.every(Boolean)) this.finishRepair();
  },
  finishRepair(){
    this.state.hp = 100; this.state.repaired=(this.state.repaired||0)+1;
    window.GameCore.unlock('space_repair');
    window.GameCore.addXP(25); window.GameCore.addCoins(15);
    this.sync(); window.Snd.success(); window.confetti(70);
    window.showReward('🔧','Hull Fully Repaired!',['❤️ HP restored','✨ 25 XP']);
    setTimeout(()=>{ this.mode='map'; this.render(); }, 900);
  }
};
window.SpaceDate = SpaceDate;

/* re-render hub game grid so new cards show up immediately */
if (window.Hub && Hub.renderGameCards) Hub.renderGameCards();

});
})();