// public/home/furniture.js
// ════════════════════════════════════════════════
//  Furniture — Catalog, placement, drag-to-move,
//  context menu wiring (rotate/recolor/delete),
//  persisted via HomeAPI.furniture.
//  Hooks consumed by scene.js: HomeFurniture.update
//  Self-injects its own UI chrome (button + drawer +
//  color popover) — no home.html markup required.
// ════════════════════════════════════════════════
const HomeFurniture = (() => {

  let scene     = null;
  let coupleId  = null;
  let canvas    = null;
  let _items    = [];          // all placed furniture (THREE.Group roots), any room
  let _injected = false;

  // ════════════════════════════════════════════════
  //  Primitive helpers (mirrors style used in rooms.js)
  // ════════════════════════════════════════════════
  function mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.75,
      metalness: opts.metalness ?? 0.08,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0
    });
  }
  function box(w, h, d, color, opts = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  function cyl(rt, rb, h, color, segs = 14, opts = {}) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), mat(color, opts));
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  function sph(r, color, opts = {}) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(color, opts));
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  function cone(r, h, color, opts = {}) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), mat(color, opts));
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  function torus(r, tube, color, opts = {}) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 18), mat(color, opts));
    m.castShadow = m.receiveShadow = true;
    return m;
  }
  function put(o, x, y, z) { o.position.set(x, y, z); return o; }
  // Marks a mesh as the part that responds to the color picker
  function paint(mesh) { mesh.userData.paintable = true; return mesh; }

  // ════════════════════════════════════════════════
  //  Catalog — each item builds a fresh THREE.Group.
  //  `paint()`-tagged children are the ones recolored
  //  by the color picker / saved `color` field.
  // ════════════════════════════════════════════════
  const CATALOG = {
    chair: {
      icon: '🪑', label: 'Chair', defaultColor: '#8a5a3a',
      build(color) {
        const g = new THREE.Group();
        const seat = paint(box(0.5, 0.08, 0.5, color)); put(seat, 0, 0.45, 0); g.add(seat);
        const back = paint(box(0.5, 0.55, 0.08, color)); put(back, 0, 0.72, 0.21); g.add(back);
        [[-0.2,-0.2],[0.2,-0.2],[-0.2,0.2],[0.2,0.2]].forEach(([x,z]) => {
          const leg = box(0.05, 0.45, 0.05, 0x2a2018); put(leg, x, 0.22, z); g.add(leg);
        });
        return g;
      }
    },
    side_table: {
      icon: '🛋️', label: 'Side Table', defaultColor: '#3a2a1f',
      build(color) {
        const g = new THREE.Group();
        const top = paint(cyl(0.32, 0.32, 0.05, color)); put(top, 0, 0.5, 0); g.add(top);
        const leg = box(0.04, 0.48, 0.04, 0x222222, { metalness: 0.5 }); put(leg, 0, 0.24, 0); g.add(leg);
        const base = cyl(0.18, 0.18, 0.03, 0x222222, 12, { metalness: 0.5 }); put(base, 0, 0.02, 0); g.add(base);
        return g;
      }
    },
    floor_lamp: {
      icon: '💡', label: 'Floor Lamp', defaultColor: '#ffd9a0',
      build(color) {
        const g = new THREE.Group();
        const pole = cyl(0.025, 0.025, 1.5, 0x2a2a2a, 8, { metalness: 0.5 }); put(pole, 0, 0.75, 0); g.add(pole);
        const base = cyl(0.18, 0.2, 0.05, 0x2a2a2a, 12, { metalness: 0.5 }); put(base, 0, 0.03, 0); g.add(base);
        const shade = paint(cone(0.24, 0.34, color, { emissive: 0xffcf8a, emissiveIntensity: 0.7 })); put(shade, 0, 1.62, 0); g.add(shade);
        const light = new THREE.PointLight(0xffd9a0, 0.55, 4, 2);
        light.position.set(0, 1.6, 0); g.add(light);
        g.userData.lightRef = light;
        return g;
      }
    },
    potted_plant: {
      icon: '🪴', label: 'Potted Plant', defaultColor: '#2f7a3f',
      build(color) {
        const g = new THREE.Group();
        const pot = box(0.3, 0.32, 0.3, 0xaa6a44, { roughness: 0.9 }); put(pot, 0, 0.16, 0); g.add(pot);
        const leaves = paint(sph(0.32, color, { roughness: 0.85 })); put(leaves, 0, 0.55, 0); g.add(leaves);
        return g;
      }
    },
    bookshelf_small: {
      icon: '📚', label: 'Bookshelf', defaultColor: '#3a2a18',
      build(color) {
        const g = new THREE.Group();
        const frame = paint(box(0.8, 1.4, 0.3, color, { roughness: 0.65 })); put(frame, 0, 0.7, 0); g.add(frame);
        for (let row = 0; row < 3; row++) {
          for (let i = 0; i < 5; i++) {
            const hue = Math.floor(Math.random() * 360);
            const bk = box(0.1, 0.28, 0.2, new THREE.Color(`hsl(${hue},45%,38%)`).getHex(), { roughness: 0.85 });
            put(bk, -0.3 + i * 0.15, 0.3 + row * 0.42, 0.05); g.add(bk);
          }
        }
        return g;
      }
    },
    area_rug: {
      icon: '🟪', label: 'Area Rug', defaultColor: '#6b3a4a',
      build(color) {
        const g = new THREE.Group();
        const rug = paint(new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), mat(color, { roughness: 1 })));
        rug.rotation.x = -Math.PI / 2; rug.receiveShadow = true; rug.castShadow = false;
        rug.position.y = 0.005;
        g.add(rug);
        return g;
      }
    },
    sofa_small: {
      icon: '🛏️', label: 'Loveseat', defaultColor: '#5a3d52',
      build(color) {
        const g = new THREE.Group();
        const base = paint(box(1.4, 0.45, 0.7, color, { roughness: 0.85 })); put(base, 0, 0.225, 0); g.add(base);
        const back = paint(box(1.4, 0.55, 0.16, color, { roughness: 0.85 })); put(back, 0, 0.55, 0.33); g.add(back);
        [-0.66, 0.66].forEach(x => {
          const arm = box(0.16, 0.4, 0.7, color, { roughness: 0.85 }); put(arm, x, 0.32, 0); g.add(arm);
        });
        return g;
      }
    },
    tv_console: {
      icon: '📺', label: 'TV Console', defaultColor: '#241f1a',
      build(color) {
        const g = new THREE.Group();
        const body = paint(box(1.2, 0.42, 0.4, color, { roughness: 0.5 })); put(body, 0, 0.21, 0); g.add(body);
        [-0.4, 0.4].forEach(x => {
          const leg = box(0.04, 0.08, 0.04, 0x111111); put(leg, x, 0.04, 0); g.add(leg);
        });
        return g;
      }
    },
    pet_bed: {
      icon: '🐾', label: 'Pet Bed', defaultColor: '#d98c4a',
      build(color) {
        const g = new THREE.Group();
        const ring = paint(torus(0.34, 0.1, color, { roughness: 0.9 })); ring.rotation.x = Math.PI / 2; put(ring, 0, 0.1, 0); g.add(ring);
        const cushion = sph(0.26, 0xf2c089, { roughness: 0.9 }); cushion.scale.y = 0.35; put(cushion, 0, 0.08, 0); g.add(cushion);
        return g;
      }
    },
    candle_stand: {
      icon: '🕯️', label: 'Candle Stand', defaultColor: '#ffe7b8',
      build(color) {
        const g = new THREE.Group();
        const stand = cyl(0.08, 0.1, 0.5, 0x2a2a2a, 10, { metalness: 0.5 }); put(stand, 0, 0.25, 0); g.add(stand);
        const candle = paint(cyl(0.05, 0.05, 0.18, color, 10, { emissive: 0xffd9a0, emissiveIntensity: 0.4 })); put(candle, 0, 0.59, 0); g.add(candle);
        const flame = cone(0.025, 0.07, 0xffb347, { emissive: 0xff9a1f, emissiveIntensity: 1.3, castShadow: false });
        put(flame, 0, 0.7, 0); g.add(flame);
        g.userData.flame = flame;
        return g;
      }
    }
  };

  const COLOR_SWATCHES = [
    '#ffffff', '#e8c4d8', '#ff8c42', '#ffd24a', '#7a4f6b',
    '#5a3d52', '#3a2a1f', '#2f7a3f', '#2a7fb0', '#9d5cff',
    '#d98c4a', '#1c1c22'
  ];

  // ════════════════════════════════════════════════
  //  Persistence helpers
  // ════════════════════════════════════════════════
  function setPaintColor(root, hexColor) {
    root.traverse(n => { if (n.userData && n.userData.paintable && n.material) n.material.color.set(hexColor); });
    root.userData.color = hexColor;
  }

  async function persistAdd(root) {
    if (!coupleId) return;
    try {
      const saved = await HomeAPI.furniture.add({
        coupleId, room: root.userData.room,
        obj_type: root.userData.objType, obj_key: root.userData.objType,
        label: root.userData.label,
        pos_x: root.position.x, pos_y: root.position.y, pos_z: root.position.z,
        rot_y: root.rotation.y, scale: root.scale.x,
        color: root.userData.color
      });
      root.userData.dbId = saved.id;
    } catch (err) {
      HomeUtils.toast('Could not save furniture: ' + err.message, 'error');
    }
  }

  async function persistColor(root) {
    if (!root.userData.dbId) return;
    try { await HomeAPI.furniture.update(root.userData.dbId, { color: root.userData.color }); }
    catch (err) { HomeUtils.toast('Could not save color: ' + err.message, 'error'); }
  }

  // ════════════════════════════════════════════════
  //  Load existing furniture for this couple
  // ════════════════════════════════════════════════
  async function loadExisting() {
    if (!coupleId) return;
    let rows = [];
    try { rows = await HomeAPI.furniture.list(coupleId); } catch (e) { return; }

    const activeRoom = HomeScene.state.currentRoom;
    (rows || []).forEach(row => {
      const def = CATALOG[row.obj_type];
      const root = def ? def.build(row.color || def.defaultColor) : fallbackMesh();
      root.position.set(row.pos_x || 0, row.pos_y || 0, row.pos_z || 0);
      root.rotation.y = row.rot_y || 0;
      const s = row.scale || 1;
      root.scale.set(s, s, s);
      root.userData.dbId   = row.id;
      root.userData.objType= row.obj_type;
      root.userData.room   = row.room;
      root.userData.label  = row.label || (def ? def.label : row.obj_type);
      root.userData.color  = row.color || (def ? def.defaultColor : '#ffffff');
      root.visible = (row.room === activeRoom);
      scene.add(root);
      _items.push(root);
    });
  }

  function fallbackMesh() {
    const g = new THREE.Group();
    const m = paint(box(0.4, 0.4, 0.4, '#888888'));
    put(m, 0, 0.2, 0);
    g.add(m);
    return g;
  }

  // ════════════════════════════════════════════════
  //  Add a new catalog item to the active room
  // ════════════════════════════════════════════════
  async function addItem(typeKey) {
    const def = CATALOG[typeKey];
    if (!def) return;

    const room = HomeScene.state.currentRoom;
    const root = def.build(def.defaultColor);
    root.userData.objType = typeKey;
    root.userData.room    = room;
    root.userData.label   = def.label;
    root.userData.color   = def.defaultColor;
    root.userData.dbId    = null;

    put(root, HomeUtils.rand(-0.8, 0.8), 0, 2.2 + HomeUtils.rand(-0.5, 0.5));
    scene.add(root);
    _items.push(root);
    closeCatalog();
    HomeUtils.toast(def.icon + ' ' + def.label + ' added — drag to place');

    await persistAdd(root);

    // Hand it straight to controls.js so the person can place it immediately
    const rect = canvas.getBoundingClientRect();
    HomeControls.startDrag(root, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function removeLocal(dbId) {
    _items = _items.filter(it => it.userData.dbId !== dbId);
  }

  // ════════════════════════════════════════════════
  //  Room visibility sync (listens to scene.js's event)
  // ════════════════════════════════════════════════
  function onRoomChange(e) {
    const room = e.detail.room;
    _items = _items.filter(it => !!it.parent);     // drop anything ctxDelete already removed
    _items.forEach(it => { it.visible = (it.userData.room === room); });
  }

  // ════════════════════════════════════════════════
  //  Pointer wiring — raycast to start drags / open menus
  // ════════════════════════════════════════════════
  function activeRoomItems() {
    const room = HomeScene.state.currentRoom;
    _items = _items.filter(it => !!it.parent);
    return _items.filter(it => it.userData.room === room && it.visible);
  }

  function pickRoot(intersectedObject) {
    let o = intersectedObject;
    while (o && o.userData.dbId === undefined && !(o.userData && o.userData.objType)) o = o.parent;
    return o;
  }

  function raycastFurniture(cx, cy) {
    const raycaster = HomeControls.getRaycaster(cx, cy);
    const hits = raycaster.intersectObjects(activeRoomItems(), true);
    if (!hits.length) return null;
    return pickRoot(hits[0].object);
  }

  let _touchTimer = null, _touchStart = null, _touchHit = null;

  function wirePointerEvents() {
    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (!HomeScene.state.editMode) return;
      const hit = raycastFurniture(e.clientX, e.clientY);
      if (hit) HomeControls.startDrag(hit, e.clientX, e.clientY);
    });

    canvas.addEventListener('contextmenu', e => {
      const hit = raycastFurniture(e.clientX, e.clientY);
      if (hit && typeof window.openCtxMenu === 'function') {
        window.openCtxMenu(hit, e.clientX, e.clientY);
      }
    });

    // Click without drag (outside edit mode) — friendly label toast
    let downAt = null;
    canvas.addEventListener('mousedown', e => { downAt = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    canvas.addEventListener('mouseup', e => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      if (moved < 5 && !HomeScene.state.editMode) {
        const hit = raycastFurniture(e.clientX, e.clientY);
        if (hit) HomeUtils.toast(hit.userData.label || 'Furniture');
      }
      downAt = null;
    });

    // Touch: long-press opens the context menu; a real drag is promoted
    // to HomeControls only once the finger actually moves while in edit mode.
    canvas.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      _touchHit   = raycastFurniture(t.clientX, t.clientY);
      _touchStart = { x: t.clientX, y: t.clientY };
      if (!_touchHit) return;
      clearTimeout(_touchTimer);
      _touchTimer = setTimeout(() => {
        if (_touchHit && typeof window.openCtxMenu === 'function') {
          window.openCtxMenu(_touchHit, _touchStart.x, _touchStart.y);
        }
        _touchTimer = null;
      }, 550);
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
      if (!_touchHit || !_touchStart || e.touches.length !== 1) return;
      const t = e.touches[0];
      const moved = Math.hypot(t.clientX - _touchStart.x, t.clientY - _touchStart.y);
      if (moved > 8) {
        clearTimeout(_touchTimer); _touchTimer = null;
        if (HomeScene.state.editMode) {
          HomeControls.startDrag(_touchHit, t.clientX, t.clientY);
        }
        _touchHit = null;
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      clearTimeout(_touchTimer); _touchTimer = null; _touchHit = null; _touchStart = null;
    }, { passive: true });
  }

  // ════════════════════════════════════════════════
  //  Self-injected UI: add-button, catalog drawer, color popover
  // ════════════════════════════════════════════════
  function injectUI() {
    if (_injected) return;
    _injected = true;

    const style = document.createElement('style');
    style.textContent = `
      #hfAddBtn { }
      #hfCatalog {
        position: fixed; left: 50%; bottom: 0; transform: translate(-50%, 100%);
        width: min(420px, 100vw); max-height: 60vh; overflow-y: auto;
        background: rgba(4,4,16,0.96); backdrop-filter: blur(20px) saturate(160%);
        border: 1px solid var(--border2); border-radius: 18px 18px 0 0;
        z-index: 250; transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
        padding: 16px 14px 24px;
      }
      #hfCatalog.open { transform: translate(-50%, 0); }
      #hfCatalog .hf-title {
        font-family: var(--ff-serif); font-size: 16px; color: #fff;
        display: flex; align-items: center; justify-content: space-between;
        padding-bottom: 10px; border-bottom: 1px solid var(--border); margin-bottom: 10px;
      }
      #hfCatalog .hf-grid {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
      }
      .hf-item {
        background: var(--g1); border: 1px solid var(--border); border-radius: 12px;
        padding: 12px 6px; display: flex; flex-direction: column; align-items: center; gap: 4px;
        cursor: pointer; transition: var(--t); text-align: center;
      }
      .hf-item:hover { background: var(--g2); transform: translateY(-2px); }
      .hf-item .hf-ico { font-size: 22px; }
      .hf-item .hf-lbl { font-size: 10px; color: var(--text2); font-weight: 600; }
      #hfOverlay {
        position: fixed; inset: 0; z-index: 249; background: rgba(2,2,9,0.45);
        display: none;
      }
      #hfOverlay.show { display: block; }
      #hfColorPop {
        position: fixed; z-index: 520; display: none;
        background: rgba(4,4,16,0.96); backdrop-filter: var(--blur);
        border: 1px solid var(--border2); border-radius: 14px; padding: 10px;
        left: 50%; top: 50%; transform: translate(-50%, -50%);
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      }
      #hfColorPop.show { display: block; }
      #hfColorPop .hf-swatch-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
      .hf-swatch {
        width: 26px; height: 26px; border-radius: 50%; cursor: pointer;
        border: 2px solid rgba(255,255,255,0.25); transition: var(--t);
      }
      .hf-swatch:hover { transform: scale(1.15); border-color: #fff; }
    `;
    document.head.appendChild(style);

    // Add-furniture button, dropped into the existing top bar
    const tbRight = document.querySelector('.tb-right');
    if (tbRight) {
      const btn = document.createElement('button');
      btn.className = 'ic-btn'; btn.id = 'hfAddBtn'; btn.title = 'Add Furniture';
      btn.textContent = '🛋️';
      btn.onclick = toggleCatalog;
      tbRight.insertBefore(btn, tbRight.firstChild);
    }

    // Overlay + catalog drawer
    const overlay = document.createElement('div');
    overlay.id = 'hfOverlay';
    overlay.onclick = closeCatalog;
    document.body.appendChild(overlay);

    const drawer = document.createElement('div');
    drawer.id = 'hfCatalog';
    drawer.innerHTML = `
      <div class="hf-title">🛋️ Add Furniture <span style="cursor:pointer" id="hfCatalogClose">✕</span></div>
      <div class="hf-grid" id="hfGrid"></div>
    `;
    document.body.appendChild(drawer);
    drawer.querySelector('#hfCatalogClose').onclick = closeCatalog;

    const grid = drawer.querySelector('#hfGrid');
    Object.entries(CATALOG).forEach(([key, def]) => {
      const cell = document.createElement('div');
      cell.className = 'hf-item';
      cell.innerHTML = `<div class="hf-ico">${def.icon}</div><div class="hf-lbl">${def.label}</div>`;
      cell.onclick = () => addItem(key);
      grid.appendChild(cell);
    });

    // Color popover (driven by ctxColorPick patch in home.html)
    const pop = document.createElement('div');
    pop.id = 'hfColorPop';
    const swGrid = document.createElement('div');
    swGrid.className = 'hf-swatch-grid';
    COLOR_SWATCHES.forEach(hex => {
      const sw = document.createElement('div');
      sw.className = 'hf-swatch';
      sw.style.background = hex;
      sw.onclick = () => {
        if (pop._target) {
          setPaintColor(pop._target, hex);
          persistColor(pop._target);
        }
        closeColorPicker();
      };
      swGrid.appendChild(sw);
    });
    pop.appendChild(swGrid);
    document.body.appendChild(pop);
    pop.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => closeColorPicker());
  }

  function toggleCatalog() {
    const open = document.getElementById('hfCatalog').classList.contains('open');
    if (open) closeCatalog(); else openCatalog();
  }
  function openCatalog() {
    document.getElementById('hfCatalog').classList.add('open');
    document.getElementById('hfOverlay').classList.add('show');
  }
  function closeCatalog() {
    document.getElementById('hfCatalog').classList.remove('open');
    document.getElementById('hfOverlay').classList.remove('show');
  }

  function openColorPicker(root) {
    const pop = document.getElementById('hfColorPop');
    if (!pop) return;
    pop._target = root;
    pop.classList.add('show');
  }
  function closeColorPicker() {
    const pop = document.getElementById('hfColorPop');
    if (pop) pop.classList.remove('show');
  }

  // ════════════════════════════════════════════════
  //  Init / update / dispose
  // ════════════════════════════════════════════════
  async function init(threeScene, cid) {
    scene    = threeScene;
    coupleId = cid;
    canvas   = HomeRenderer.getCanvas();

    injectUI();
    wirePointerEvents();
    window.addEventListener('home:roomChange', onRoomChange);

    await loadExisting();
    return { items: _items };
  }

  function update(dt) {
    _items.forEach(it => {
      if (it.userData.flame) {
        const s = 1 + Math.sin(performance.now() * 0.01 + it.id) * 0.1;
        it.userData.flame.scale.set(s, s, s);
      }
    });
  }

  function dispose() {
    window.removeEventListener('home:roomChange', onRoomChange);
    _items.forEach(it => { if (it.parent) it.parent.remove(it); });
    _items = [];
    scene = null;
  }

  return {
    init, update, dispose,
    addItem, removeLocal,
    openCatalog, closeCatalog, toggleCatalog,
    openColorPicker, closeColorPicker,
    CATALOG
  };
})();

window.HomeFurniture = HomeFurniture;