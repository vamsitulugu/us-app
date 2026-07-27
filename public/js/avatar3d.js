/* ============================================================
   Avatar3D — real, live-rendered 3D figures for the Live Map.
   Not SVG icons: actual Three.js geometry, lit, animated, and
   rotated to the real GPS heading. Two persistent overlay
   canvases ('my' and 'pt') are attached directly to the map
   container and repositioned every frame using the map's own
   projection — independent of Leaflet/shim marker DOM churn,
   so the WebGL context is created once and never torn down.
   ============================================================ */
(function () {
  if (typeof window === 'undefined') return;

  const MODEL_CACHE = {}; // color+mode -> reusable geometry builder result is cheap enough to just rebuild per instance

  function loadThree(cb) {
    if (window.THREE) return cb();
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/three@0.128.0/build/three.min.js';
    s.onload = cb;
    s.onerror = () => console.warn('Avatar3D: failed to load three.js — falling back to flat icons');
    document.head.appendChild(s);
  }

  class Instance {
    constructor(who, size) {
      this.who = who;
      this.size = size;
      this.mode = 'walking';
      this.color = who === 'my' ? 0x5b9bff : 0xff6baf;
      this.heading = 0;
      this.speedKmh = 0;
      this.offline = false;
      this._t = 0;
      this._built = null;

      this.canvas = document.createElement('canvas');
      this.canvas.width = size;
      this.canvas.height = size;
      this.canvas.style.cssText = `position:absolute;left:-999px;top:-999px;width:${size}px;height:${size}px;pointer-events:none;z-index:${who === 'my' ? 640 : 650};transform:translate(-50%,-72%);filter:drop-shadow(0 4px 6px rgba(0,0,0,.45));transition:left .35s linear,top .35s linear;`;

      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setSize(size, size, false);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      this.camera.position.set(0, 2.4, 6.5);
      this.camera.lookAt(0, 0.6, 0);

      const amb = new THREE.AmbientLight(0xffffff, 0.65);
      const dir = new THREE.DirectionalLight(0xffffff, 0.9);
      dir.position.set(3, 6, 4);
      this.scene.add(amb, dir);

      this.group = new THREE.Group();
      this.scene.add(this.group);

      this._buildModel();
      this._raf = requestAnimationFrame(this._tick.bind(this));
    }

    _clearGroup() {
      while (this.group.children.length) {
        const c = this.group.children.pop();
        c.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      }
    }

    _mat(colorHex, opts) {
      return new THREE.MeshStandardMaterial(Object.assign({ color: colorHex, roughness: 0.55, metalness: 0.15 }, opts || {}));
    }

    _buildModel() {
      this._clearGroup();
      const col = this.color;
      if (this.mode === 'car') this._built = this._buildCar(col);
      else if (this.mode === 'bus') this._built = this._buildBus(col);
      else if (this.mode === 'bike') this._built = this._buildBike(col);
      else this._built = this._buildPerson(col);
    }

    _buildPerson(col) {
      const g = new THREE.Group();
      const skin = this._mat(0xffd7b0, { roughness: 0.7 });
      const cloth = this._mat(col);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 16), skin);
      head.position.y = 1.62;
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.24, 0.6, 4, 8) : new THREE.CylinderGeometry(0.24, 0.22, 0.75, 10), cloth);
      torso.position.y = 1.15;
      const hip = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.18, 10), cloth);
      hip.position.y = 0.78;
      const legL = new THREE.Group(); const legR = new THREE.Group();
      const legGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.75, 8);
      const legMeshL = new THREE.Mesh(legGeo, cloth); legMeshL.position.y = -0.375;
      const legMeshR = new THREE.Mesh(legGeo, cloth); legMeshR.position.y = -0.375;
      legL.position.set(-0.11, 0.7, 0); legR.position.set(0.11, 0.7, 0);
      legL.add(legMeshL); legR.add(legMeshR);
      const armGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.6, 8);
      const armL = new THREE.Group(); const armR = new THREE.Group();
      const armMeshL = new THREE.Mesh(armGeo, skin); armMeshL.position.y = -0.3;
      const armMeshR = new THREE.Mesh(armGeo, skin); armMeshR.position.y = -0.3;
      armL.position.set(-0.32, 1.4, 0); armR.position.set(0.32, 1.4, 0);
      armL.add(armMeshL); armR.add(armMeshR);
      g.add(head, torso, hip, legL, legR, armL, armR);
      g.userData = { legL, legR, armL, armR };
      return g;
    }

    _wheel() {
      const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 16);
      geo.rotateZ(Math.PI / 2);
      return new THREE.Mesh(geo, this._mat(0x191919, { roughness: 0.9, metalness: 0.1 }));
    }

    _buildCar(col) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 2.2), this._mat(col, { metalness: 0.4, roughness: 0.35 }));
      body.position.y = 0.55;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 1.1), this._mat(0xbfe3ff, { metalness: 0.6, roughness: 0.15, transparent: true, opacity: 0.85 }));
      cabin.position.set(0, 0.98, -0.05);
      const wheels = [[-0.58, 0.28, 0.75], [0.58, 0.28, 0.75], [-0.58, 0.28, -0.75], [0.58, 0.28, -0.75]].map(p => { const w = this._wheel(); w.position.set(...p); return w; });
      g.add(body, cabin, ...wheels);
      g.userData = { wheels };
      return g;
    }

    _buildBus(col) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.1, 3.4), this._mat(col, { metalness: 0.3, roughness: 0.4 }));
      body.position.y = 0.95;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.17, 0.22, 3.42), this._mat(0xffffff, { roughness: 0.6 }));
      stripe.position.y = 0.68;
      const windows = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.35, 3.1), this._mat(0xbfe3ff, { metalness: 0.5, roughness: 0.2, transparent: true, opacity: 0.85 }));
      windows.position.y = 1.25;
      const wheels = [[-0.62, 0.28, 1.15], [0.62, 0.28, 1.15], [-0.62, 0.28, -1.15], [0.62, 0.28, -1.15]].map(p => { const w = this._wheel(); w.position.set(...p); return w; });
      g.add(body, stripe, windows, ...wheels);
      g.userData = { wheels };
      return g;
    }

    _buildBike(col) {
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.3), this._mat(col, { metalness: 0.5, roughness: 0.3 }));
      frame.position.y = 0.55;
      const seatPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8), this._mat(0x222222));
      seatPost.position.set(0, 0.78, -0.45);
      const wheels = [[0, 0.32, 0.65], [0, 0.32, -0.65]].map(p => { const w = this._wheel(); w.rotation.z = 0; w.geometry = new THREE.CylinderGeometry(0.32, 0.32, 0.06, 20); w.position.set(...p); return w; });
      const rider = this._buildPerson(0x333333);
      rider.scale.set(0.85, 0.85, 0.85);
      rider.position.set(0, 0.3, 0.05);
      g.add(frame, seatPost, ...wheels, rider);
      g.userData = { wheels, rider: rider.userData };
      return g;
    }

    setState({ mode, color, heading, speedKmh, offline }) {
      let rebuilt = false;
      if (mode && mode !== this.mode) { this.mode = mode; rebuilt = true; }
      if (typeof color === 'number' && color !== this.color) { this.color = color; rebuilt = true; }
      if (rebuilt) this._buildModel();
      if (typeof heading === 'number' && !isNaN(heading)) this.heading = heading;
      if (typeof speedKmh === 'number') this.speedKmh = speedKmh;
      if (typeof offline === 'boolean') this.offline = offline;
      this.canvas.style.opacity = this.offline ? '0.55' : '1';
    }

    setScreenPos(x, y, visible) {
      if (!visible) { this.canvas.style.left = '-999px'; this.canvas.style.top = '-999px'; return; }
      this.canvas.style.left = Math.round(x) + 'px';
      this.canvas.style.top = Math.round(y) + 'px';
    }

    _tick(now) {
      this._raf = requestAnimationFrame(this._tick.bind(this));
      const dt = 0.032;
      this._t += dt * (0.6 + Math.min(2.2, this.speedKmh / 12));
      const g = this.group.children[0]?.parent === this.group ? null : null;
      const target = this._built;
      // walk cycle
      if (target?.userData?.legL) {
        const swing = this.mode === 'bike' ? 0 : Math.sin(this._t * 6) * 0.55;
        target.userData.legL.rotation.x = swing;
        target.userData.legR.rotation.x = -swing;
        if (target.userData.armL) {
          target.userData.armL.rotation.x = -swing * 0.8;
          target.userData.armR.rotation.x = swing * 0.8;
        }
      }
      if (target?.userData?.rider?.legL) {
        target.userData.rider.legL.rotation.x = -0.5;
        target.userData.rider.legR.rotation.x = -0.5;
      }
      // wheel spin
      if (target?.userData?.wheels) {
        const spin = this._t * (1.5 + this.speedKmh * 0.35);
        target.userData.wheels.forEach(w => { w.rotation.x = spin; });
      }
      this._clearGroupAndAdd(target);
      this.group.rotation.y = (-(this.heading || 0) * Math.PI / 180);
      this.renderer.render(this.scene, this.camera);
    }

    _clearGroupAndAdd(target) {
      if (this.group.children[0] !== target) {
        while (this.group.children.length) this.group.remove(this.group.children[0]);
        this.group.add(target);
      }
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      this.canvas.remove();
      this.renderer.dispose();
    }
  }

  const instances = {};
  let overlayHost = null;

  const Avatar3D = {
    ready: false,
    init(mapContainerEl) {
      overlayHost = mapContainerEl;
      loadThree(() => { Avatar3D.ready = true; });
    },
    // who: 'my' | 'pt'   state: {mode,color(0xRRGGBB),heading,speedKmh,offline}
    update(who, screenX, screenY, visible, state) {
      if (!Avatar3D.ready || !overlayHost) return false;
      let inst = instances[who];
      if (!inst) {
        inst = instances[who] = new Instance(who, who === 'my' ? 56 : 68);
        overlayHost.appendChild(inst.canvas);
      }
      inst.setState(state || {});
      inst.setScreenPos(screenX, screenY, visible);
      return true;
    },
    hide(who) { if (instances[who]) instances[who].setScreenPos(0, 0, false); },
    isReady() { return Avatar3D.ready; }
  };

  window.Avatar3D = Avatar3D;
})();
