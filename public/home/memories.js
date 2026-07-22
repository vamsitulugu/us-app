// public/home/memories.js
// ════════════════════════════════════════════════
//  Phase 5 — Memories & Collectibles
//
//  Features:
//   1.  Gift objects — real 3D gifts with popup (photo/message/voice)
//   2.  Interactive photo frames — clickable frames with photo display
//   3.  Memory shelf — floating shelf with memory objects
//   4.  Trophy cabinet — achievement trophies as 3D objects
//   5.  Relationship timeline wall — 3D timeline with milestones
//   6.  Trip souvenirs — appear after globe memories
//   7.  Anniversary decorations — auto-unlock on anniversaries
//   8.  Achievement reward decorations — XP milestone rewards
//   9.  Memory albums — stacked album objects
//  10.  Voice memories — 3D objects that play audio on click
//  11.  Floating memory particles — ambient heart/star particles
//  12.  Memory popup UI — rich popup (photo, message, voice, date)
//  13.  Gift popup UI — gift reveal animation + contents
//  14.  Voice note player — inline audio player
//  15.  Realtime synchronization via Supabase polling
// ════════════════════════════════════════════════

const HomeMemories = (() => {

  // ── Internal state ───────────────────────────
  let scene      = null;
  let coupleId   = null;
  let myName     = 'You';
  let partnerName= 'Partner';
  let memories   = [];       // from home_memory_objects
  let gifts      = [];       // from globe_memories with memory_type='gift'
  let syncTimer  = null;
  let _popup     = null;     // current open popup element
  let _particles = [];       // particle sprites
  let _objects3d = [];       // all placed 3D memory objects (for raycasting)
  let _injected  = false;

  // Room groups — we add to the scene root so they show in current room
  let memGroup   = null;

  // ════════════════════════════════════════════════
  //  Tiny 3D helpers (mirror furniture.js pattern)
  // ════════════════════════════════════════════════
  function mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness:         opts.roughness         ?? 0.72,
      metalness:         opts.metalness         ?? 0.08,
      emissive:          opts.emissive          ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent:       !!(opts.opacity && opts.opacity < 1),
      opacity:           opts.opacity           ?? 1,
      side:              opts.side              ?? THREE.FrontSide
    });
  }
  function box(w,h,d,color,opts={}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(color,opts));
    m.castShadow = m.receiveShadow = true; return m;
  }
  function cyl(rt,rb,h,color,segs=14,opts={}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,segs), mat(color,opts));
    m.castShadow = m.receiveShadow = true; return m;
  }
  function sph(r,color,opts={}) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r,14,10), mat(color,opts));
    m.castShadow = m.receiveShadow = true; return m;
  }
  function cone(r,h,color,opts={}) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r,h,14), mat(color,opts));
    m.castShadow = m.receiveShadow = true; return m;
  }
  function put(o,x,y,z) { o.position.set(x,y,z); return o; }

  // ════════════════════════════════════════════════
  //  1. GIFT BOX — 3D wrapped gift with ribbon
  // ════════════════════════════════════════════════
  function buildGiftBox(color = '#e63aa0', accentColor = '#ffe066') {
    const g = new THREE.Group();

    // Box body
    const body = box(0.38, 0.30, 0.38, color, { roughness: 0.5 });
    put(body, 0, 0.15, 0); g.add(body);

    // Box lid (slightly larger, sits on top)
    const lid = box(0.40, 0.10, 0.40, new THREE.Color(color).multiplyScalar(0.85).getHex(), { roughness: 0.45 });
    put(lid, 0, 0.35, 0); g.add(lid);

    // Ribbon X-cross on box
    const ribH = box(0.42, 0.32, 0.04, accentColor, { roughness: 0.35, emissive: new THREE.Color(accentColor).multiplyScalar(0.12).getHex(), emissiveIntensity: 0.5 });
    put(ribH, 0, 0.15, 0.19); g.add(ribH);
    const ribV = box(0.04, 0.32, 0.42, accentColor, { roughness: 0.35, emissive: new THREE.Color(accentColor).multiplyScalar(0.12).getHex(), emissiveIntensity: 0.5 });
    put(ribV, 0, 0.15, 0); g.add(ribV);

    // Bow on top (two lobes)
    const bow1 = new THREE.Mesh(
      new THREE.TorusGeometry(0.065, 0.02, 6, 14),
      mat(accentColor, { roughness: 0.3 })
    );
    bow1.rotation.set(Math.PI/2, 0, Math.PI/4);
    put(bow1, -0.06, 0.44, 0); g.add(bow1);

    const bow2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.065, 0.02, 6, 14),
      mat(accentColor, { roughness: 0.3 })
    );
    bow2.rotation.set(Math.PI/2, 0, -Math.PI/4);
    put(bow2, 0.06, 0.44, 0); g.add(bow2);

    // Soft glow point light
    const glow = new THREE.PointLight(new THREE.Color(accentColor), 0.35, 1.2, 2);
    glow.position.set(0, 0.5, 0); g.add(glow);
    g.userData.glowLight = glow;

    return g;
  }

  // ════════════════════════════════════════════════
  //  2. PHOTO FRAME — wall-mounted or shelf frame
  // ════════════════════════════════════════════════
  function buildPhotoFrame(color = '#8a5a3a', isWall = false) {
    const g = new THREE.Group();
    const frameW = 0.42, frameH = 0.34;

    // Frame border
    const outer = box(frameW + 0.06, frameH + 0.06, 0.04, color, { roughness: 0.6 });
    put(outer, 0, 0, 0); g.add(outer);

    // Matte border (inner white/cream)
    const matte = box(frameW - 0.02, frameH - 0.02, 0.02, 0xf5f0ea, { roughness: 0.9 });
    put(matte, 0, 0, 0.01); g.add(matte);

    // Photo placeholder (canvas texture updated dynamically)
    const photoPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(frameW - 0.06, frameH - 0.06),
      mat(0x1a1430, { roughness: 0.95, emissive: 0x110d20, emissiveIntensity: 0.3 })
    );
    put(photoPlane, 0, 0, 0.022);
    photoPlane.userData.photoMesh = true;
    g.add(photoPlane);

    // Easel back (if shelf-standing)
    if (!isWall) {
      const stand = box(0.03, 0.22, 0.015, new THREE.Color(color).multiplyScalar(0.7).getHex());
      stand.rotation.x = Math.PI / 6;
      put(stand, 0, -0.06, -0.09);
      g.add(stand);
    }

    g.userData.frameType = isWall ? 'wall' : 'shelf';
    return g;
  }

  // Apply a base64 image to a photo frame's photo mesh
  function applyPhotoToFrame(frameGroup, dataUrl) {
    if (!dataUrl) return;
    const photoMesh = frameGroup.getObjectByProperty('userData.photoMesh', true) ||
      (() => { let found = null; frameGroup.traverse(n => { if (n.userData.photoMesh) found = n; }); return found; })();
    if (!photoMesh) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 192;
      canvas.getContext('2d').drawImage(img, 0, 0, 256, 192);
      const tex = new THREE.CanvasTexture(canvas);
      photoMesh.material = mat(0xffffff, { roughness: 0.9 });
      photoMesh.material.map = tex;
      photoMesh.material.needsUpdate = true;
    };
    img.src = dataUrl;
  }

  // ════════════════════════════════════════════════
  //  3. MEMORY SHELF — floating wooden shelf
  // ════════════════════════════════════════════════
  function buildMemoryShelf(color = '#5a3a1a') {
    const g = new THREE.Group();

    // Shelf board
    const board = box(1.8, 0.06, 0.22, color, { roughness: 0.65 });
    put(board, 0, 0, 0); g.add(board);

    // Two L-brackets
    [-0.7, 0.7].forEach(x => {
      const bracket = box(0.04, 0.16, 0.20, 0x303030, { metalness: 0.5, roughness: 0.4 });
      put(bracket, x, -0.11, 0); g.add(bracket);
    });

    g.userData.isShelf = true;
    return g;
  }

  // ════════════════════════════════════════════════
  //  4. TROPHY — gold star trophy 3D object
  // ════════════════════════════════════════════════
  function buildTrophy(color = '#ffd700') {
    const g = new THREE.Group();

    // Cup body
    const cup = cyl(0.1, 0.14, 0.22, color, 16, { roughness: 0.3, metalness: 0.6 });
    put(cup, 0, 0.22, 0); g.add(cup);

    // Cup rim
    const rim = cyl(0.13, 0.13, 0.03, color, 16, { roughness: 0.25, metalness: 0.65 });
    put(rim, 0, 0.345, 0); g.add(rim);

    // Stem
    const stem = cyl(0.025, 0.025, 0.16, 0x999977, 8, { roughness: 0.4, metalness: 0.5 });
    put(stem, 0, 0.08, 0); g.add(stem);

    // Base
    const base = box(0.28, 0.04, 0.28, 0x4a3a18, { roughness: 0.55 });
    put(base, 0, 0.02, 0); g.add(base);

    // Star on cup
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.06, 0),
      mat(color, { emissive: color, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.2 })
    );
    star.rotation.y = Math.PI / 4;
    put(star, 0, 0.40, 0); g.add(star);
    g.userData.starMesh = star;

    return g;
  }

  // ════════════════════════════════════════════════
  //  5. TIMELINE PLAQUE — a wall-mounted date plaque
  // ════════════════════════════════════════════════
  function buildTimelinePlaque(color = '#2a1a4a') {
    const g = new THREE.Group();

    // Background panel
    const panel = box(0.52, 0.38, 0.025, color, { roughness: 0.55 });
    put(panel, 0, 0, 0); g.add(panel);

    // Decorative border inset
    const border = box(0.48, 0.34, 0.015,
      new THREE.Color(color).addScalar(0.06).getHex(),
      { roughness: 0.5 });
    put(border, 0, 0, 0.005); g.add(border);

    // Heart accent
    const heart1 = sph(0.04, 0xe63aa0, { emissive: 0xe63aa0, emissiveIntensity: 0.6 });
    put(heart1, -0.05, 0.10, 0.022); g.add(heart1);
    const heart2 = sph(0.04, 0xe63aa0, { emissive: 0xe63aa0, emissiveIntensity: 0.6 });
    put(heart2, 0.05, 0.10, 0.022); g.add(heart2);
    const heartV = cone(0.055, 0.08, 0xe63aa0, { emissive: 0xe63aa0, emissiveIntensity: 0.6 });
    heartV.rotation.z = Math.PI;
    put(heartV, 0, 0.04, 0.022); g.add(heartV);

    // Glow
    const glow = new THREE.PointLight(0xe63aa0, 0.2, 0.8, 2);
    glow.position.set(0, 0.1, 0.1); g.add(glow);

    return g;
  }

  // ════════════════════════════════════════════════
  //  6. SOUVENIR — small snow-globe style souvenir
  // ════════════════════════════════════════════════
  function buildSouvenir(color = '#3a6ab8') {
    const g = new THREE.Group();

    // Globe dome
    const dome = sph(0.14, 0x88ccff, {
      roughness: 0.05, metalness: 0.1, opacity: 0.55,
      side: THREE.FrontSide
    });
    dome.material.transparent = true;
    put(dome, 0, 0.22, 0); g.add(dome);

    // Interior mini-scene
    const inside = sph(0.07, color, { emissive: color, emissiveIntensity: 0.2 });
    put(inside, 0, 0.20, 0); g.add(inside);

    // Base
    const base = cyl(0.10, 0.12, 0.10, 0x2a1a0a, 12, { roughness: 0.6 });
    put(base, 0, 0.05, 0); g.add(base);

    return g;
  }

  // ════════════════════════════════════════════════
  //  7. ANNIVERSARY BANNER — heart garland
  // ════════════════════════════════════════════════
  function buildAnniversaryBanner() {
    const g = new THREE.Group();
    const colors = [0xe63aa0, 0xff6b9d, 0xffd700, 0xffa0c0, 0xff4488];

    // String line
    const stringMat = mat(0xcc8844, { roughness: 1 });
    const stringGeo = new THREE.CylinderGeometry(0.006, 0.006, 2.4, 4);
    const string = new THREE.Mesh(stringGeo, stringMat);
    string.rotation.z = Math.PI / 2; put(string, 0, 0, 0); g.add(string);

    // Hanging hearts
    for (let i = 0; i < 7; i++) {
      const x = -1.1 + i * 0.37;
      const c = colors[i % colors.length];
      const h1 = sph(0.05, c, { emissive: c, emissiveIntensity: 0.35 });
      put(h1, x, -0.08, 0); g.add(h1);
      const h2 = sph(0.05, c, { emissive: c, emissiveIntensity: 0.35 });
      put(h2, x + 0.07, -0.08, 0); g.add(h2);
      const hv = cone(0.065, 0.10, c, { emissive: c, emissiveIntensity: 0.3 });
      hv.rotation.z = Math.PI; put(hv, x + 0.035, -0.15, 0); g.add(hv);
    }

    // Soft pink glow
    const light = new THREE.PointLight(0xff80c0, 0.5, 3, 2);
    put(light, 0, -0.1, 0.3); g.add(light);

    return g;
  }

  // ════════════════════════════════════════════════
  //  8. ALBUM — stacked book-like photo album
  // ════════════════════════════════════════════════
  function buildAlbum(color = '#5c2d6e') {
    const g = new THREE.Group();

    // Cover
    const cover = box(0.36, 0.04, 0.28, color, { roughness: 0.6 });
    put(cover, 0, 0.02, 0); g.add(cover);

    // Spine
    const spine = box(0.04, 0.04, 0.28,
      new THREE.Color(color).addScalar(-0.05).getHex(), { roughness: 0.65 });
    put(spine, -0.18, 0.02, 0); g.add(spine);

    // Inner pages (cream)
    for (let i = 0; i < 5; i++) {
      const page = box(0.30, 0.007, 0.24, 0xf5eed8 - i * 0x030200, { roughness: 0.95 });
      put(page, 0.02, -0.02 + i * 0.007, 0); g.add(page);
    }

    // Small heart emboss on cover
    const emboss = sph(0.025, new THREE.Color(color).addScalar(0.2).getHex(),
      { emissive: 0xffa0c0, emissiveIntensity: 0.2 });
    put(emboss, 0.06, 0.045, 0.06); g.add(emboss);

    return g;
  }

  // ════════════════════════════════════════════════
  //  9. VOICE MEMORY — cassette-style voice object
  // ════════════════════════════════════════════════
  function buildVoiceCassette(color = '#1a2a3a') {
    const g = new THREE.Group();

    // Cassette body
    const body = box(0.30, 0.19, 0.05, color, { roughness: 0.5, metalness: 0.1 });
    put(body, 0, 0.095, 0); g.add(body);

    // Label area
    const label = box(0.22, 0.12, 0.008, 0xffffff, { roughness: 0.9 });
    put(label, 0, 0.10, 0.029); g.add(label);

    // Reels
    [-0.06, 0.06].forEach(x => {
      const reel = cyl(0.04, 0.04, 0.015, 0x2a2a2a, 16, { roughness: 0.6 });
      reel.rotation.x = Math.PI / 2; put(reel, x, 0.11, 0.032); g.add(reel);
      const hub = cyl(0.018, 0.018, 0.018, 0x888888, 8, { metalness: 0.5 });
      hub.rotation.x = Math.PI / 2; put(hub, x, 0.11, 0.036); g.add(hub);
    });

    // Waveform lines on label
    for (let i = 0; i < 6; i++) {
      const h = 0.02 + Math.random() * 0.06;
      const wave = box(0.012, h, 0.002, 0x4488ff, { emissive: 0x2255cc, emissiveIntensity: 0.4 });
      put(wave, -0.05 + i * 0.02, 0.09 + h/2 - 0.045, 0.034); g.add(wave);
    }

    // Glow when "playing"
    const glow = new THREE.PointLight(0x4488ff, 0, 0.8, 2);
    put(glow, 0, 0.12, 0.15); g.add(glow);
    g.userData.glowLight = glow;
    g.userData.isVoice   = true;

    return g;
  }

  // ════════════════════════════════════════════════
  //  10. Decorative ambient floating particle sprites removed
  //      (was: 18 hearts/sparkles/roses drifting & orbiting in
  //      the room). Kept as no-ops so call sites remain valid.
  // ════════════════════════════════════════════════
  function initParticles() {}

  function updateParticles() {}

  function disposeParticles() {}

  // ════════════════════════════════════════════════
  //  PLACEMENT — place objects in scene
  // ════════════════════════════════════════════════
  function placeObject(obj3d, memData) {
    obj3d.position.set(
      memData.pos_x || 0,
      memData.pos_y || 0,
      memData.pos_z || 0
    );
    obj3d.rotation.y = memData.rot_y || 0;
    obj3d.userData = {
      ...obj3d.userData,
      memoryId:  memData.id,
      memType:   memData.memory_type,
      label:     memData.label,
      thumbnail: memData.thumbnail,
      meta:      memData.meta || {}
    };
    obj3d.userData.isMemory = true;
    scene.add(obj3d);
    _objects3d.push(obj3d);
    return obj3d;
  }

  // ════════════════════════════════════════════════
  //  LOAD from Supabase via HomeAPI
  // ════════════════════════════════════════════════
  async function loadMemoryObjects() {
    if (!coupleId || !window.HomeAPI) return;
    try {
      const data = await HomeAPI.memories.list(coupleId);
      // Clear existing
      _objects3d.forEach(o => { if (o.parent) o.parent.remove(o); });
      _objects3d = [];
      memories = data || [];

      const room = window.HomeScene ? HomeScene.state.currentRoom : 'living';
      memories
        .filter(m => m.room === room)
        .forEach(m => buildAndPlaceMemory(m));

    } catch (e) {
      console.warn('Memories: load failed', e.message);
    }
  }

  function buildAndPlaceMemory(m) {
    let obj = null;
    const meta = m.meta || {};

    switch (m.memory_type) {
      case 'gift':
        obj = buildGiftBox(meta.color || '#e63aa0', meta.accentColor || '#ffe066');
        break;
      case 'photo':
        obj = buildPhotoFrame(meta.frameColor || '#8a5a3a', m.pos_z < -3.5);
        if (m.thumbnail) applyPhotoToFrame(obj, m.thumbnail);
        break;
      case 'shelf':
        obj = buildMemoryShelf(meta.color || '#5a3a1a');
        break;
      case 'trophy':
        obj = buildTrophy(meta.color || '#ffd700');
        break;
      case 'timeline':
        obj = buildTimelinePlaque(meta.color || '#2a1a4a');
        break;
      case 'souvenir':
        obj = buildSouvenir(meta.color || '#3a6ab8');
        break;
      case 'anniversary':
        obj = buildAnniversaryBanner();
        break;
      case 'album':
        obj = buildAlbum(meta.color || '#5c2d6e');
        break;
      case 'voice':
        obj = buildVoiceCassette(meta.color || '#1a2a3a');
        break;
      default:
        obj = buildGiftBox('#cccccc', '#ffffff');
    }
    if (obj) placeObject(obj, m);
  }

  // ════════════════════════════════════════════════
  //  CLICK DETECTION — raycaster hit on memory obj
  // ════════════════════════════════════════════════
  function onCanvasClick(e) {
    if (!scene || !window.HomeScene || !window.HomeControls) return;
    const camera = HomeScene.getCamera();
    if (!camera) return;

    // Only trigger in non-edit mode
    if (HomeScene.state.editMode) return;

    const raycaster = HomeControls.getRaycaster(e.clientX, e.clientY);
    const targets = [];
    _objects3d.forEach(o => { o.traverse(c => { if (c.isMesh) targets.push(c); }); });
    const hits = raycaster.intersectObjects(targets);

    if (!hits.length) return;

    // Walk up to find the memory group
    let obj = hits[0].object;
    while (obj && !obj.userData.isMemory) obj = obj.parent;
    if (!obj || !obj.userData.isMemory) return;

    const memId = obj.userData.memoryId;
    const memData = memories.find(m => m.id === memId);
    if (!memData) return;

    openMemoryPopup(memData, obj);
  }

  // ════════════════════════════════════════════════
  //  12. MEMORY POPUP UI
  // ════════════════════════════════════════════════
  function openMemoryPopup(memData, obj3d) {
    closeMemoryPopup();

    const meta = memData.meta || {};
    const typeLabels = {
      gift: '🎁 Gift',
      photo: '📷 Photo',
      shelf: '📦 Memory Shelf',
      trophy: '🏆 Trophy',
      timeline: '💫 Milestone',
      souvenir: '✈️ Souvenir',
      anniversary: '❤️ Anniversary',
      album: '📒 Album',
      voice: '🎙️ Voice Memory'
    };

    const isGift    = memData.memory_type === 'gift';
    const isVoice   = memData.memory_type === 'voice';
    const isPhoto   = memData.memory_type === 'photo';

    const popup = document.createElement('div');
    popup.id = 'hmPopup';
    popup.style.cssText = `
      position:fixed;inset:0;z-index:800;
      display:flex;align-items:center;justify-content:center;
      background:rgba(2,2,9,0.82);
      backdrop-filter:blur(12px);
      padding:16px;
    `;

    const card = document.createElement('div');
    card.style.cssText = `
      background:rgba(10,10,28,0.96);
      border:1px solid rgba(255,255,255,0.18);
      border-radius:22px;
      padding:22px 20px;
      width:100%;max-width:340px;
      max-height:88dvh;
      overflow-y:auto;
      color:#fff;
      font-family:var(--ff-sans,Inter,sans-serif);
      animation:hmPopIn 0.38s cubic-bezier(0.34,1.56,0.64,1);
      position:relative;
    `;

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      position:absolute;top:14px;right:16px;
      background:rgba(255,255,255,0.08);border:none;
      color:rgba(255,255,255,0.7);font-size:16px;
      border-radius:50%;width:30px;height:30px;
      cursor:pointer;display:flex;align-items:center;justify-content:center;
    `;
    closeBtn.onclick = closeMemoryPopup;
    card.appendChild(closeBtn);

    // Type badge
    const badge = document.createElement('div');
    badge.style.cssText = `
      display:inline-block;font-size:10px;font-weight:700;
      text-transform:uppercase;letter-spacing:1px;
      padding:3px 10px;border-radius:12px;margin-bottom:12px;
      background:rgba(150,100,255,0.18);color:#c8a0ff;
      border:1px solid rgba(150,100,255,0.3);
    `;
    badge.textContent = typeLabels[memData.memory_type] || '💫 Memory';
    card.appendChild(badge);

    // Title / label
    if (memData.label) {
      const title = document.createElement('div');
      title.style.cssText = `font-size:17px;font-weight:700;color:#fff;margin-bottom:8px;line-height:1.3;`;
      title.textContent = memData.label;
      card.appendChild(title);
    }

    // Photo display
    if (isPhoto && memData.thumbnail) {
      const imgWrap = document.createElement('div');
      imgWrap.style.cssText = `border-radius:12px;overflow:hidden;margin-bottom:12px;`;
      const img = document.createElement('img');
      img.src = memData.thumbnail;
      img.style.cssText = `width:100%;max-height:200px;object-fit:cover;border-radius:12px;`;
      imgWrap.appendChild(img);
      card.appendChild(imgWrap);
    }

    // Gift popup special UI
    if (isGift) {
      renderGiftContents(card, memData, meta, obj3d);
    }

    // Voice player
    if (isVoice && meta.audioData) {
      renderVoicePlayer(card, meta.audioData, meta.duration);
    }

    // Message / note
    if (meta.message) {
      const msgBox = document.createElement('div');
      msgBox.style.cssText = `
        background:rgba(255,255,255,0.05);
        border-left:3px solid rgba(150,100,255,0.6);
        border-radius:0 10px 10px 0;
        padding:10px 12px;margin-bottom:12px;
        font-size:13px;color:rgba(255,255,255,0.78);
        line-height:1.65;
      `;
      msgBox.textContent = meta.message;
      card.appendChild(msgBox);
    }

    // From / date info
    const info = document.createElement('div');
    info.style.cssText = `font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;display:flex;gap:10px;`;
    if (meta.fromName) info.innerHTML += `<span>💌 From ${esc(meta.fromName)}</span>`;
    if (meta.date) info.innerHTML += `<span>📅 ${meta.date}</span>`;
    card.appendChild(info);

    popup.appendChild(card);
    document.body.appendChild(popup);
    _popup = popup;

    // Close on backdrop
    popup.addEventListener('click', e => { if (e.target === popup) closeMemoryPopup(); });

    // Entrance animation
    injectPopupStyle();

    // Animate the 3D object
    if (obj3d && obj3d.userData.glowLight) {
      obj3d.userData.glowLight.intensity = 1.5;
      setTimeout(() => {
        if (obj3d.userData.glowLight) obj3d.userData.glowLight.intensity = 0.35;
      }, 1200);
    }
  }

  function closeMemoryPopup() {
    if (_popup) { _popup.remove(); _popup = null; }
  }

  // ════════════════════════════════════════════════
  //  13. GIFT POPUP — reveal animation + contents
  // ════════════════════════════════════════════════
  function renderGiftContents(card, memData, meta, obj3d) {
    const revealKey = 'hm_gift_revealed_' + memData.id;
    const revealed  = localStorage.getItem(revealKey) === '1';

    if (!revealed) {
      // Big gift emoji
      const icon = document.createElement('div');
      icon.style.cssText = `font-size:64px;text-align:center;margin:8px 0;animation:hmHeartBeat 0.8s ease-in-out 2;`;
      icon.textContent = '🎁';
      card.appendChild(icon);

      const hint = document.createElement('div');
      hint.style.cssText = `text-align:center;font-size:12px;color:rgba(255,255,255,0.45);margin-bottom:14px;`;
      hint.textContent = 'Tap to unwrap your gift!';
      card.appendChild(hint);

      const openBtn = document.createElement('button');
      openBtn.style.cssText = `
        width:100%;padding:13px;border:none;border-radius:14px;
        background:linear-gradient(135deg,#e63aa0,#9933ff);
        color:#fff;font-size:14px;font-weight:700;cursor:pointer;
        font-family:var(--ff-sans,Inter,sans-serif);
        box-shadow:0 6px 20px rgba(230,58,160,0.35);
      `;
      openBtn.textContent = '🎀 Unwrap Gift';
      openBtn.onclick = () => {
        localStorage.setItem(revealKey, '1');
        // Confetti effect on 3D gift
        if (obj3d) playGiftRevealAnim(obj3d);
        closeMemoryPopup();
        setTimeout(() => openMemoryPopup(memData, obj3d), 400);
      };
      card.appendChild(openBtn);
    } else {
      // Already revealed — show contents
      if (meta.thumbnail) {
        const img = document.createElement('img');
        img.src = meta.thumbnail;
        img.style.cssText = `width:100%;border-radius:12px;max-height:180px;object-fit:cover;margin-bottom:12px;`;
        card.appendChild(img);
      }
      const revealedTag = document.createElement('div');
      revealedTag.style.cssText = `
        display:inline-flex;align-items:center;gap:5px;
        font-size:10px;font-weight:700;
        padding:3px 10px;border-radius:10px;
        background:rgba(52,211,153,0.15);color:#34d399;
        border:1px solid rgba(52,211,153,0.3);
        margin-bottom:12px;
      `;
      revealedTag.textContent = '✓ Unwrapped';
      card.appendChild(revealedTag);
    }
  }

  // Gift reveal 3D animation — scale pop + rotation
  function playGiftRevealAnim(giftGroup) {
    const dur = 1200;
    const start = performance.now();
    const origScale = giftGroup.scale.clone();
    function tick() {
      const t = Math.min(1, (performance.now() - start) / dur);
      const s = 1 + Math.sin(t * Math.PI) * 0.28;
      giftGroup.scale.set(s, s, s);
      giftGroup.rotation.y = t * Math.PI * 1.5;
      if (t < 1) requestAnimationFrame(tick);
      else giftGroup.scale.copy(origScale);
    }
    tick();
    // Spawn emoji particles around gift
    spawnBurst(giftGroup.position, ['🎉', '💕', '✨', '🎊', '🌹'], 10);
  }

  // ════════════════════════════════════════════════
  //  14. VOICE NOTE PLAYER
  // ════════════════════════════════════════════════
  function renderVoicePlayer(card, audioData, duration) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      display:flex;align-items:center;gap:10px;
      background:rgba(68,136,255,0.1);border:1px solid rgba(68,136,255,0.3);
      border-radius:14px;padding:10px 12px;margin-bottom:12px;
    `;

    const playBtn = document.createElement('button');
    playBtn.style.cssText = `
      width:36px;height:36px;border-radius:50%;
      background:linear-gradient(135deg,#4488ff,#2255cc);
      border:none;color:#fff;font-size:14px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;flex-shrink:0;
    `;
    playBtn.textContent = '▶';

    const waveWrap = document.createElement('div');
    waveWrap.style.cssText = `flex:1;display:flex;align-items:center;gap:2px;height:28px;`;
    for (let i = 0; i < 20; i++) {
      const bar = document.createElement('div');
      const h = 4 + Math.random() * 20;
      bar.style.cssText = `width:3px;height:${h}px;background:rgba(68,136,255,0.55);border-radius:2px;transition:background 0.1s;`;
      waveWrap.appendChild(bar);
    }
    wrap.appendChild(playBtn);
    wrap.appendChild(waveWrap);

    if (duration) {
      const dur = document.createElement('span');
      dur.style.cssText = `font-size:10px;color:rgba(255,255,255,0.4);flex-shrink:0;`;
      dur.textContent = duration;
      wrap.appendChild(dur);
    }

    let audio = null;
    let playing = false;
    playBtn.onclick = () => {
      if (!audio) {
        audio = new Audio(audioData);
        audio.onended = () => {
          playing = false; playBtn.textContent = '▶';
          waveWrap.querySelectorAll('div').forEach(b => b.style.background = 'rgba(68,136,255,0.55)');
        };
      }
      if (!playing) {
        audio.play().catch(() => HomeUtils.toast('Could not play audio'));
        playing = true; playBtn.textContent = '⏸';
        animateWave(waveWrap, () => playing);
      } else {
        audio.pause(); playing = false; playBtn.textContent = '▶';
        waveWrap.querySelectorAll('div').forEach(b => b.style.background = 'rgba(68,136,255,0.55)');
      }
    };

    card.appendChild(wrap);
  }

  function animateWave(waveWrap, isPlayingFn) {
    const bars = [...waveWrap.querySelectorAll('div')];
    let frame = 0;
    function tick() {
      if (!isPlayingFn()) return;
      frame++;
      bars.forEach((b, i) => {
        const h = 4 + Math.abs(Math.sin(frame * 0.15 + i * 0.4)) * 20;
        b.style.height = h + 'px';
        b.style.background = `rgba(68,136,255,${0.4 + Math.abs(Math.sin(frame * 0.1 + i * 0.3)) * 0.5})`;
      });
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ════════════════════════════════════════════════
  //  POPUP CSS — injected once
  // ════════════════════════════════════════════════
  function injectPopupStyle() {
    if (document.getElementById('hmPopupStyle')) return;
    const style = document.createElement('style');
    style.id = 'hmPopupStyle';
    style.textContent = `
      @keyframes hmPopIn {
        from { opacity:0; transform:scale(0.88) translateY(14px); }
        to   { opacity:1; transform:scale(1) translateY(0); }
      }
      @keyframes hmHeartBeat {
        0%,100% { transform:scale(1); }
        20%      { transform:scale(1.22); }
        40%      { transform:scale(0.95); }
        60%      { transform:scale(1.14); }
      }
      @keyframes hmFloat {
        0%   { transform:translateY(0) scale(1);   opacity:0.9; }
        100% { transform:translateY(-90px) scale(0.2); opacity:0; }
      }
      #hmPopup { animation:none; }
      #hmPopup > div::-webkit-scrollbar { width:3px; }
      #hmPopup > div::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.12); border-radius:99px; }

      /* ── Memories HUD button ── */
      #hmAddBtn {
        position:fixed;bottom:90px;right:16px;z-index:300;
        width:44px;height:44px;border-radius:50%;
        background:linear-gradient(135deg,#e63aa0,#9933ff);
        border:none;color:#fff;font-size:20px;cursor:pointer;
        box-shadow:0 6px 18px rgba(230,58,160,0.4);
        display:flex;align-items:center;justify-content:center;
        transition:transform 0.2s cubic-bezier(0.34,1.56,0.64,1);
      }
      #hmAddBtn:hover { transform:scale(1.12); }
      #hmAddBtn:active { transform:scale(0.9); }

      /* ── Add memory drawer ── */
      #hmDrawer {
        position:fixed;left:50%;bottom:0;
        transform:translate(-50%,100%);
        width:min(400px,100vw);max-height:70vh;overflow-y:auto;
        background:rgba(6,6,18,0.97);backdrop-filter:blur(24px);
        border:1px solid rgba(255,255,255,0.18);border-radius:18px 18px 0 0;
        z-index:350;transition:transform 0.32s cubic-bezier(0.4,0,0.2,1);
        padding:14px 16px 32px;color:#fff;font-family:var(--ff-sans,Inter,sans-serif);
      }
      #hmDrawer.open { transform:translate(-50%,0); }
      #hmDrawer h3 {
        font-family:var(--ff-serif,Georgia,serif);font-size:16px;
        font-weight:400;margin-bottom:12px;
        display:flex;justify-content:space-between;align-items:center;
      }
      .hm-type-grid {
        display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;
      }
      .hm-type-btn {
        background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);
        border-radius:12px;padding:10px 6px;text-align:center;cursor:pointer;
        font-family:var(--ff-sans,Inter,sans-serif);color:rgba(255,255,255,0.7);
        font-size:11px;transition:all 0.18s;
      }
      .hm-type-btn:hover { background:rgba(255,255,255,0.10);color:#fff; }
      .hm-type-btn.active { background:rgba(150,100,255,0.22);border-color:rgba(150,100,255,0.5);color:#c8a0ff; }
      .hm-type-btn .hm-tb-ico { font-size:20px;display:block;margin-bottom:3px; }
      .hm-field { margin-bottom:11px; }
      .hm-field label { display:block;font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px; }
      .hm-field input, .hm-field textarea, .hm-field select {
        width:100%;background:rgba(255,255,255,0.05);
        border:1px solid rgba(255,255,255,0.12);border-radius:10px;
        padding:9px 12px;font-size:13px;color:#fff;
        font-family:var(--ff-sans,Inter,sans-serif);outline:none;
        transition:border-color 0.18s;
      }
      .hm-field input:focus, .hm-field textarea:focus {
        border-color:rgba(150,100,255,0.5);
      }
      .hm-field textarea { resize:vertical;min-height:65px;line-height:1.6; }
      .hm-field input::placeholder, .hm-field textarea::placeholder { color:rgba(255,255,255,0.25); }
      .hm-save-btn {
        width:100%;padding:13px;border:none;border-radius:14px;
        background:linear-gradient(135deg,#9933ff,#e63aa0);
        color:#fff;font-size:14px;font-weight:700;cursor:pointer;
        font-family:var(--ff-sans,Inter,sans-serif);
        box-shadow:0 6px 20px rgba(153,51,255,0.3);
        margin-top:4px;
      }
      #hmOverlay { position:fixed;inset:0;z-index:349;display:none; }
      #hmOverlay.show { display:block; }
    `;
    document.head.appendChild(style);
  }

  // ════════════════════════════════════════════════
  //  Decorative celebration emoji burst removed (was: hearts/sparkles
  //  exploding outward on gift reveal / memory placement). No-op kept.
  // ════════════════════════════════════════════════
  function spawnBurst() {}

  // ════════════════════════════════════════════════
  //  ADD MEMORY UI — drawer for placing new objects
  // ════════════════════════════════════════════════
  const MEMORY_TYPES = [
    { key: 'gift',        icon: '🎁', label: 'Gift'       },
    { key: 'photo',       icon: '📷', label: 'Photo Frame'},
    { key: 'voice',       icon: '🎙️', label: 'Voice'      },
    { key: 'souvenir',    icon: '✈️', label: 'Souvenir'   },
    { key: 'album',       icon: '📒', label: 'Album'      },
    { key: 'trophy',      icon: '🏆', label: 'Trophy'     },
    { key: 'timeline',    icon: '💫', label: 'Milestone'  },
    { key: 'shelf',       icon: '📦', label: 'Shelf'      },
    { key: 'anniversary', icon: '❤️', label: 'Anniversary'}
  ];

  let _selectedType  = 'gift';
  let _drawerOpen    = false;

  function injectAddUI() {
    if (document.getElementById('hmAddBtn')) return;
    injectPopupStyle();

    // Add button
    const btn = document.createElement('button');
    btn.id      = 'hmAddBtn';
    btn.title   = 'Add Memory Object';
    btn.textContent = '💝';
    btn.onclick = toggleDrawer;
    document.body.appendChild(btn);

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'hmOverlay';
    overlay.onclick = closeDrawer;
    document.body.appendChild(overlay);

    // Drawer
    const drawer = document.createElement('div');
    drawer.id = 'hmDrawer';
    document.body.appendChild(drawer);

    renderDrawer();
  }

  function renderDrawer() {
    const drawer = document.getElementById('hmDrawer');
    if (!drawer) return;

    const typeButtons = MEMORY_TYPES.map(t => `
      <div class="hm-type-btn${t.key === _selectedType ? ' active' : ''}"
        onclick="window.HomeMemories._selectType('${t.key}')">
        <span class="hm-tb-ico">${t.icon}</span>${t.label}
      </div>`).join('');

    drawer.innerHTML = `
      <h3>💝 Add Memory Object
        <button onclick="window.HomeMemories.closeDrawer()"
          style="background:none;border:none;color:rgba(255,255,255,0.5);font-size:18px;cursor:pointer">✕</button>
      </h3>

      <div class="hm-type-grid">${typeButtons}</div>

      <div class="hm-field">
        <label>Label / Name</label>
        <input id="hmLabel" type="text" placeholder="e.g. Birthday Gift 🎂">
      </div>

      <div class="hm-field">
        <label>Message / Note</label>
        <textarea id="hmMessage" placeholder="Write something sweet..."></textarea>
      </div>

      <div class="hm-field">
        <label>Photo (optional)</label>
        <input type="file" id="hmPhotoFile" accept="image/*"
          style="color:rgba(255,255,255,0.55);font-size:12px">
      </div>

      <div id="hmVoiceSection" style="display:${_selectedType==='voice'?'block':'none'}">
        <div class="hm-field">
          <label>Voice Note</label>
          <button id="hmRecordBtn"
            style="background:rgba(68,136,255,0.15);border:1px solid rgba(68,136,255,0.35);
            border-radius:10px;padding:9px 14px;color:#88bbff;font-family:var(--ff-sans,inherit);
            font-size:12px;cursor:pointer;width:100%;">
            🎙️ Tap to Record
          </button>
          <div id="hmRecordStatus" style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:5px;display:none;"></div>
        </div>
      </div>

      <div class="hm-field">
        <label>Room</label>
        <select id="hmRoom">
          ${Object.entries(window.ROOMS || {
            living:'Living Room', bedroom:'Bedroom', kitchen:'Kitchen',
            garden:'Garden', gameroom:'Game Room', music:'Music Room',
            library:'Library', petroom:'Pet Room', rooftop:'Rooftop'
          }).map(([k,v]) => `<option value="${k}"${k===(window.HomeScene?.state?.currentRoom||'living')?' selected':''}>${typeof v==='string'?v:v.label||v}</option>`).join('')}
        </select>
      </div>

      <button class="hm-save-btn" onclick="window.HomeMemories.saveFromDrawer()">
        ✨ Place in Room
      </button>
    `;

    // Wire record button
    const recBtn = document.getElementById('hmRecordBtn');
    if (recBtn) wireRecordBtn(recBtn);
  }

  let _recorder    = null;
  let _audioChunks = [];
  let _isRecording = false;
  let _recordedData = null;

  function wireRecordBtn(btn) {
    btn.onclick = async () => {
      if (!_isRecording) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          _audioChunks = [];
          _recorder = new MediaRecorder(stream);
          _recorder.ondataavailable = e => _audioChunks.push(e.data);
          _recorder.onstop = () => {
            const blob = new Blob(_audioChunks, { type: 'audio/webm' });
            stream.getTracks().forEach(t => t.stop());
            const st = document.getElementById('hmRecordStatus');
            if (st) { st.style.display = 'block'; st.textContent = '⏳ Uploading voice note…'; }
            uploadHomeMedia(blob, 'voice.webm').then(url => {
              _recordedData = url;
              if (st) st.textContent = '✅ Voice note ready!';
            }).catch(() => {
              _recordedData = null;
              if (st) st.textContent = '⚠️ Upload failed — try again';
              HomeUtils.toast('Voice note upload failed');
            });
          };
          _recorder.start();
          _isRecording = true;
          btn.textContent = '⏹ Stop Recording';
          btn.style.background = 'rgba(248,113,113,0.15)';
          btn.style.borderColor = 'rgba(248,113,113,0.4)';
          btn.style.color = '#f87171';
        } catch (e) {
          HomeUtils.toast('Microphone access denied');
        }
      } else {
        if (_recorder) _recorder.stop();
        _isRecording = false;
        btn.textContent = '🎙️ Re-record';
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
      }
    };
  }

  function _selectType(typeKey) {
    _selectedType = typeKey;
    renderDrawer();
    toggleDrawer(true);
  }

  function toggleDrawer(keepOpen = false) {
    const d = document.getElementById('hmDrawer');
    const o = document.getElementById('hmOverlay');
    if (!d) return;
    _drawerOpen = keepOpen ? true : !_drawerOpen;
    d.classList.toggle('open', _drawerOpen);
    if (o) o.classList.toggle('show', _drawerOpen);
  }

  function closeDrawer() {
    const d = document.getElementById('hmDrawer');
    const o = document.getElementById('hmOverlay');
    _drawerOpen = false;
    if (d) d.classList.remove('open');
    if (o) o.classList.remove('show');
    _recordedData = null; _isRecording = false;
  }

  async function saveFromDrawer() {
    const label    = (document.getElementById('hmLabel')?.value || '').trim();
    const message  = document.getElementById('hmMessage')?.value || '';
    const photoIn  = document.getElementById('hmPhotoFile');
    const room     = document.getElementById('hmRoom')?.value || 'living';

    if (!label) { HomeUtils.toast('Please add a label'); return; }

    // Room spawn position (in front of camera, offset randomly)
    const sx = (Math.random() - 0.5) * 3;
    const sz = (Math.random() - 0.5) * 2 + 1.5;
    const sy = _selectedType === 'anniversary' ? 3.2 : 0;

    const meta = { message, fromName: HomeUtils.getMyName() || 'You', date: new Date().toLocaleDateString() };
    if (_recordedData) { meta.audioData = _recordedData; meta.duration = '–:––'; }

    // Handle photo
    let thumbnail = null;
    if (photoIn && photoIn.files[0]) {
      try {
        thumbnail = await uploadHomeMedia(photoIn.files[0], photoIn.files[0].name);
        meta.thumbnail = thumbnail;
      } catch (e) {
        HomeUtils.toast('Photo upload failed'); return;
      }
    }

    // Assign color defaults by type
    const colorMap = {
      gift: '#e63aa0', photo: '#8a5a3a', shelf: '#5a3a1a',
      trophy: '#ffd700', timeline: '#2a1a4a', souvenir: '#3a6ab8',
      anniversary: '#ff6b9d', album: '#5c2d6e', voice: '#1a2a3a'
    };
    meta.color = colorMap[_selectedType] || '#888888';

    const payload = {
      coupleId, room,
      memory_type: _selectedType,
      label,
      thumbnail,
      pos_x: sx, pos_y: sy, pos_z: sz,
      rot_y: 0,
      meta
    };

    try {
      let saved;
      if (window.HomeAPI) {
        saved = await HomeAPI.memories.add(payload);
        payload.id = saved.id;
      } else {
        payload.id = 'local_' + Date.now();
      }

      memories.push(payload);
      buildAndPlaceMemory(payload);

      HomeUtils.toast('💝 Memory placed in room!');
      closeDrawer();
      spawnBurst(
        new THREE.Vector3(sx, sy + 0.5, sz),
        ['💕', '✨', '💫'], 6
      );
    } catch (e) {
      HomeUtils.toast('Could not save: ' + e.message, 'error');
    }
  }

  function uploadHomeMedia(fileOrBlob, filename) {
    const form = new FormData();
    form.append('file', fileOrBlob, filename || 'upload');
    form.append('coupleId', coupleId);
    return fetch('/api/media/upload', { method: 'POST', body: form })
      .then(r => r.json().then(data => {
        if (!r.ok) throw new Error(data.error || 'Upload failed');
        return data.url;
      }));
  }

  // ════════════════════════════════════════════════
  //  AUTO-FEATURES — anniversaries, achievements
  // ════════════════════════════════════════════════

  // Check if today is anniversary — auto-place banner if not present
  function checkAnniversaryDecoration() {
    try {
      const raw = localStorage.getItem('uwl_v5');
      if (!raw) return;
      const s = JSON.parse(raw);
      const anniv = s.anniversary;
      if (!anniv) return;

      const today = new Date();
      const a     = new Date(anniv + 'T00:00:00');
      const isAnniv = today.getMonth() === a.getMonth() && today.getDate() === a.getDate();
      if (!isAnniv) return;

      // Check if already placed today
      const key = 'hm_anniv_placed_' + today.toISOString().slice(0, 10);
      if (localStorage.getItem(key)) return;

      // Auto-place anniversary banner above the scene
      const banner = buildAnniversaryBanner();
      const years  = today.getFullYear() - a.getFullYear();
      banner.position.set(0, 3.8, -2);
      banner.userData = {
        isMemory: true, memType: 'anniversary',
        label: `${years} Year${years !== 1 ? 's' : ''} Together 💕`,
        meta: { message: `Happy ${years > 1 ? years + ' year' : 'first'} anniversary!` }
      };
      scene.add(banner);
      _objects3d.push(banner);

      localStorage.setItem(key, '1');
      setTimeout(() => HomeUtils.toast('🎉 Happy Anniversary! 💕'), 1500);
    } catch (_) {}
  }

  // Place achievement trophy decorations based on XP level
  function checkAchievementDecorations() {
    try {
      const raw = localStorage.getItem('uwl_v5');
      if (!raw) return;
      const s = JSON.parse(raw);
      const xp = s.xp || 0;
      const level = Math.floor(Math.sqrt(xp / 25)) + 1;

      // Place trophy for milestone levels
      if (level >= 5) placeStaticTrophy(0xffd700, 'Level 5 Couple!', -3.5, 0, -3.5);
      if (level >= 10) placeStaticTrophy(0xe8e8e8, 'Soulmates ✨',     3.5, 0, -3.5);
      if (level >= 20) placeStaticTrophy(0xff6b9d, 'Forever Us 💕',    0,   0,  3.5);
    } catch (_) {}
  }

  function placeStaticTrophy(color, label, x, y, z) {
    // Don't duplicate
    if (_objects3d.some(o => o.userData.label === label)) return;
    const t = buildTrophy(color);
    t.position.set(x, y, z);
    t.userData = { isMemory: true, memType: 'trophy', label, meta: { message: 'Achievement unlocked!' } };
    scene.add(t);
    _objects3d.push(t);
  }

  // ════════════════════════════════════════════════
  //  15. REALTIME SYNC — poll every 12 seconds
  // ════════════════════════════════════════════════
  function startSync() {
    if (syncTimer) return;
    syncTimer = setInterval(async () => {
      await loadMemoryObjects();
    }, 12000);
  }

  function stopSync() {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  }

  // ════════════════════════════════════════════════
  //  ROOM CHANGE — reload visible objects
  // ════════════════════════════════════════════════
  function onRoomChange(e) {
    const room = e.detail?.room || 'living';
    // Hide all, show only current room
    _objects3d.forEach(o => {
      o.visible = !o.userData.room || o.userData.room === room;
    });
    // Also rebuild from data for new room
    const roomMems = memories.filter(m => m.room === room);
    roomMems.forEach(m => {
      if (!_objects3d.some(o => o.userData.memoryId === m.id)) {
        buildAndPlaceMemory(m);
      }
    });
  }

  // ════════════════════════════════════════════════
  //  TROPHY CABINET GROUP — places cabinet in living room
  // ════════════════════════════════════════════════
  function buildTrophyCabinet() {
    const g = new THREE.Group();

    // Cabinet body
    const body = box(1.1, 1.4, 0.36, 0x2a1a0e, { roughness: 0.55 });
    put(body, 0, 0.7, 0); g.add(body);

    // Glass door fronts (two panels)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x88ccff, roughness: 0.08, metalness: 0.15,
      transparent: true, opacity: 0.28, side: THREE.FrontSide
    });
    [-0.265, 0.265].forEach(x => {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 1.3), glassMat);
      glass.position.set(x, 0.70, 0.19); g.add(glass);
    });

    // Shelves inside
    [0.32, 0.72, 1.12].forEach(y => {
      const shelf = box(1.00, 0.025, 0.30, 0x3a2510); put(shelf, 0, y, 0); g.add(shelf);
    });

    // Door frame divider
    const divider = box(0.03, 1.32, 0.025, 0x1a0e06, { roughness: 0.4 });
    put(divider, 0, 0.71, 0.185); g.add(divider);

    return g;
  }

  // ════════════════════════════════════════════════
  //  MEMORY SHELF GROUP — built-in to living room wall
  // ════════════════════════════════════════════════
  function addDefaultMemoryShelf() {
    // Only add once, to living room
    if (_objects3d.some(o => o.userData.label === '__defaultShelf__')) return;

    const shelf = buildMemoryShelf('#4a2e12');
    shelf.position.set(-2.5, 2.2, -4.0);
    shelf.rotation.y = 0;
    shelf.userData = {
      isMemory: true, memType: 'shelf', label: '__defaultShelf__',
      meta: { message: 'Our Memory Shelf' }
    };
    scene.add(shelf);
    _objects3d.push(shelf);
  }

  // ════════════════════════════════════════════════
  //  SOUVENIRS from globe memories
  // ════════════════════════════════════════════════
  async function loadTripSouvenirs() {
    if (!coupleId) return;
    try {
      // We call the existing globe API to get trip memories
      const res = await fetch(`https://us-app-av6d.onrender.com/api/globe/${coupleId}`);
      if (!res.ok) return;
      const trips = await res.json();
      if (!trips || !trips.length) return;

      // Place one souvenir per unique country (max 4)
      const countries = [...new Set(trips.map(t => t.country))].slice(0, 4);
      countries.forEach((country, i) => {
        const x = -1.5 + i * 1.0;
        // Only add if not already placed
        if (_objects3d.some(o => o.userData.label === `souvenir_${country}`)) return;

        const souvenir = buildSouvenir(0x3a6ab8);
        souvenir.position.set(x, 0, 2.8);
        souvenir.userData = {
          isMemory: true, memType: 'souvenir',
          label: `souvenir_${country}`,
          meta: {
            message: `Souvenir from ${country} 🌍`,
            country
          }
        };
        scene.add(souvenir);
        _objects3d.push(souvenir);
      });
    } catch (_) {}
  }

  // ════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════
  async function init(threeScene) {
    scene    = threeScene;
    coupleId = HomeUtils.getCoupleId();
    myName   = HomeUtils.getMyName   ? HomeUtils.getMyName()    : 'You';
    partnerName = HomeUtils.getPartnerName ? HomeUtils.getPartnerName() : 'Partner';

    injectPopupStyle();
    injectAddUI();

    // Click handler on the Three.js canvas
    const canvas = HomeRenderer ? HomeRenderer.getCanvas() : document.getElementById('homeCanvas');
    if (canvas) canvas.addEventListener('click', onCanvasClick);

    // Room change
    window.addEventListener('home:roomChange', onRoomChange);

    // Particles
    initParticles();

    // Default shelf (living room)
    addDefaultMemoryShelf();

    // Load from Supabase
    await loadMemoryObjects();

    // Trip souvenirs
    loadTripSouvenirs().catch(() => {});

    // Auto-features
    checkAnniversaryDecoration();
    checkAchievementDecorations();

    // Realtime sync
    startSync();

    console.log('✅ HomeMemories Phase 5 loaded');
    return { objects: _objects3d };
  }

  // ════════════════════════════════════════════════
  //  PER-FRAME UPDATE
  // ════════════════════════════════════════════════
  let _updateT = 0;
  function update(dt) {
    _updateT += dt;

    // Particles
    updateParticles(dt);

    // Trophy star spin
    _objects3d.forEach(o => {
      if (o.userData.memType === 'trophy' && o.userData.starMesh) {
        o.userData.starMesh.rotation.y += dt * 1.2;
      }
      // Gift glow pulse
      if (o.userData.memType === 'gift' && o.userData.glowLight) {
        const s = 0.3 + 0.1 * Math.sin(_updateT * 2.5 + o.id);
        o.userData.glowLight.intensity = s;
      }
      // Voice cassette idle reel
      if (o.userData.isVoice) {
        o.children.forEach(c => {
          if (c.geometry && c.geometry.type === 'CylinderGeometry') {
            c.rotation.z += dt * 0.6;
          }
        });
      }
    });
  }

  // ════════════════════════════════════════════════
  //  DISPOSE
  // ════════════════════════════════════════════════
  function dispose() {
    stopSync();
    disposeParticles();
    _objects3d.forEach(o => { if (o.parent) o.parent.remove(o); });
    _objects3d = [];
    window.removeEventListener('home:roomChange', onRoomChange);
    closeMemoryPopup();
    closeDrawer();
    const canvas = HomeRenderer ? HomeRenderer.getCanvas() : document.getElementById('homeCanvas');
    if (canvas) canvas.removeEventListener('click', onCanvasClick);
    scene = null;
  }

  // ════════════════════════════════════════════════
  //  HELPERS
  // ════════════════════════════════════════════════
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
    );
  }

  // ── Public API ──────────────────────────────────
  return {
    init, update, dispose,
    // Drawer controls
    toggleDrawer, closeDrawer, saveFromDrawer,
    _selectType,
    // Popup controls
    openMemoryPopup, closeMemoryPopup,
    // Utils
    buildGiftBox, buildPhotoFrame, buildTrophy,
    buildAlbum, buildVoiceCassette, buildSouvenir,
    buildAnniversaryBanner, buildTimelinePlaque,
    buildTrophyCabinet,
    applyPhotoToFrame,
    spawnBurst,
    loadMemoryObjects,
    loadTripSouvenirs,
    // State
    getObjects: () => _objects3d,
    getMemories: () => memories
  };

})();

window.HomeMemories = HomeMemories;