// public/home/emotion_engine.js
// ════════════════════════════════════════════════
//  Emotion Engine — Phase 8
//  Reads HomeRelationshipEngine values and drives
//  per-avatar visible emotional state: floating
//  emoji indicators, mesh tint, walk animation
//  blend, idle pose selection, and facial morph
//  targets (for future GLTF avatars with blendshapes).
// ════════════════════════════════════════════════
const HomeEmotionEngine = (() => {

  // ── Emotion definitions ─────────────────────────
  const EMOTIONS = {
    blissful: {
      threshold: 80, icon: '😊', color: 0xffee88,
      walkSpeed: 1.15, idlePose: 'idle_happy', particleColor: 0xffaacc
    },
    happy: {
      threshold: 65, icon: '🙂', color: 0xffd070,
      walkSpeed: 1.05, idlePose: 'idle', particleColor: 0xffcc88
    },
    content: {
      threshold: 50, icon: '😌', color: 0xffffff,
      walkSpeed: 1.0, idlePose: 'idle', particleColor: null
    },
    neutral: {
      threshold: 35, icon: '😐', color: 0xdddddd,
      walkSpeed: 0.95, idlePose: 'idle_tired', particleColor: null
    },
    tired: {
      threshold: 20, icon: '😴', color: 0xbbbbee,
      walkSpeed: 0.75, idlePose: 'idle_tired', particleColor: null
    },
    sad: {
      threshold: 0, icon: '😢', color: 0x8899bb,
      walkSpeed: 0.65, idlePose: 'idle_sad', particleColor: 0x8899dd
    }
  };

  // ── Floating indicator sprites ──────────────────
  // We use Three.js Sprite with a canvas texture for the emoji.
  const _sprites = {}; // role → THREE.Sprite

  function _makeEmojiTexture(emoji) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.font = `${size * 0.75}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  function _getOrCreateSprite(role, scene) {
    if (_sprites[role]) return _sprites[role];
    const mat = new THREE.SpriteMaterial({
      map: _makeEmojiTexture('😊'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.5, 0.5);
    scene.add(sprite);
    _sprites[role] = sprite;
    return sprite;
  }

  // ── State ───────────────────────────────────────
  let _scene      = null;
  let _disposed   = false;
  let _phase      = 0;         // animation phase for floating sprites
  let _curEmotion = { user1: 'content', user2: 'content' };
  let _spriteTimer = { user1: 0, user2: 0 }; // countdown to hide sprite

  // ── Compute emotion from relationship values ────
  function _computeEmotion() {
    if (!window.HomeRelationshipEngine) return 'content';
    return HomeRelationshipEngine.getMoodLabel();
  }

  // ── Apply emotion to an avatar ──────────────────
  function _applyEmotion(role, emotionKey) {
    const prev = _curEmotion[role];
    if (prev === emotionKey) return;
    _curEmotion[role] = emotionKey;

    const def = EMOTIONS[emotionKey] || EMOTIONS.content;
    const avatar = window.HomeAvatars ? HomeAvatars.get(role) : null;

    // Avatar tint
    if (avatar && avatar.group) {
      avatar.group.traverse(n => {
        if (n.isMesh && n.material) {
          n.material.color && n.material.color.setHex(def.color);
        }
      });
    }

    // Show floating emoji sprite briefly
    if (_scene) {
      const sprite = _getOrCreateSprite(role, _scene);
      sprite.material.map = _makeEmojiTexture(def.icon);
      sprite.material.map.needsUpdate = true;
      sprite.material.opacity = 0.9;
      _spriteTimer[role] = 3.5; // visible for 3.5 sec
    }

    // Adjust walk speed
    if (window.HomeMovement && HomeMovement.setSpeedMultiplier) {
      HomeMovement.setSpeedMultiplier(def.walkSpeed);
    }

    // Apply idle pose if avatar is idle
    if (avatar && avatar.state && avatar.state.anim === 'idle') {
      try { avatar.play(def.idlePose || 'idle', 0.5); } catch (_) {}
    }

    // Dispatch for UI
    window.dispatchEvent(new CustomEvent('home:emotionChange', {
      detail: { role, emotion: emotionKey, icon: def.icon }
    }));
  }

  // ── Per-frame update ───────────────────────────
  function update(dt) {
    if (_disposed) return;
    _phase += dt;

    const emotion = _computeEmotion();

    // Apply to both roles
    for (const role of ['user1', 'user2']) {
      _applyEmotion(role, emotion);

      // Float and fade sprites
      const sprite = _sprites[role];
      if (sprite) {
        const avatar = window.HomeAvatars ? HomeAvatars.get(role) : null;
        if (avatar && avatar.state) {
          const p = avatar.state.position;
          sprite.position.set(p.x, p.y + 2.3 + Math.sin(_phase * 1.5 + (role === 'user2' ? 1 : 0)) * 0.08, p.z);
        }
        if (_spriteTimer[role] > 0) {
          _spriteTimer[role] -= dt;
          if (_spriteTimer[role] <= 0) {
            sprite.material.opacity = 0;
          } else if (_spriteTimer[role] < 0.8) {
            sprite.material.opacity = _spriteTimer[role] / 0.8;
          }
        }
      }
    }
  }

  // ── Show an instant emotion pop (one-off events) ──
  function showEmotion(role, emotionKey, duration = 3.0) {
    if (!_scene) return;
    const def = EMOTIONS[emotionKey] || EMOTIONS.happy;
    const sprite = _getOrCreateSprite(role, _scene);
    sprite.material.map = _makeEmojiTexture(def.icon);
    sprite.material.map.needsUpdate = true;
    sprite.material.opacity = 1.0;
    _spriteTimer[role] = duration;
  }

  function showInteractionEmotion(interactionKey) {
    const emojiMap = {
      holdHands: 'happy', hug: 'blissful', kiss: 'blissful',
      highFive: 'happy', danceTogether: 'blissful', selfie: 'happy',
      watchTV: 'content', gardenTogether: 'happy', cookTogether: 'happy'
    };
    const emotion = emojiMap[interactionKey] || 'happy';
    showEmotion('user1', emotion);
    showEmotion('user2', emotion);
  }

  function init(threeScene) {
    _scene = threeScene;
    _disposed = false;

    window.addEventListener('home:interactionTriggered', e => {
      if (e.detail) showInteractionEmotion(e.detail.key);
    });
  }

  function dispose() {
    _disposed = true;
    Object.values(_sprites).forEach(s => {
      if (_scene) _scene.remove(s);
      if (s.material.map) s.material.map.dispose();
      s.material.dispose();
    });
    Object.keys(_sprites).forEach(k => delete _sprites[k]);
    _scene = null;
  }

  return { init, update, dispose, showEmotion, showInteractionEmotion, EMOTIONS };
})();

window.HomeEmotionEngine = HomeEmotionEngine;
