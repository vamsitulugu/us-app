// public/home/rooms.js
// ════════════════════════════════════════════════
//  Rooms — Procedural geometry for all 9 rooms
//  Phase 3: walls, floor, ceiling, windows, decor.
//  No external assets — pure BufferGeometry primitives.
//  Hooks consumed by scene.js: HomeRooms.init / .showRoom / .update
// ════════════════════════════════════════════════
const HomeRooms = (() => {

  let scene        = null;
  let shellGroup   = null;   // shared indoor shell (floor/walls/ceiling/window)
  let outdoorGroup = null;   // shared outdoor ground (garden/rooftop)
  let decor        = {};     // roomName -> THREE.Group
  let currentRoom  = 'living';

  // ── Room dimensions (matches camera/orbit radii in camera.js & controls.js) ──
  const DIM = { halfW: 4.5, halfD: 4.6, height: 4.5 };

  // ── Per-room wall/floor palette (indoor rooms only) ──────────────
  const PALETTE = {
    living:   { wall: 0x241b2c, floor: 0x2e2018, trim: 0x4a3526 },
    bedroom:  { wall: 0x221d33, floor: 0x29223a, trim: 0x3a2f55 },
    kitchen:  { wall: 0x26241c, floor: 0x1f1d18, trim: 0xc9a25a },
    gameroom: { wall: 0x16102a, floor: 0x100b1f, trim: 0x6b4fd6 },
    music:    { wall: 0x271a20, floor: 0x231616, trim: 0x8a5a3a },
    library:  { wall: 0x201c14, floor: 0x191510, trim: 0x6b4a26 },
    petroom:  { wall: 0x1c2620, floor: 0x182019, trim: 0x4a7050 }
  };

  // ════════════════════════════════════════════════
  //  Small primitive helpers
  // ════════════════════════════════════════════════
  function mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.8,
      metalness: opts.metalness ?? 0.08,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      transparent: !!opts.opacity && opts.opacity < 1,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide
    });
  }

  function box(w, h, d, color, opts = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
    m.castShadow    = opts.castShadow    ?? true;
    m.receiveShadow = opts.receiveShadow ?? true;
    return m;
  }

  function cyl(rt, rb, h, color, segs = 16, opts = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), mat(color, opts));
    m.castShadow    = opts.castShadow    ?? true;
    m.receiveShadow = opts.receiveShadow ?? true;
    return m;
  }

  function sph(r, color, opts = {}) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat(color, opts));
    m.castShadow    = opts.castShadow    ?? true;
    m.receiveShadow = opts.receiveShadow ?? true;
    return m;
  }

  function cone(r, h, color, opts = {}) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 16), mat(color, opts));
    m.castShadow    = opts.castShadow    ?? true;
    m.receiveShadow = opts.receiveShadow ?? true;
    return m;
  }

  function torus(r, tube, color, opts = {}) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 20), mat(color, opts));
    m.castShadow    = opts.castShadow    ?? true;
    m.receiveShadow = opts.receiveShadow ?? true;
    return m;
  }

  function plane(w, h, color, opts = {}) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(color, { ...opts, side: opts.side ?? THREE.DoubleSide }));
    m.castShadow    = opts.castShadow    ?? false;
    m.receiveShadow = opts.receiveShadow ?? true;
    return m;
  }

  function put(obj, x, y, z, ry = 0) {
    obj.position.set(x, y, z);
    if (ry) obj.rotation.y = ry;
    return obj;
  }

  function group() { return new THREE.Group(); }

  // ════════════════════════════════════════════════
  //  Indoor shell (shared geometry, re-skinned per room)
  // ════════════════════════════════════════════════
  let parts = {};

  function buildIndoorShell() {
    shellGroup = group();
    shellGroup.name = 'homeShell';

    const W = DIM.halfW * 2, D = DIM.halfD * 2, H = DIM.height;

    // Floor
    parts.floor = plane(W, D, 0x2e2018, { roughness: 0.95, receiveShadow: true });
    parts.floor.rotation.x = -Math.PI / 2;
    parts.floor.position.y = 0;
    shellGroup.add(parts.floor);

    // Ceiling
    parts.ceiling = plane(W, D, 0x12101a, { roughness: 1, receiveShadow: false });
    parts.ceiling.rotation.x = Math.PI / 2;
    parts.ceiling.position.y = H;
    shellGroup.add(parts.ceiling);

    // Back wall (north, -Z)
    parts.backWall = plane(W, H, 0x241b2c, { roughness: 0.9 });
    put(parts.backWall, 0, H / 2, -DIM.halfD);
    shellGroup.add(parts.backWall);

    // Left wall (-X), faces +X into room
    parts.leftWall = plane(D, H, 0x241b2c, { roughness: 0.9 });
    put(parts.leftWall, -DIM.halfW, H / 2, 0, Math.PI / 2);
    shellGroup.add(parts.leftWall);

    // Right wall (+X) — holds the window
    parts.rightWall = plane(D, H, 0x241b2c, { roughness: 0.9 });
    put(parts.rightWall, DIM.halfW, H / 2, 0, -Math.PI / 2);
    shellGroup.add(parts.rightWall);

    // Floor trim (skirting boards along back + left wall)
    parts.trimBack = box(W, 0.18, 0.06, 0x4a3526, { roughness: 0.7 });
    put(parts.trimBack, 0, 0.09, -DIM.halfD + 0.03);
    shellGroup.add(parts.trimBack);

    parts.trimLeft = box(0.06, 0.18, D, 0x4a3526, { roughness: 0.7 });
    put(parts.trimLeft, -DIM.halfW + 0.03, 0.09, 0);
    shellGroup.add(parts.trimLeft);

    // ── Window (right wall) ──────────────────────
    const winGroup = group();
    const glass = plane(2.2, 2.4, 0xbfe6ff, { emissive: 0xbfe6ff, emissiveIntensity: 0.5, opacity: 0.55, roughness: 0.1, metalness: 0.3, receiveShadow: false });
    glass.rotation.y = -Math.PI / 2;
    put(glass, DIM.halfW - 0.04, H / 2 + 0.2, 0);
    winGroup.add(glass);
    parts.windowGlass = glass;

    // Frame (mullions)
    const frameColor = 0x3a2f24;
    const fTop = box(0.08, 2.5, 0.1, frameColor, { roughness: 0.6 });
    put(fTop, DIM.halfW - 0.02, H / 2 + 1.45, 0); winGroup.add(fTop);
    const fBot = box(0.08, 2.5, 0.1, frameColor, { roughness: 0.6 });
    put(fBot, DIM.halfW - 0.02, H / 2 - 1.05, 0); winGroup.add(fBot);
    [-1.15, 1.15].forEach(dz => {
      const fSide = box(0.08, 0.12, 2.6, frameColor, { roughness: 0.6 });
      put(fSide, DIM.halfW - 0.02, H / 2 + 0.2, dz);
      fSide.rotation.x = Math.PI / 2;
      winGroup.add(fSide);
    });
    const fMull = box(0.06, 2.5, 0.06, frameColor, { roughness: 0.6 });
    put(fMull, DIM.halfW - 0.02, H / 2 + 0.2, 0); winGroup.add(fMull);
    shellGroup.add(winGroup);
    parts.windowGroup = winGroup;

    scene.add(shellGroup);
  }

  function applyShellPalette(roomName) {
    const p = PALETTE[roomName] || PALETTE.living;
    parts.floor.material.color.setHex(p.floor);
    parts.backWall.material.color.setHex(p.wall);
    parts.leftWall.material.color.setHex(p.wall);
    parts.rightWall.material.color.setHex(p.wall);
    parts.trimBack.material.color.setHex(p.trim);
    parts.trimLeft.material.color.setHex(p.trim);
  }

  // ════════════════════════════════════════════════
  //  Outdoor ground (garden / rooftop share this group)
  // ════════════════════════════════════════════════
  let outdoorParts = {};

  function buildOutdoorGround() {
    outdoorGroup = group();
    outdoorGroup.name = 'homeOutdoor';

    outdoorParts.ground = plane(20, 20, 0x2c5e3a, { roughness: 1, receiveShadow: true });
    outdoorParts.ground.rotation.x = -Math.PI / 2;
    outdoorGroup.add(outdoorParts.ground);

    // Low perimeter wall / railing shared shape (re-skinned)
    outdoorParts.railBack = box(9, 0.9, 0.12, 0x3a3a3a, { roughness: 0.7 });
    put(outdoorParts.railBack, 0, 0.45, -4.6);
    outdoorGroup.add(outdoorParts.railBack);

    outdoorParts.railLeft = box(0.12, 0.9, 9.2, 0x3a3a3a, { roughness: 0.7 });
    put(outdoorParts.railLeft, -4.5, 0.45, 0);
    outdoorGroup.add(outdoorParts.railLeft);

    outdoorParts.railRight = box(0.12, 0.9, 9.2, 0x3a3a3a, { roughness: 0.7 });
    put(outdoorParts.railRight, 4.5, 0.45, 0);
    outdoorGroup.add(outdoorParts.railRight);

    scene.add(outdoorGroup);
  }

  function applyOutdoorVariant(roomName) {
    if (roomName === 'garden') {
      outdoorParts.ground.material.color.setHex(0x2c5e3a);
      outdoorParts.ground.material.roughness = 1;
      [outdoorParts.railBack, outdoorParts.railLeft, outdoorParts.railRight].forEach(r => {
        r.material.color.setHex(0x6b5638); // low garden wall, terracotta-ish
      });
    } else { // rooftop
      outdoorParts.ground.material.color.setHex(0x3a3530); // wood deck
      outdoorParts.ground.material.roughness = 0.7;
      [outdoorParts.railBack, outdoorParts.railLeft, outdoorParts.railRight].forEach(r => {
        r.material.color.setHex(0x1c1c22); // dark metal railing
      });
    }
  }

  // ════════════════════════════════════════════════
  //  Decor builders — one THREE.Group per room
  // ════════════════════════════════════════════════

  // ── Living Room: sofa, coffee table, fireplace + TV above it ──
  function buildLivingDecor() {
    const g = group();

    // Sofa facing the back wall
    const sofaBase = box(2.6, 0.5, 1.0, 0x5a3d52, { roughness: 0.85 });
    put(sofaBase, 0, 0.25, 1.4); g.add(sofaBase);
    const sofaBack = box(2.6, 0.7, 0.22, 0x5a3d52, { roughness: 0.85 });
    put(sofaBack, 0, 0.65, 1.86); g.add(sofaBack);
    [-1.18, 1.18].forEach(x => {
      const arm = box(0.22, 0.55, 1.0, 0x4a3144, { roughness: 0.85 });
      put(arm, x, 0.42, 1.4); g.add(arm);
    });
    [-0.7, 0, 0.7].forEach(x => {
      const cushion = box(0.7, 0.18, 0.85, 0x7a4f6b, { roughness: 0.8 });
      put(cushion, x, 0.55, 1.35); g.add(cushion);
    });

    // Coffee table
    const tableTop = cyl(0.55, 0.55, 0.06, 0x3a2a1f, { roughness: 0.4, metalness: 0.2 });
    put(tableTop, 0, 0.42, 0.2); g.add(tableTop);
    const tableLeg = cyl(0.05, 0.05, 0.4, 0x222222, { metalness: 0.6, roughness: 0.4 });
    put(tableLeg, 0, 0.2, 0.2); g.add(tableLeg);

    // Fireplace mantle (lights.fireplace sits at 0, 0.8, -4.5)
    const mantleBase = box(1.6, 1.0, 0.4, 0x2a2a2a, { roughness: 0.6 });
    put(mantleBase, 0, 0.5, -4.35); g.add(mantleBase);
    const fireOpening = box(1.0, 0.65, 0.1, 0x100808, { roughness: 0.9, castShadow: false });
    put(fireOpening, 0, 0.5, -4.18); g.add(fireOpening);
    const flame = cone(0.18, 0.45, 0xff7a1a, { emissive: 0xff5500, emissiveIntensity: 1.4, castShadow: false });
    put(flame, 0, 0.45, -4.15); g.add(flame);
    const mantleShelf = box(1.8, 0.08, 0.5, 0x3a2a1f, { roughness: 0.6 });
    put(mantleShelf, 0, 1.04, -4.35); g.add(mantleShelf);
    g.userData.flame = flame;

    // TV mounted above the mantle (lights.tvGlow sits at 0, 2, -4.6)
    const tvFrame = box(1.5, 0.85, 0.06, 0x111111, { roughness: 0.4, metalness: 0.3 });
    put(tvFrame, 0, 2.0, -4.5); g.add(tvFrame);
    const tvScreen = plane(1.38, 0.74, 0x1a3a6e, { emissive: 0x3a7ad6, emissiveIntensity: 0.6, receiveShadow: false });
    put(tvScreen, 0, 2.0, -4.46); g.add(tvScreen);
    g.userData.tvScreen = tvScreen;

    // Rug
    const rug = plane(2.6, 1.8, 0x6b3a4a, { roughness: 1, receiveShadow: true });
    rug.rotation.x = -Math.PI / 2;
    put(rug, 0, 0.01, 0.9); g.add(rug);

    return g;
  }

  // ── Bedroom: bed, nightstands + lamps, wardrobe ──
  function buildBedroomDecor() {
    const g = group();

    const frame = box(2.0, 0.4, 2.6, 0x2e2440, { roughness: 0.7 });
    put(frame, -0.8, 0.2, -1.6); g.add(frame);
    const mattress = box(1.9, 0.3, 2.5, 0xece3d6, { roughness: 0.9 });
    put(mattress, -0.8, 0.55, -1.6); g.add(mattress);
    const headboard = box(2.0, 1.1, 0.16, 0x3a2f55, { roughness: 0.7 });
    put(headboard, -0.8, 0.95, -2.85); g.add(headboard);
    [-1.55, -0.45].forEach((x, i) => {
      const pillow = box(0.55, 0.16, 0.4, 0xffffff, { roughness: 0.95 });
      put(pillow, x, 0.78, -2.55 + i * 0); g.add(pillow);
    });
    const duvet = box(1.9, 0.1, 1.4, 0x6b5a9a, { roughness: 0.85 });
    put(duvet, -0.8, 0.78, -0.55); g.add(duvet);

    // Nightstand + lamp
    const stand = box(0.5, 0.55, 0.5, 0x2e2440, { roughness: 0.7 });
    put(stand, 0.5, 0.28, -2.6); g.add(stand);
    const lampBase = cyl(0.06, 0.1, 0.3, 0x222222, 10);
    put(lampBase, 0.5, 0.7, -2.6); g.add(lampBase);
    const lampShade = cone(0.16, 0.22, 0xffd9a0, { emissive: 0xffcf8a, emissiveIntensity: 0.9, castShadow: false });
    put(lampShade, 0.5, 0.92, -2.6); g.add(lampShade);
    const lampLight = new THREE.PointLight(0xffd9a0, 0.5, 4, 2);
    lampLight.position.set(0.5, 0.95, -2.6);
    g.add(lampLight);

    // Wardrobe along left wall
    const wardrobe = box(0.6, 2.2, 1.6, 0x241d38, { roughness: 0.6 });
    put(wardrobe, -4.1, 1.1, 1.6); g.add(wardrobe);

    const rug = plane(1.8, 1.4, 0x4a3a6e, { roughness: 1 });
    rug.rotation.x = -Math.PI / 2;
    put(rug, -0.4, 0.01, 0.6); g.add(rug);

    return g;
  }

  // ── Kitchen: L-counter, island, cabinets ──
  function buildKitchenDecor() {
    const g = group();

    // Back counter
    const counter = box(6.5, 0.95, 0.7, 0x3a3528, { roughness: 0.5, metalness: 0.1 });
    put(counter, 0, 0.475, -4.2); g.add(counter);
    const counterTop = box(6.5, 0.06, 0.74, 0x1f1d18, { roughness: 0.25, metalness: 0.3 });
    put(counterTop, 0, 0.98, -4.2); g.add(counterTop);

    // Upper cabinets
    const cabinets = box(6.5, 0.8, 0.4, 0x4a4232, { roughness: 0.55 });
    put(cabinets, 0, 3.1, -4.35); g.add(cabinets);

    // Sink basin
    const sink = box(0.7, 0.18, 0.45, 0xcfd4d8, { roughness: 0.3, metalness: 0.5 });
    put(sink, -1.6, 0.93, -4.2); g.add(sink);

    // Stove top
    [-0.25, 0.25].forEach(dx => {
      [-0.18, 0.18].forEach(dz => {
        const burner = cyl(0.12, 0.12, 0.03, 0x111111, 12, { castShadow: false });
        put(burner, 1.8 + dx, 1.02, -4.2 + dz); g.add(burner);
      });
    });

    // Island
    const islandBase = box(1.6, 0.9, 0.9, 0x2c2a20, { roughness: 0.5 });
    put(islandBase, 0, 0.45, 0.6); g.add(islandBase);
    const islandTop = box(1.7, 0.06, 1.0, 0x1f1d18, { roughness: 0.25, metalness: 0.3 });
    put(islandTop, 0, 0.93, 0.6); g.add(islandTop);
    [-0.5, 0.5].forEach(x => {
      const stool = cyl(0.18, 0.18, 0.55, 0x3a2a1f, 12);
      put(stool, x, 0.27, 1.5); g.add(stool);
    });

    // Pendant lights over island
    [-0.45, 0.45].forEach(x => {
      const wire = cyl(0.01, 0.01, 1.0, 0x111111, 6, { castShadow: false });
      put(wire, x, 3.7, 0.6); g.add(wire);
      const shade = cone(0.16, 0.2, 0xffe7b8, { emissive: 0xffd58a, emissiveIntensity: 0.7, castShadow: false });
      put(shade, x, 3.15, 0.6); g.add(shade);
    });

    return g;
  }

  // ── Game Room: arcade cabinet, pool table, neon trim ──
  function buildGameroomDecor() {
    const g = group();

    // Arcade cabinet
    const cab = box(0.7, 1.9, 0.6, 0x14102a, { roughness: 0.5 });
    put(cab, -2.6, 0.95, -4.2); g.add(cab);
    const cabScreen = plane(0.5, 0.4, 0x220033, { emissive: 0xd060ff, emissiveIntensity: 0.9, receiveShadow: false });
    put(cabScreen, -2.6, 1.5, -3.89); g.add(cabScreen);
    const cabMarquee = box(0.72, 0.2, 0.62, 0xff3da6, { emissive: 0xff3da6, emissiveIntensity: 0.8 });
    put(cabMarquee, -2.6, 1.95, -4.2); g.add(cabMarquee);

    // Pool table
    const tableBody = box(2.4, 0.5, 1.3, 0x1a1228, { roughness: 0.6 });
    put(tableBody, 0.8, 0.25, 0.6); g.add(tableBody);
    const tableFelt = box(2.2, 0.05, 1.1, 0x0f5c3a, { roughness: 0.9 });
    put(tableFelt, 0.8, 0.53, 0.6); g.add(tableFelt);
    [[ -1.05, -0.5], [1.05, -0.5], [-1.05, 0.5], [1.05, 0.5], [-1.05, 0], [1.05, 0]].forEach(([dx, dz]) => {
      const leg = cyl(0.06, 0.06, 0.25, 0x1a1228, 8);
      put(leg, 0.8 + dx, 0.13, 0.6 + dz); g.add(leg);
    });

    // Neon trim strips along the back wall
    [-1.6, 1.6].forEach(x => {
      const strip = box(0.06, 3.6, 0.04, 0x9d5cff, { emissive: 0x9d5cff, emissiveIntensity: 1.0, castShadow: false });
      put(strip, x, 1.9, -4.55); g.add(strip);
    });

    return g;
  }

  // ── Music Room: piano, mic stand, speaker stacks ──
  function buildMusicDecor() {
    const g = group();

    // Upright piano
    const body = box(1.4, 1.2, 0.6, 0x1c1212, { roughness: 0.3, metalness: 0.2 });
    put(body, -1.6, 0.6, -4.1); g.add(body);
    const keys = box(1.2, 0.08, 0.3, 0xf0ecdf, { roughness: 0.5 });
    put(keys, -1.6, 0.95, -3.82); g.add(keys);
    const stool = cyl(0.22, 0.22, 0.42, 0x2a1c12, 12);
    put(stool, -1.6, 0.21, -3.4); g.add(stool);

    // Mic stand
    const micPole = cyl(0.02, 0.02, 1.2, 0x888888, 8, { metalness: 0.7, roughness: 0.3 });
    put(micPole, 0.4, 0.6, -3.6); g.add(micPole);
    const micBase = cyl(0.18, 0.22, 0.04, 0x222222, 10);
    put(micBase, 0.4, 0.02, -3.6); g.add(micBase);
    const micHead = sph(0.08, 0x333333, { metalness: 0.6, roughness: 0.3 });
    put(micHead, 0.4, 1.22, -3.6); g.add(micHead);

    // Speaker stacks
    [-3.0, 1.6].forEach(x => {
      const spk = box(0.6, 1.3, 0.55, 0x141414, { roughness: 0.6 });
      put(spk, x, 0.65, -3.9); g.add(spk);
      [0.95, 0.45].forEach(y => {
        const cone1 = cyl(0.18, 0.22, 0.06, 0x2a2a2a, 14, { castShadow: false });
        cone1.rotation.x = Math.PI / 2;
        put(cone1, x, y, -3.62); g.add(cone1);
      });
    });

    return g;
  }

  // ── Library: bookshelves, reading chair + lamp ──
  function buildLibraryDecor() {
    const g = group();

    // Back wall bookshelf
    const shelfBack = box(7.5, 3.2, 0.4, 0x2e2010, { roughness: 0.6 });
    put(shelfBack, 0, 1.6, -4.35); g.add(shelfBack);
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 14; i++) {
        const bw = 0.12 + Math.random() * 0.08;
        const bh = 0.32 + Math.random() * 0.1;
        const hue = HomeUtils.randInt(0, 360);
        const book = box(bw, bh, 0.26, new THREE.Color(`hsl(${hue},45%,35%)`).getHex(), { roughness: 0.85 });
        put(book, -3.6 + i * 0.52, 0.4 + row * 0.78, -4.18);
        g.add(book);
      }
    }

    // Side bookshelf
    const shelfSide = box(0.4, 3.0, 4.0, 0x2e2010, { roughness: 0.6 });
    put(shelfSide, -4.3, 1.5, 1.2); g.add(shelfSide);

    // Reading chair
    const chairSeat = box(0.8, 0.45, 0.8, 0x5a3a28, { roughness: 0.8 });
    put(chairSeat, 1.6, 0.45, 1.2); g.add(chairSeat);
    const chairBack = box(0.8, 0.9, 0.18, 0x5a3a28, { roughness: 0.8 });
    put(chairBack, 1.6, 0.85, 1.55); g.add(chairBack);
    [-0.35, 0.35].forEach(dx => {
      const arm = box(0.12, 0.3, 0.8, 0x4a2e1f, { roughness: 0.8 });
      put(arm, 1.6 + dx, 0.6, 1.2); g.add(arm);
    });

    // Floor lamp
    const lampPole = cyl(0.025, 0.025, 1.5, 0x222222, 8, { metalness: 0.6 });
    put(lampPole, 2.6, 0.75, 1.0); g.add(lampPole);
    const lampShade = cone(0.22, 0.3, 0xfff0c8, { emissive: 0xfff0c8, emissiveIntensity: 0.9, castShadow: false });
    put(lampShade, 2.6, 1.6, 1.0); g.add(lampShade);
    const lampLight = new THREE.PointLight(0xfff0c8, 0.6, 4.5, 2);
    lampLight.position.set(2.6, 1.6, 1.0);
    g.add(lampLight);

    // Rug
    const rug = plane(1.6, 1.6, 0x4a3220, { roughness: 1 });
    rug.rotation.x = -Math.PI / 2;
    put(rug, 1.8, 0.01, 1.2); g.add(rug);

    return g;
  }

  // ── Pet Room: pet bed, bowls, cat tower, toys ──
  function buildPetroomDecor() {
    const g = group();

    // Pet bed
    const bedRing = torus(0.5, 0.14, 0xd98c4a, { roughness: 0.9 });
    bedRing.rotation.x = Math.PI / 2;
    put(bedRing, -1.6, 0.14, -3.2); g.add(bedRing);
    const bedCushion = cyl(0.42, 0.42, 0.1, 0xf2c089, 20, { roughness: 0.9 });
    put(bedCushion, -1.6, 0.1, -3.2); g.add(bedCushion);

    // Bowls
    const bowl1 = cyl(0.18, 0.14, 0.1, 0x4488cc, 16, { metalness: 0.4, roughness: 0.4 });
    put(bowl1, -0.4, 0.05, -3.4); g.add(bowl1);
    const bowl2 = cyl(0.18, 0.14, 0.1, 0xcc6644, 16, { metalness: 0.4, roughness: 0.4 });
    put(bowl2, -0.05, 0.05, -3.4); g.add(bowl2);

    // Cat tower (stacked platforms)
    const towerPole = cyl(0.12, 0.12, 2.6, 0xd9b48f, 12, { roughness: 0.95 });
    put(towerPole, 2.2, 1.3, -3.6); g.add(towerPole);
    [0.4, 1.3, 2.3].forEach((y, i) => {
      const platform = cyl(0.55 - i * 0.08, 0.55 - i * 0.08, 0.08, 0xb98a5a, 16);
      put(platform, 2.2, y, -3.6); g.add(platform);
    });

    // Toys
    [[1.2, -2.0, 0xff5a8a], [0.6, -1.4, 0x5aff9a], [1.7, -1.0, 0xffd24a]].forEach(([x, z, c]) => {
      const toy = sph(0.12, c, { roughness: 0.6, emissive: c, emissiveIntensity: 0.15 });
      put(toy, x, 0.12, z); g.add(toy);
    });

    return g;
  }

  // ── Garden (outdoor): flower beds, pond, trees, bench ──
  function buildGardenDecor() {
    const g = group();

    // Pond
    const pond = cyl(1.1, 1.1, 0.06, 0x2a7fb0, 24, { metalness: 0.3, roughness: 0.15, opacity: 0.85, castShadow: false });
    put(pond, 1.6, 0.03, 1.4); g.add(pond);

    // Trees
    [[-3.2, -2.0], [-2.6, 2.4], [3.0, -1.6]].forEach(([x, z]) => {
      const trunk = cyl(0.14, 0.18, 1.4, 0x5a3a22, 8, { roughness: 0.9 });
      put(trunk, x, 0.7, z); g.add(trunk);
      const canopy = sph(0.75, 0x2f7a3f, { roughness: 0.85 });
      put(canopy, x, 1.7, z); g.add(canopy);
    });

    // Flower beds (clustered small spheres)
    const flowerColors = [0xff6b9d, 0xffd24a, 0xff8c42, 0xc77dff];
    for (let i = 0; i < 18; i++) {
      const c = flowerColors[i % flowerColors.length];
      const fx = -1.0 + Math.random() * 4.6;
      const fz = -3.6 + Math.random() * 1.4;
      const flower = sph(0.08, c, { roughness: 0.6, emissive: c, emissiveIntensity: 0.1, castShadow: false });
      put(flower, fx, 0.1, fz); g.add(flower);
      const stem = cyl(0.015, 0.015, 0.2, 0x2f7a3f, 6, { castShadow: false });
      put(stem, fx, 0.0, fz); g.add(stem);
    }
    const bedBox = box(5.0, 0.18, 1.4, 0x5a3a26, { roughness: 1 });
    put(bedBox, 1.2, 0.05, -3.4); g.add(bedBox);

    // Bench
    const benchSeat = box(1.2, 0.08, 0.45, 0x6b4a2e, { roughness: 0.8 });
    put(benchSeat, -1.0, 0.42, 2.4); g.add(benchSeat);
    const benchBack = box(1.2, 0.4, 0.08, 0x6b4a2e, { roughness: 0.8 });
    put(benchBack, -1.0, 0.66, 2.62); g.add(benchBack);
    [-0.5, 0.5].forEach(dx => {
      const leg = box(0.08, 0.42, 0.4, 0x3a2a1c, { roughness: 0.8 });
      put(leg, -1.0 + dx, 0.21, 2.4); g.add(leg);
    });

    return g;
  }

  // ── Rooftop (outdoor): lounge chairs, string lights, table ──
  function buildRooftopDecor() {
    const g = group();

    // Lounge chairs
    [-1.6, 0.4].forEach((x) => {
      const frame = box(0.6, 0.06, 1.6, 0x2c2c34, { roughness: 0.5, metalness: 0.3 });
      put(frame, x, 0.35, 1.4); g.add(frame);
      const cushion = box(0.55, 0.1, 1.5, 0xe8e0d0, { roughness: 0.85 });
      put(cushion, x, 0.41, 1.4); g.add(cushion);
      const backrest = box(0.55, 0.6, 0.08, 0xe8e0d0, { roughness: 0.85 });
      backrest.rotation.x = -0.5;
      put(backrest, x, 0.62, 0.7); g.add(backrest);
      [-0.25, 0.25].forEach(dz => {
        [-0.25, 0.25].forEach(dx2 => {
          const leg = cyl(0.025, 0.025, 0.32, 0x1c1c22, 6);
          put(leg, x + dx2 * 0.9, 0.16, 1.4 + dz * 1.5); g.add(leg);
        });
      });
    });

    // Side table
    const tableTop = cyl(0.3, 0.3, 0.05, 0x2c2c34, 16, { metalness: 0.4, roughness: 0.4 });
    put(tableTop, -0.6, 0.5, 1.4); g.add(tableTop);
    const tableLeg = cyl(0.03, 0.03, 0.45, 0x1c1c22, 8);
    put(tableLeg, -0.6, 0.27, 1.4); g.add(tableLeg);

    // Potted plants near the railing
    [[-4.0, -3.6], [4.0, -3.6], [-4.0, 3.6]].forEach(([x, z]) => {
      const pot = cyl(0.22, 0.16, 0.3, 0xaa6a44, 12, { roughness: 0.9 });
      put(pot, x, 0.15, z); g.add(pot);
      const plantBody = cone(0.28, 0.6, 0x2f7a3f, { roughness: 0.85 });
      put(plantBody, x, 0.6, z); g.add(plantBody);
    });

    // String lights — small glowing spheres along a gentle arc near the back rail
    const stringPts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const x = -4.2 + t * 8.4;
      const y = 1.4 + Math.sin(t * Math.PI) * 0.5;
      const z = -4.3;
      stringPts.push(new THREE.Vector3(x, y, z));
      const bulb = sph(0.04, 0xffe9a8, { emissive: 0xffe9a8, emissiveIntensity: 1.1, castShadow: false });
      bulb.position.set(x, y, z);
      g.add(bulb);
    }
    const stringLight = new THREE.PointLight(0xffe9a8, 0.5, 5, 2);
    stringLight.position.set(0, 1.7, -4.3);
    g.add(stringLight);

    return g;
  }

  // ════════════════════════════════════════════════
  //  Init / show / update / dispose
  // ════════════════════════════════════════════════
  function init(threeScene) {
    scene = threeScene;

    buildIndoorShell();
    buildOutdoorGround();

    decor.living   = buildLivingDecor();
    decor.bedroom  = buildBedroomDecor();
    decor.kitchen  = buildKitchenDecor();
    decor.gameroom = buildGameroomDecor();
    decor.music    = buildMusicDecor();
    decor.library  = buildLibraryDecor();
    decor.petroom  = buildPetroomDecor();
    decor.garden   = buildGardenDecor();
    decor.rooftop  = buildRooftopDecor();

    Object.entries(decor).forEach(([name, g]) => {
      g.name = 'decor_' + name;
      g.visible = false;
      scene.add(g);
    });

    showRoom(currentRoom, true);
    return { shellGroup, outdoorGroup, decor };
  }

  function showRoom(roomName) {
    if (!decor[roomName] && roomName !== 'living') roomName = 'living';
    const outdoor = (roomName === 'garden' || roomName === 'rooftop');

    if (shellGroup)   shellGroup.visible   = !outdoor;
    if (outdoorGroup) outdoorGroup.visible = outdoor;

    if (outdoor) applyOutdoorVariant(roomName);
    else         applyShellPalette(roomName);

    Object.entries(decor).forEach(([name, g]) => { g.visible = (name === roomName); });

    currentRoom = roomName;
  }

  // Subtle per-frame animation hooks (flame flicker driven by HomeLighting state,
  // TV screen pulse, pond shimmer) — purely cosmetic, safe to no-op if absent.
  let _t = 0;
  function update(dt) {
    _t += dt;

    const living = decor.living;
    if (living && living.visible) {
      const lights = window.HomeLighting ? HomeLighting.getAll() : null;
      if (living.userData.flame) {
        const baseScale = 1 + Math.sin(_t * 9) * 0.12 + Math.sin(_t * 5.3) * 0.06;
        living.userData.flame.scale.set(baseScale, 1 + Math.sin(_t * 7) * 0.18, baseScale);
        living.userData.flame.visible = !!(lights && lights.fireplace && lights.fireplace.intensity > 0.05);
      }
      if (living.userData.tvScreen) {
        const on = !!(lights && lights.tvGlow && lights.tvGlow.intensity > 0.05);
        living.userData.tvScreen.material.emissiveIntensity = on ? (0.5 + 0.15 * Math.sin(_t * 1.6)) : 0.05;
      }
    }
  }

  function dispose() {
    [shellGroup, outdoorGroup, ...Object.values(decor)].forEach(g => {
      if (g && scene) scene.remove(g);
    });
    decor = {};
    parts = {};
    outdoorParts = {};
    scene = null;
  }

  function getCurrentRoom() { return currentRoom; }

  return { init, showRoom, update, dispose, getCurrentRoom };
})();

window.HomeRooms = HomeRooms;
