// public/home/perf_living.js
// ════════════════════════════════════════════════
//  Performance — Phase 6, Feature 10
//  GLTF/animation optimization helpers, lazy loading
//  gate, LOD, GPU instancing helper, mobile throttling,
//  adaptive quality to hold 60 FPS.
//  NEW MODULE — does not modify rooms/furniture/memories.
// ════════════════════════════════════════════════
const HomePerfLiving = (() => {

  let renderer = null;
  let fpsHistory = [];
  let qualityTier = 'high'; // 'high' | 'medium' | 'low'
  let isMobile = false;

  const FPS_SAMPLE_WINDOW = 90; // frames (~1.5s at 60fps)
  const FPS_DOWNGRADE_THRESHOLD = 42;
  const FPS_UPGRADE_THRESHOLD   = 56;

  // ── Mobile detection ────────────────────────────────
  function _detectMobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 1 && window.innerWidth < 900);
  }

  // ── Lazy loading gate ───────────────────────────────
  // Avatars/pets only fully GLTF-load once the Living World camera
  // distance is within range, OR immediately if already close. This
  // mainly matters once real (heavier) GLTF assets replace the
  // placeholders — keeps initial load light on mobile.
  function shouldEagerLoad() {
    return !isMobile || qualityTier !== 'low';
  }

  // ── LOD: swap detail level by camera distance ──────
  // Operates on avatar/pet placeholder geometry segment counts —
  // for real GLTF meshes, this instead toggles between a provided
  // `mesh.userData.lodHigh` / `lodLow` pair if present (convention
  // for future asset authors to follow; optional).
  function applyLOD(object3D, cameraPos) {
    if (!object3D) return;
    const dist = object3D.position.distanceTo(cameraPos);
    const near = dist < 4;
    object3D.traverse(n => {
      if (n.isMesh && n.userData && n.userData.lodHigh && n.userData.lodLow) {
        n.userData.lodHigh.visible = near;
        n.userData.lodLow.visible  = !near;
      }
      // Shadow casting is the most expensive part on mobile — drop it
      // for far-away or low-tier-quality objects rather than swapping
      // geometry (placeholders have no separate LOD meshes).
      if (n.isMesh) {
        n.castShadow = near && qualityTier !== 'low';
      }
    });
  }

  // ── GPU instancing helper ───────────────────────────
  // For scenes with many identical small objects (e.g. a flock of
  // birds, multiple toy props), build an InstancedMesh instead of N
  // separate meshes. Exposed as a utility for pets.js/interactions.js
  // to opt into later without this module needing to own pet creation.
  function buildInstancedMesh(geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = qualityTier === 'high';
    mesh.receiveShadow = qualityTier === 'high';
    return mesh;
  }

  function setInstanceTransform(instancedMesh, index, position, rotationY, scale = 1) {
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
    m.compose(position, quat, new THREE.Vector3(scale, scale, scale));
    instancedMesh.setMatrixAt(index, m);
    instancedMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Texture compression hints ──────────────────────
  // Three.js doesn't compress textures at runtime from plain images —
  // real compression (KTX2/Basis) needs build-time processing. This
  // helper at least applies sane runtime settings (mipmaps, anisotropy
  // cap, sRGB) so whatever textures load aren't needlessly heavy, and
  // documents the recommended pipeline for when real assets arrive.
  function optimizeTexture(texture, maxAnisotropy = 4) {
    if (!texture) return texture;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    if (renderer) {
      texture.anisotropy = Math.min(maxAnisotropy, renderer.capabilities.getMaxAnisotropy());
    }
    // For production with real assets: pre-convert textures to KTX2
    // (Basis Universal) via the glTF-Transform CLI or Blender export
    // settings, then load with THREE.KTX2Loader instead of raw PNG/JPG.
    return texture;
  }

  // ── Animation optimization ─────────────────────────
  // Stops AnimationMixers for avatars/pets that are far outside the
  // camera frustum or very far away, since mixer.update() cost scales
  // with active actions even when invisible.
  function shouldUpdateMixer(object3D, cameraPos, maxDist = 14) {
    return object3D.position.distanceTo(cameraPos) <= maxDist;
  }

  // ── Adaptive quality scaling ────────────────────────
  function _recordFrame(dt) {
    const fps = dt > 0 ? (1 / dt) : 60;
    fpsHistory.push(fps);
    if (fpsHistory.length > FPS_SAMPLE_WINDOW) fpsHistory.shift();
  }

  function _avgFps() {
    if (!fpsHistory.length) return 60;
    return fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
  }

  function _maybeAdjustQuality() {
    if (fpsHistory.length < FPS_SAMPLE_WINDOW) return;
    const avg = _avgFps();
    if (avg < FPS_DOWNGRADE_THRESHOLD && qualityTier !== 'low') {
      qualityTier = qualityTier === 'high' ? 'medium' : 'low';
      _applyQualityTier();
      fpsHistory = [];
    } else if (avg > FPS_UPGRADE_THRESHOLD && qualityTier !== 'high' && !isMobile) {
      qualityTier = qualityTier === 'low' ? 'medium' : 'high';
      _applyQualityTier();
      fpsHistory = [];
    }
  }

  function _applyQualityTier() {
    if (!renderer) return;
    if (qualityTier === 'low') {
      renderer.shadowMap.enabled = false;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    } else if (qualityTier === 'medium') {
      renderer.shadowMap.enabled = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    } else {
      renderer.shadowMap.enabled = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    console.info('[HomePerfLiving] Quality tier:', qualityTier);
  }

  // ── Init / update ───────────────────────────────────
  function init(threeRenderer) {
    renderer = threeRenderer;
    isMobile = _detectMobile();
    if (isMobile) {
      qualityTier = 'medium';
      _applyQualityTier();
    }
  }

  // Called once per frame from scene.js loop alongside other update()s.
  // Cheap by design — this is the thing that must never become the
  // bottleneck it's trying to prevent.
  function update(dt) {
    _recordFrame(dt);
    _maybeAdjustQuality();
  }

  function getQualityTier() { return qualityTier; }
  function getIsMobile() { return isMobile; }
  function getAvgFps() { return Math.round(_avgFps()); }

  function dispose() { fpsHistory = []; }

  return {
    init, update, dispose,
    shouldEagerLoad, applyLOD,
    buildInstancedMesh, setInstanceTransform,
    optimizeTexture, shouldUpdateMixer,
    getQualityTier, getIsMobile, getAvgFps
  };
})();

window.HomePerfLiving = HomePerfLiving;