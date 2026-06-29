// public/home/renderer.js
// ════════════════════════════════════════════════
//  Renderer — WebGLRenderer setup & resize handler
// ════════════════════════════════════════════════
const HomeRenderer = (() => {

  let renderer = null;
  let canvas   = null;

  function init(canvasEl) {
    canvas = canvasEl;

    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias:   true,
      alpha:       false,
      powerPreference: 'high-performance'
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Physically correct lighting model
    renderer.useLegacyLights = false;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    // Tone mapping for warm interior feel
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace    = THREE.SRGBColorSpace;

    // Resize handler
    window.addEventListener('resize', onResize);

    return renderer;
  }

  function onResize() {
    if (!renderer) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Camera is updated by camera module via event
    window.dispatchEvent(new Event('home:resize'));
  }

  function get()    { return renderer; }
  function getCanvas() { return canvas; }

  function setExposure(v) {
    if (renderer) renderer.toneMappingExposure = v;
  }

  function dispose() {
    window.removeEventListener('resize', onResize);
    if (renderer) { renderer.dispose(); renderer = null; }
  }

  return { init, get, getCanvas, setExposure, dispose };
})();

window.HomeRenderer = HomeRenderer;
