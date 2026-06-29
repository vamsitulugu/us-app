// public/home/pets.js
// ════════════════════════════════════════════════
//  Pets — Phase 6, Feature 4 (+ Feature 7 pet interaction hooks)
//  Adopt pets (dog/cat/rabbit/bird/fish), stats, animations,
//  pet AI: random movement, follow owner, go to bed, drink
//  water, play with toys. Realtime-synced positions/state.
//  NEW MODULE — does not modify rooms/furniture/memories.
// ════════════════════════════════════════════════
const HomePets = (() => {

  let scene  = null;
  let loader = null;
  let clock  = null;
  const pets = []; // array of Pet instances

  // ── Placeholder asset paths per species ───────────
  const ASSET_PATHS = {
    dog:    '/home/assets/pets/dog.glb',
    cat:    '/home/assets/pets/cat.glb',
    rabbit: '/home/assets/pets/rabbit.glb',
    bird:   '/home/assets/pets/bird.glb',
    fish:   '/home/assets/pets/fish.glb'
  };

  const ANIM_CLIPS = {
    walk: 'Walk', run: 'Run', sleep: 'Sleep', eat: 'Eat', play: 'Play', idle: 'Idle'
  };

  // Species-specific tuning (placeholder geometry color/size + speed/sounds)
  const SPECIES_DEFAULTS = {
    dog:    { color: 0xb5793a, scale: 0.34, speed: 1.8, sound: 'bark',  flies: false, swims: false },
    cat:    { color: 0x8a8a8a, scale: 0.26, speed: 1.5, sound: 'meow',  flies: false, swims: false },
    rabbit: { color: 0xe8d9c4, scale: 0.20, speed: 1.7, sound: null,    flies: false, swims: false },
    bird:   { color: 0x4aa3df, scale: 0.14, speed: 2.2, sound: 'chirp', flies: true,  swims: false },
    fish:   { color: 0xff8c42, scale: 0.16, speed: 1.0, sound: null,    flies: false, swims: true  }
  };

  const STAT_DECAY_PER_MIN = { energy: 0.6, happiness: 0.4, health: 0.15 };
  const FRIENDSHIP_PER_LEVEL = 100;

  // Optional external hook — ai_behavior.js may assign this function
  // reference; left undefined-safe so pets.js has zero hard dependency.
  let aiTickHook = null;
  function _registerAIHook(fn) { aiTickHook = fn; }

  class Pet {
    constructor(data) {
      this.id        = data.id || ('pet_' + Date.now() + '_' + Math.floor(Math.random() * 9999));
      this.species   = data.species || 'dog';
      this.name       = data.name || _defaultName(this.species);
      this.ownerRole  = data.ownerRole || HomeUtils.getMyRole();

      this.stats = Object.assign({
        mood: 80, energy: 80, happiness: 80, health: 100,
        friendship: 0, level: 1, xp: 0
      }, data.stats || {});

      this.group   = new THREE.Group();
      this.group.name = 'pet_' + this.id;
      this.mesh    = null;
      this.mixer   = null;
      this.actions = {};
      this.current = null;
      this.loaded  = false;

      this.state = {
        position: new THREE.Vector3(
          data.x ?? 1.2,
          this.species === 'bird' ? 1.4 : (this.species === 'fish' ? 0.4 : 0),
          data.z ?? 1.2
        ),
        rotationY: 0,
        anim: 'idle',
        mode: 'idle' // idle | wander | follow | toBed | drink | play
      };

      this._wanderTarget = null;
      this._wanderCooldown = 0;

      this._buildPlaceholder();
      this.group.position.copy(this.state.position);
    }

    _buildPlaceholder() {
      const def = SPECIES_DEFAULTS[this.species] || SPECIES_DEFAULTS.dog;
      const body = new THREE.Group();

      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(def.scale * 0.55, def.scale * 1.1, 4, 8),
        new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.85 })
      );
      torso.rotation.z = Math.PI / 2;
      torso.position.y = def.scale * 0.6;
      torso.castShadow = true;
      body.add(torso);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(def.scale * 0.45, 12, 12),
        new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.8 })
      );
      head.position.set(def.scale * 1.0, def.scale * 0.7, 0);
      head.castShadow = true;
      body.add(head);

      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(def.scale * 0.18, def.scale * 0.6, 8),
        new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.85 })
      );
      tail.position.set(-def.scale * 1.0, def.scale * 0.65, 0);
      tail.rotation.z = Math.PI / 2.4;
      tail.name = 'tail';
      body.add(tail);
      this._tail = tail;

      if (this.species !== 'fish') {
        const earGeo = new THREE.ConeGeometry(def.scale * 0.12, def.scale * 0.3, 6);
        const earMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.85 });
        const earL = new THREE.Mesh(earGeo, earMat);
        const earR = new THREE.Mesh(earGeo, earMat);
        earL.position.set(def.scale * 0.9, def.scale * 1.05, def.scale * 0.2);
        earR.position.set(def.scale * 0.9, def.scale * 1.05, -def.scale * 0.2);
        earL.name = 'ear_l'; earR.name = 'ear_r';
        body.add(earL, earR);
        this._ears = [earL, earR];
      }

      this.group.add(body);
      this._placeholderBody = body;
    }

    async load(gltfLoader) {
      const path = ASSET_PATHS[this.species] || ASSET_PATHS.dog;
      return new Promise((resolve) => {
        gltfLoader.load(
          path,
          (gltf) => {
            if (this._placeholderBody) {
              this.group.remove(this._placeholderBody);
              this._disposePlaceholder();
            }
            this.mesh = gltf.scene;
            this.mesh.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
            this.group.add(this.mesh);
            this.mixer = new THREE.AnimationMixer(this.mesh);
            (gltf.animations || []).forEach(clip => { this.actions[clip.name] = this.mixer.clipAction(clip); });
            this.loaded = true;
            this.play('idle', 0);
            resolve(true);
          },
          undefined,
          () => {
            console.warn('[HomePets] GLTF not found at', path, '— using placeholder geometry for', this.species);
            resolve(false);
          }
        );
      });
    }

    _disposePlaceholder() {
      this._placeholderBody.traverse(n => { if (n.isMesh) { n.geometry.dispose(); n.material.dispose(); } });
      this._placeholderBody = null;
    }

    play(animKey, fadeDuration = 0.25, loop = true) {
      const clipName = ANIM_CLIPS[animKey] || animKey;
      this.state.anim = animKey;
      if (!this.loaded || !this.mixer || !this.actions[clipName]) return;
      const next = this.actions[clipName];
      if (this.current === clipName) return;
      next.reset();
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.clampWhenFinished = !loop;
      next.fadeIn(fadeDuration);
      next.play();
      if (this.current && this.actions[this.current]) this.actions[this.current].fadeOut(fadeDuration);
      this.current = clipName;
    }

    setPosition(x, y, z) { this.state.position.set(x, y, z); this.group.position.set(x, y, z); }
    setRotationY(ry) { this.state.rotationY = ry; this.group.rotation.y = ry; }

    // ── Stats ──────────────────────────────────────
    feed() {
      this.stats.energy = Math.min(100, this.stats.energy + 25);
      this.stats.happiness = Math.min(100, this.stats.happiness + 8);
      this._addXP(4);
      this.play('eat', 0.2, false);
      setTimeout(() => this.play('idle'), 1500);
    }

    playWith() {
      this.stats.happiness = Math.min(100, this.stats.happiness + 18);
      this.stats.mood = Math.min(100, this.stats.mood + 12);
      this.stats.energy = Math.max(0, this.stats.energy - 10);
      this._addXP(6);
      this.state.mode = 'play';
      this.play('play', 0.2, false);
      setTimeout(() => { this.state.mode = 'idle'; this.play('idle'); }, 2200);
    }

    rename(newName) { this.name = newName || this.name; }

    _addXP(n) {
      this.stats.xp += n;
      this.stats.friendship = Math.min(999, this.stats.friendship + Math.round(n / 2));
      const newLevel = Math.floor(this.stats.xp / FRIENDSHIP_PER_LEVEL) + 1;
      if (newLevel > this.stats.level) {
        this.stats.level = newLevel;
        HomeUtils.toast(this.name + ' leveled up! 🎉 Level ' + newLevel, 'success');
      }
    }

    _decayStats(dt) {
      const mins = dt / 60;
      this.stats.energy    = Math.max(0, this.stats.energy    - STAT_DECAY_PER_MIN.energy    * mins);
      this.stats.happiness = Math.max(0, this.stats.happiness - STAT_DECAY_PER_MIN.happiness * mins);
      this.stats.health     = Math.max(0, this.stats.health     - STAT_DECAY_PER_MIN.health     * mins);
      this.stats.mood = Math.round((this.stats.happiness + this.stats.energy) / 2);
    }

    toJSON() {
      return {
        id: this.id, species: this.species, name: this.name, ownerRole: this.ownerRole,
        stats: this.stats,
        x: this.state.position.x, z: this.state.position.z
      };
    }

    // ── Per-frame update: AI movement hook + idle flourishes ──
    update(dt, elapsed) {
      if (this.mixer) this.mixer.update(dt);

      if (this._tail) {
        const speed = this.stats.happiness > 60 ? 6 : 2.5;
        this._tail.rotation.y = Math.sin(elapsed * speed) * 0.5;
      }
      if (this._ears) {
        const twitch = Math.sin(elapsed * 1.3 + this.id.length) * 0.05;
        this._ears.forEach(e => e.rotation.z = twitch);
      }
      const def = SPECIES_DEFAULTS[this.species] || {};
      if (def.swims && this._placeholderBody) {
        this._placeholderBody.position.y = Math.sin(elapsed * 1.5) * 0.05;
      }
      if (def.flies && this._placeholderBody) {
        this._placeholderBody.position.y = 0.15 + Math.sin(elapsed * 2.2) * 0.08;
      }

      this._decayStats(dt);
      if (aiTickHook) aiTickHook(this, dt);
    }

    dispose() {
      if (this.mixer) this.mixer.stopAllAction();
      this.group.traverse(n => {
        if (n.isMesh) {
          n.geometry && n.geometry.dispose();
          if (n.material) { Array.isArray(n.material) ? n.material.forEach(m => m.dispose()) : n.material.dispose(); }
        }
      });
    }
  }

  function _defaultName(species) {
    const names = {
      dog: ['Buddy', 'Rocky', 'Max'], cat: ['Luna', 'Milo', 'Whiskers'],
      rabbit: ['Coco', 'Snowy'], bird: ['Sky', 'Kiwi'], fish: ['Bubbles', 'Nemo']
    };
    const list = names[species] || ['Pet'];
    return list[Math.floor(Math.random() * list.length)];
  }

  // ── Adoption ───────────────────────────────────────
  async function adopt(species, name) {
    if (!SPECIES_DEFAULTS[species]) { HomeUtils.toast('Unknown species', 'error'); return null; }
    const pet = new Pet({
      species, name: name || _defaultName(species),
      ownerRole: HomeUtils.getMyRole(),
      x: 1.0 + Math.random() * 0.6, z: 1.0 + Math.random() * 0.6
    });
    pets.push(pet);
    scene.add(pet.group);
    pet.load(loader);

    const coupleId = HomeUtils.getCoupleId();
    if (coupleId) {
      try {
        const saved = await HomeAPI.pets.create({
          coupleId, species, name: pet.name, owner_role: pet.ownerRole,
          stats: pet.stats, pos_x: pet.state.position.x, pos_z: pet.state.position.z
        });
        if (saved && saved.id) pet.id = saved.id;
      } catch (e) { console.warn('[HomePets] adopt persist failed:', e.message); }
    }
    HomeUtils.toast('🎉 Welcome home, ' + pet.name + '!', 'success');
    return pet;
  }

  async function loadAll() {
    const coupleId = HomeUtils.getCoupleId();
    if (!coupleId) return;
    try {
      const list = await HomeAPI.pets.list(coupleId);
      (list || []).forEach(row => {
        const pet = new Pet({
          id: row.id, species: row.species, name: row.name, ownerRole: row.owner_role,
          stats: row.stats || {}, x: row.pos_x, z: row.pos_z
        });
        pets.push(pet);
        scene.add(pet.group);
        pet.load(loader);
      });
    } catch (e) { console.warn('[HomePets] loadAll failed:', e.message); }
  }

  function getAll() { return pets; }
  function getById(id) { return pets.find(p => p.id === id); }

  async function persist(pet) {
    const coupleId = HomeUtils.getCoupleId();
    if (!coupleId) return;
    try {
      await HomeAPI.pets.action(pet.id, {
        coupleId, name: pet.name, stats: pet.stats,
        pos_x: pet.state.position.x, pos_z: pet.state.position.z
      });
    } catch (e) { console.warn('[HomePets] persist failed:', e.message); }
  }

  // ── Init / update / dispose ─────────────────────────
  function init(threeScene) {
    scene = threeScene;
    clock = new THREE.Clock();
    loader = new THREE.GLTFLoader();
    loadAll();
  }

  function update(dt) {
    if (!clock) return;
    const elapsed = clock.getElapsedTime();
    pets.forEach(p => p.update(dt, elapsed));
  }

  function dispose() {
    pets.forEach(p => { scene.remove(p.group); p.dispose(); });
    pets.length = 0;
  }

  return {
    init, update, dispose,
    adopt, loadAll, getAll, getById, persist,
    _registerAIHook,
    SPECIES_DEFAULTS, ASSET_PATHS, ANIM_CLIPS,
    Pet
  };
})();

window.HomePets = HomePets;