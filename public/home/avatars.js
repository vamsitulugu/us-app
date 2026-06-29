// public/home/avatars.js
// ════════════════════════════════════════════════
//  Avatars — Phase 6, Feature 1 + 8
//  Couple avatars: GLTF load, customization, animation
//  blending, idle breathing, head/eye/hand tracking.
//  NEW MODULE — does not modify rooms/furniture/memories.
// ════════════════════════════════════════════════
const HomeAvatars = (() => {

  let scene   = null;
  let loader  = null;
  let clock   = null;

  // Two avatar instances keyed by role
  const avatars = { user1: null, user2: null };

  // ── Placeholder asset paths ──────────────────────
  // Swap these for real Mixamo / ReadyPlayerMe exports later.
  // Expected GLTF layout: single skinned mesh with named
  // animation clips matching ANIM_CLIPS below.
  const ASSET_PATHS = {
    male:   '/home/assets/avatars/male_base.glb',
    female: '/home/assets/avatars/female_base.glb'
  };

  // Animation clip names expected inside each GLTF
  const ANIM_CLIPS = {
    idle:     'Idle',
    idleVar:  'IdleBreathing',
    walk:     'Walk',
    run:      'Run',
    sit:      'Sit',
    standUp:  'StandUp',
    sleep:    'Sleep',
    wave:     'Wave',
    dance:    'Dance',
    jump:     'Jump',
    turn:     'Turn',
    lookAround: 'LookAround',
    hug:      'Hug',
    kiss:     'Kiss',
    highFive: 'HighFive'
  };

  // Default customization options (placeholder swatches —
  // real implementation would swap material/texture maps
  // or morph targets once real GLTF assets are in place)
  const CUSTOMIZATION_DEFAULTS = {
    hair:   { style: 'short', color: 0x3b2417 },
    face:   { preset: 'default' },
    skin:   { tone: 0xd9a874 },
    outfit: { top: 'casual_tee', bottom: 'jeans', color: 0x4477aa },
    accessories: [], // e.g. ['glasses', 'watch']
    height: 1.0       // uniform scale multiplier (0.9–1.1 typical)
  };

  // ── Avatar wrapper class ─────────────────────────
  class Avatar {
    constructor(role, gender, customization) {
      this.role     = role;                  // 'user1' | 'user2'
      this.gender   = gender;                // 'male' | 'female'
      this.custom   = Object.assign({}, CUSTOMIZATION_DEFAULTS, customization || {});
      this.group    = new THREE.Group();
      this.group.name = 'avatar_' + role;
      this.mesh     = null;                  // populated after GLTF load
      this.mixer    = null;
      this.actions  = {};                    // name -> AnimationAction
      this.current  = null;                  // currently playing action name
      this.loaded   = false;

      // Movement-facing state (read/written by movement.js)
      this.state = {
        position:  new THREE.Vector3(0, 0, 0),
        rotationY: 0,
        velocity:  new THREE.Vector3(0, 0, 0),
        anim:      'idle',
        sitting:   false,
        sleeping:  false
      };

      // Head/eye/hand tracking targets (world space)
      this.lookTarget  = new THREE.Vector3(0, 1.5, 5);
      this.headBone    = null;
      this.eyeBones    = [];
      this.handBones    = { left: null, right: null };

      // Idle breathing phase offset so two avatars don't sync identically
      this._breathPhase = Math.random() * Math.PI * 2;

      // Placeholder mesh (visible immediately, replaced on GLTF load)
      this._buildPlaceholder();
    }

    _buildPlaceholder() {
      // Simple capsule-ish placeholder so the world isn't empty
      // while the real GLTF loads (or if it 404s, since paths
      // are placeholders per current setup).
      const skinColor = this.custom.skin.tone;
      const outfitColor = this.custom.outfit.color;

      const body = new THREE.Group();

      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.22, 0.55, 4, 8),
        new THREE.MeshStandardMaterial({ color: outfitColor, roughness: 0.85 })
      );
      torso.position.y = 1.05;
      torso.castShadow = true;
      body.add(torso);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 16, 16),
        new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.7 })
      );
      head.position.y = 1.55;
      head.castShadow = true;
      head.name = 'placeholder_head';
      body.add(head);
      this.headBone = head; // until real GLTF replaces it

      const legGeo = new THREE.CapsuleGeometry(0.09, 0.5, 4, 8);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.9 });
      const legL = new THREE.Mesh(legGeo, legMat); legL.position.set(-0.11, 0.45, 0); legL.castShadow = true;
      const legR = new THREE.Mesh(legGeo, legMat); legR.position.set( 0.11, 0.45, 0); legR.castShadow = true;
      body.add(legL, legR);

      body.scale.setScalar(this.custom.height || 1.0);
      this.group.add(body);
      this._placeholderBody = body;
    }

    // Load the real GLTF, replacing the placeholder on success.
    // Falls back to placeholder silently on error (expected,
    // since ASSET_PATHS are placeholders for now).
    async load(gltfLoader) {
      const path = ASSET_PATHS[this.gender] || ASSET_PATHS.male;
      return new Promise((resolve) => {
        gltfLoader.load(
          path,
          (gltf) => {
            // Remove placeholder
            if (this._placeholderBody) {
              this.group.remove(this._placeholderBody);
              this._disposePlaceholder();
            }
            this.mesh = gltf.scene;
            this.mesh.scale.setScalar(this.custom.height || 1.0);
            this.mesh.traverse(n => {
              if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
              if (n.isBone) {
                const nameLower = (n.name || '').toLowerCase();
                if (nameLower.includes('head')) this.headBone = n;
                if (nameLower.includes('eye'))  this.eyeBones.push(n);
                if (nameLower.includes('hand_l') || nameLower.includes('lefthand'))  this.handBones.left  = n;
                if (nameLower.includes('hand_r') || nameLower.includes('righthand')) this.handBones.right = n;
              }
            });
            this.group.add(this.mesh);

            // Animation mixer + clips
            this.mixer = new THREE.AnimationMixer(this.mesh);
            (gltf.animations || []).forEach(clip => {
              this.actions[clip.name] = this.mixer.clipAction(clip);
            });
            this.loaded = true;
            this.play('idle', 0);
            resolve(true);
          },
          undefined,
          () => {
            // Expected for now — ASSET_PATHS are placeholders.
            // Keep the procedural placeholder mesh visible.
            console.warn('[HomeAvatars] GLTF not found at', path, '— using placeholder geometry. Replace ASSET_PATHS with real model files when ready.');
            resolve(false);
          }
        );
      });
    }

    _disposePlaceholder() {
      this._placeholderBody.traverse(n => {
        if (n.isMesh) { n.geometry.dispose(); n.material.dispose(); }
      });
      this._placeholderBody = null;
    }

    // ── Animation playback with smooth blending ────
    play(animKey, fadeDuration = 0.35, loop = true) {
      const clipName = ANIM_CLIPS[animKey] || animKey;
      this.state.anim = animKey;

      if (!this.loaded || !this.mixer || !this.actions[clipName]) {
        // Placeholder mode: no mixer, just track state for movement/IK logic
        return;
      }
      const next = this.actions[clipName];
      const prevName = this.current;
      if (prevName === clipName) return;

      next.reset();
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.clampWhenFinished = !loop;
      next.fadeIn(fadeDuration);
      next.play();

      if (prevName && this.actions[prevName]) {
        this.actions[prevName].fadeOut(fadeDuration);
      }
      this.current = clipName;
    }

    // One-shot gesture (wave, jump, etc.) that returns to idle after
    playOnce(animKey, onDone) {
      this.play(animKey, 0.2, false);
      const clipName = ANIM_CLIPS[animKey] || animKey;
      if (this.loaded && this.mixer && this.actions[clipName]) {
        const dur = (this.actions[clipName].getClip().duration || 1) * 1000;
        setTimeout(() => {
          this.play(this.state.sitting ? 'sit' : (this.state.sleeping ? 'sleep' : 'idle'), 0.3);
          if (onDone) onDone();
        }, dur);
      } else {
        // Placeholder fallback timing
        setTimeout(() => { if (onDone) onDone(); }, 900);
      }
    }

    setLookTarget(v3) { this.lookTarget.copy(v3); }

    setPosition(x, y, z) {
      this.state.position.set(x, y, z);
      this.group.position.set(x, y, z);
    }

    setRotationY(ry) {
      this.state.rotationY = ry;
      this.group.rotation.y = ry;
    }

    applyCustomization(partial) {
      Object.assign(this.custom, partial || {});
      // Live re-tint of placeholder if GLTF hasn't loaded yet
      if (!this.loaded && this._placeholderBody) {
        this._placeholderBody.traverse(n => {
          if (n.name === 'placeholder_head' && partial && partial.skin) {
            n.material.color.setHex(partial.skin.tone);
          }
        });
        if (partial && partial.outfit && partial.outfit.color !== undefined) {
          this._placeholderBody.children[0].material.color.setHex(partial.outfit.color);
        }
        if (partial && partial.height) {
          this._placeholderBody.scale.setScalar(partial.height);
        }
      } else if (this.mesh && partial && partial.height) {
        this.mesh.scale.setScalar(partial.height);
      }
    }

    // ── Per-frame update: breathing, head/eye tracking, mixer ──
    update(dt, elapsed) {
      if (this.mixer) this.mixer.update(dt);

      // Idle breathing — subtle vertical bob when truly idle
      if (this.state.anim === 'idle' || this.state.anim === 'sit') {
        const breathe = Math.sin(elapsed * 1.6 + this._breathPhase) * 0.006;
        if (this.headBone) this.headBone.position.y += 0; // reserved hook; real bone breathing handled by GLTF clip "IdleBreathing" when present
        if (this._placeholderBody) this._placeholderBody.position.y = breathe;
      } else if (this._placeholderBody) {
        this._placeholderBody.position.y = 0;
      }

      // Head tracking toward lookTarget (placeholder head only —
      // real GLTF rigs should use a bone-based IK solver instead)
      if (this.headBone && this.headBone.name === 'placeholder_head') {
        const worldPos = new THREE.Vector3();
        this.group.getWorldPosition(worldPos);
        const dir = this.lookTarget.clone().sub(worldPos);
        const targetYaw = Math.atan2(dir.x, dir.z) - this.group.rotation.y;
        // Clamp so the head doesn't spin unnaturally
        const clamped = HomeUtils.clamp(targetYaw, -0.6, 0.6);
        this.headBone.rotation.y = HomeUtils.lerp(this.headBone.rotation.y, clamped, 0.08);
      }

      // Eye movement — only meaningful once real GLTF rigs supply
      // eye bones; placeholder geometry has none, so this is a no-op
      // until ASSET_PATHS point at real models with named eye bones.
      if (this.eyeBones && this.eyeBones.length) {
        const worldPos = new THREE.Vector3();
        this.group.getWorldPosition(worldPos);
        const dir = this.lookTarget.clone().sub(worldPos).normalize();
        // Small saccade-like jitter so eyes don't look robotically locked
        const jitterX = Math.sin(elapsed * 2.3 + this._breathPhase) * 0.02;
        const jitterY = Math.cos(elapsed * 1.7 + this._breathPhase) * 0.015;
        this.eyeBones.forEach(eye => {
          const targetYaw   = HomeUtils.clamp(Math.atan2(dir.x, dir.z) - this.group.rotation.y, -0.35, 0.35) + jitterX;
          const targetPitch = HomeUtils.clamp(Math.asin(HomeUtils.clamp(dir.y, -1, 1)), -0.25, 0.25) + jitterY;
          eye.rotation.y = HomeUtils.lerp(eye.rotation.y, targetYaw, 0.15);
          eye.rotation.x = HomeUtils.lerp(eye.rotation.x, targetPitch, 0.15);
        });
      }

      // Hand movement — subtle idle sway on real rigs (placeholder
      // capsule body has no separate hand meshes, so this only takes
      // effect once GLTF hand bones are populated by load()). Gives
      // a relaxed, non-frozen look during idle/sit instead of stiff
      // T-pose-adjacent arms when a GLTF lacks a dedicated idle clip.
      if ((this.state.anim === 'idle' || this.state.anim === 'sit') &&
          (this.handBones.left || this.handBones.right)) {
        const swayL = Math.sin(elapsed * 1.1 + this._breathPhase) * 0.04;
        const swayR = Math.sin(elapsed * 1.1 + this._breathPhase + Math.PI) * 0.04;
        if (this.handBones.left)  this.handBones.left.rotation.z  = HomeUtils.lerp(this.handBones.left.rotation.z,  swayL, 0.1);
        if (this.handBones.right) this.handBones.right.rotation.z = HomeUtils.lerp(this.handBones.right.rotation.z, swayR, 0.1);
      }

      // Wave gesture gets an extra hand-raise flourish layered on top
      // of whatever the GLTF "Wave" clip itself does, so even a sparse
      // clip (rotation-only, no fingers) still reads as a clear wave.
      if (this.state.anim === 'wave' && this.handBones.right) {
        const waveAmt = Math.sin(elapsed * 9) * 0.18;
        this.handBones.right.rotation.x = HomeUtils.lerp(this.handBones.right.rotation.x, -0.9 + waveAmt, 0.3);
      }
    }

    dispose() {
      if (this.mixer) this.mixer.stopAllAction();
      this.group.traverse(n => {
        if (n.isMesh) {
          n.geometry && n.geometry.dispose();
          if (n.material) {
            if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
            else n.material.dispose();
          }
        }
      });
    }
  }

  // ── Module init ───────────────────────────────────
  function init(threeScene) {
    scene = threeScene;
    clock = new THREE.Clock();
    loader = new THREE.GLTFLoader();

    // Spawn positions: side-by-side near living room center.
    // movement.js will reposition based on saved state / nav.
    const myRole      = HomeUtils.getMyRole();
    const partnerRole = myRole === 'user1' ? 'user2' : 'user1';

    avatars.user1 = new Avatar('user1', 'male',   {});
    avatars.user2 = new Avatar('user2', 'female', {});

    avatars.user1.setPosition(-0.6, 0, 2.5);
    avatars.user2.setPosition( 0.6, 0, 2.5);

    scene.add(avatars.user1.group);
    scene.add(avatars.user2.group);

    // Kick off async GLTF loads (no-op fallback to placeholder if 404)
    avatars.user1.load(loader);
    avatars.user2.load(loader);

    return avatars;
  }

  function get(role) { return avatars[role]; }
  function getMine()  { return avatars[HomeUtils.getMyRole()]; }
  function getPartner() {
    const myRole = HomeUtils.getMyRole();
    return avatars[myRole === 'user1' ? 'user2' : 'user1'];
  }
  function all() { return avatars; }

  // ── Customization API (persists via HomeAPI.settings) ──
  async function saveCustomization(role) {
    const av = avatars[role];
    if (!av) return;
    const coupleId = HomeUtils.getCoupleId();
    if (!coupleId) return;
    try {
      await HomeAPI.settings.save(coupleId, {
        ['avatar_custom_' + role]: JSON.stringify(av.custom)
      });
    } catch (e) {
      console.warn('[HomeAvatars] saveCustomization failed:', e.message);
    }
  }

  async function loadCustomization() {
    const coupleId = HomeUtils.getCoupleId();
    if (!coupleId) return;
    try {
      const settings = await HomeAPI.settings.get(coupleId);
      ['user1', 'user2'].forEach(role => {
        const raw = settings && settings['avatar_custom_' + role];
        if (raw && avatars[role]) {
          try { avatars[role].applyCustomization(JSON.parse(raw)); } catch (_) {}
        }
      });
    } catch (e) {
      console.warn('[HomeAvatars] loadCustomization failed:', e.message);
    }
  }

  // ── Per-frame update (called from scene.js loop) ──
  function update(dt) {
    const elapsed = clock.getElapsedTime();
    if (avatars.user1) avatars.user1.update(dt, elapsed);
    if (avatars.user2) avatars.user2.update(dt, elapsed);
  }

  function dispose() {
    Object.values(avatars).forEach(av => { if (av) { scene.remove(av.group); av.dispose(); } });
    avatars.user1 = null; avatars.user2 = null;
  }

  return {
    init, get, getMine, getPartner, all,
    saveCustomization, loadCustomization,
    update, dispose,
    ASSET_PATHS, ANIM_CLIPS, CUSTOMIZATION_DEFAULTS,
    Avatar // exported for movement.js / interactions.js type-checking if needed
  };
})();

window.HomeAvatars = HomeAvatars;