/* ════════════════════════════════════════════════════════════════
   Twin Hearts — Image Editor (Android app style)
   Features: Crop (freeform + aspect ratios), Rotate, Zoom, Filters
   Load via: <script src="/js/image-editor.js"></script>
   Usage:    ImageEditor.open({ src, onSave: (blob) => {...} })
 ═════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  const MODAL_ID = 'th-image-editor-modal';
  const STYLE_ID = 'th-image-editor-styles';

  // Default aspect ratios for crop presets
  const ASPECT_RATIOS = [
    { label: 'Free',   w: 0, h: 0 },
    { label: '1:1',    w: 1, h: 1 },
    { label: '4:3',    w: 4, h: 3 },
    { label: '3:4',    w: 3, h: 4 },
    { label: '16:9',   w: 16, h: 9 },
    { label: '9:16',   w: 9, h: 16 },
  ];

  let editorState = {
    img: null,          // HTMLImageElement (source)
    canvas: null,       // offscreen canvas for rendering
    ctx: null,
    displayW: 0, displayH: 0, // canvas display size
    imgW: 0, imgH: 0,   // natural image size
    scale: 1,           // current zoom scale (1 = fit)
    offsetX: 0, offsetY: 0, // pan offset
    rotation: 0,        // degrees
    cropMode: false,
    cropRect: null,     // {x, y, w, h} in canvas coordinate space
    aspectIdx: 0,       // index into ASPECT_RATIOS
    filterBrightness: 100,
    filterContrast: 100,
    filterSaturation: 100,
    filterBlur: 0,
    dragging: false,
    dragStartX: 0, dragStartY: 0,
    lastOffsetX: 0, lastOffsetY: 0,
    isMobile: false,
    onSave: null,
  };

  /* ── inject styles ─────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID} {
        position: fixed; inset: 0; z-index: 2147483646;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.9); backdrop-filter: blur(8px);
        opacity: 0; pointer-events: none; transition: opacity .25s ease;
        padding: 24px;
      }
      #${MODAL_ID}.open { opacity: 1; pointer-events: auto; }
      #${MODAL_ID} .th-ied-backdrop {
        position: absolute; inset: 0; background: rgba(0,0,0,0.6);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      }
      #${MODAL_ID} .th-ied-shell {
        position: relative; z-index: 2;
        width: 100%; max-width: 100vw; max-height: 100vh;
        display: flex; flex-direction: column;
      }

      /* Header */
      #${MODAL_ID} .th-ied-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 20px; background: rgba(255,255,255,0.08);
        backdrop-filter: blur(16px); border-bottom: 1px solid rgba(255,255,255,0.12);
        flex-shrink: 0;
      }
      #${MODAL_ID} .th-ied-title { color: #fff; font-size: 16px; font-weight: 600; margin: 0; font-family: 'Inter', system-ui, sans-serif; }
      #${MODAL_ID} .th-ied-btn-close,
      #${MODAL_ID} .th-ied-btn-cancel {
        background: none; border: none; color: rgba(255,255,255,0.8);
        font-size: 20px; cursor: pointer; padding: 6px 10px; border-radius: 8px;
      }
      #${MODAL_ID} .th-ied-btn-close:hover,
      #${MODAL_ID} .th-ied-btn-cancel:hover { background: rgba(255,255,255,0.15); color: #fff; }

      /* Canvas area */
      #${MODAL_ID} .th-ied-canvas-wrap {
        flex: 1; position: relative; overflow: hidden;
        background: #000; display: flex; align-items: center; justify-content: center;
        cursor: move;
      }
      #${MODAL_ID} .th-ied-canvas-wrap img {
        max-width: 100%; max-height: 100%; display: block;
      }
      #${MODAL_ID} .th-ied-overlay {
        position: absolute; inset: 0; pointer-events: none;
      }
      #${MODAL_ID} .th-ied-crop-box {
        position: absolute; border: 2px solid #fff; background: rgba(255,255,255,0.25);
        box-sizing: border-box; pointer-events: none;
      }
      #${MODAL_ID} .th-ied-crop-handle {
        position: absolute; width: 20px; height: 20px; background: #fff; border-radius: 4px;
        pointer-events: auto; z-index: 10;
      }
      #${MODAL_ID} .th-ied-handle-nw { top: -10px; left: -10px; cursor: nwse-resize; }
      #${MODAL_ID} .th-ied-handle-ne { top: -10px; right: -10px; cursor: nesw-resize; }
      #${MODAL_ID} .th-ied-handle-sw { bottom: -10px; left: -10px; cursor: nesw-resize; }
      #${MODAL_ID} .th-ied-handle-se { bottom: -10px; right: -10px; cursor: nwse-resize; }
      #${MODAL_ID} .th-ied-handle-n  { top: -10px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
      #${MODAL_ID} .th-ied-handle-s  { bottom: -10px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
      #${MODAL_ID} .th-ied-handle-w  { left: -10px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
      #${MODAL_ID} .th-ied-handle-e  { right: -10px; top: 50%; transform: translateY(-50%); cursor: ew-resize; }
      #${MODAL_ID} .th-ied-grid-line {
        position: absolute; background: rgba(255,255,255,0.4); pointer-events: none;
      }
      #${MODAL_ID} .th-ied-grid-line.v { width: 1px; top: 0; bottom: 0; }
      #${MODAL_ID} .th-ied-grid-line.h { height: 1px; left: 0; right: 0; }

      /* Controls */
      #${MODAL_ID} .th-ied-controls {
        display: flex; flex-direction: column; gap: 10px;
        padding: 16px 20px; background: rgba(255,255,255,0.06);
        backdrop-filter: blur(16px); border-top: 1px solid rgba(255,255,255,0.12);
        flex-shrink: 0;
      }
      #${MODAL_ID} .th-ied-tabs {
        display: flex; gap: 6px; overflow-x: auto; margin-bottom: 8px;
      }
      #${MODAL_ID} .th-ied-tab {
        flex-shrink: 0; padding: 6px 14px; border-radius: 20px;
        border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.8); font-size: 12px; font-weight: 600;
        cursor: pointer; transition: all .2s;
        font-family: 'Inter', system-ui, sans-serif;
      }
      #${MODAL_ID} .th-ied-tab.active {
        background: #fff; color: #000; border-color: #fff;
      }
      #${MODAL_ID} .th-ied-tab:not(.active):hover {
        background: rgba(255,255,255,0.15); color: #fff;
      }

      /* Crop ratio row */
      #${MODAL_ID} .th-ied-ratios {
        display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px;
        margin-bottom: 8px;
      }
      #${MODAL_ID} .th-ied-ratio {
        flex-shrink: 0; padding: 6px 12px; border-radius: 20px;
        border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05);
        color: rgba(255,255,255,0.8); font-size: 12px; cursor: pointer;
        transition: all .2s;
      }
      #${MODAL_ID} .th-ied-ratio.active {
        background: #fff; color: #000; border-color: #fff;
      }

      /* Slider */
      #${MODAL_ID} .th-ied-slider-row {
        display: flex; align-items: center; gap: 10px; margin-bottom: 4px;
      }
      #${MODAL_ID} .th-ied-slider-label {
        color: rgba(255,255,255,0.8); font-size: 12px; min-width: 80px;
        font-family: 'Inter', system-ui, sans-serif;
      }
      #${MODAL_ID} .th-ied-slider-value {
        color: #fff; font-size: 12px; font-weight: 600; min-width: 32px;
        font-family: 'Inter', system-ui, sans-serif;
      }
      #${MODAL_ID} input[type=range] {
        flex: 1; accent-color: #fff; height: 6px;
      }

      /* Rotate buttons */
      #${MODAL_ID} .th-ied-rotate-row {
        display: flex; gap: 8px; justify-content: center; margin-bottom: 6px;
      }
      #${MODAL_ID} .th-ied-btn-rotate {
        flex: 1; padding: 8px 14px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08);
        color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
        transition: all .2s; font-family: 'Inter', system-ui, sans-serif;
      }
      #${MODAL_ID} .th-ied-btn-rotate:hover { background: rgba(255,255,255,0.18); }

      /* Action buttons */
      #${MODAL_ID} .th-ied-actions {
        display: flex; gap: 10px; justify-content: flex-end;
        padding: 14px 20px; background: rgba(255,255,255,0.06);
        backdrop-filter: blur(16px); border-top: 1px solid rgba(255,255,255,0.12);
        flex-shrink: 0;
      }
      #${MODAL_ID} .th-ied-btn-save {
        padding: 12px 24px; border-radius: 12px;
        background: linear-gradient(135deg, hsl(322,100%,62%), hsl(322,95%,50%));
        color: #fff; border: none; font-size: 14px; font-weight: 700;
        cursor: pointer; box-shadow: 0 6px 20px hsla(322,100%,62%,0.35);
        transition: all .2s; font-family: 'Inter', system-ui, sans-serif;
      }
      #${MODAL_ID} .th-ied-btn-save:hover { filter: brightness(1.1); transform: translateY(-1px); }
      #${MODAL_ID} .th-ied-btn-save:active { transform: scale(.97); }
      #${MODAL_ID} .th-ied-btn-reset {
        padding: 12px 20px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05);
        color: #fff; font-size: 14px; font-weight: 600; cursor: pointer;
        transition: all .2s; font-family: 'Inter', system-ui, sans-serif;
        margin-right: auto;
      }
      #${MODAL_ID} .th-ied-btn-reset:hover { background: rgba(255,255,255,0.12); }

      #${MODAL_ID} .th-ied-btn-crop {
        padding: 12px 20px; border-radius: 12px;
        background: linear-gradient(135deg, hsl(322,100%,62%), hsl(322,95%,50%));
        color: #fff; border: none; font-size: 14px; font-weight: 700;
        cursor: pointer; box-shadow: 0 6px 20px hsla(322,100%,62%,0.35);
        transition: all .2s; font-family: 'Inter', system-ui, sans-serif;
      }
      #${MODAL_ID} .th-ied-btn-crop:hover { filter: brightness(1.1); transform: translateY(-1px); }

      /* Mobile adjustments */
      @media (max-width: 600px) {
        #${MODAL_ID} { padding: 8px; }
        #${MODAL_ID} .th-ied-controls { padding: 12px 16px; }
        #${MODAL_ID} .th-ied-actions { padding: 10px 16px; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ── build modal HTML ──────────────────────────────────────── */
  function buildModal() {
    if (document.getElementById(MODAL_ID)) return;
    injectStyles();

    const ratioButtons = ASPECT_RATIOS.map((r, i) =>
      `<button class="th-ied-ratio${i === 0 ? ' active' : ''}" data-ratio="${i}">${r.label}</button>`
    ).join('');

    const html = `
      <div class="th-ied-backdrop" onclick="window.ImageEditor && window.ImageEditor.close()"></div>
      <div class="th-ied-shell" role="dialog" aria-modal="true" aria-label="Edit Image">
        <div class="th-ied-header">
          <h2 class="th-ied-title">Edit Image</h2>
          <button class="th-ied-btn-close" onclick="window.ImageEditor && window.ImageEditor.close()">✕</button>
        </div>

        <div class="th-ied-canvas-wrap" id="thIedCanvasWrap">
          <div class="th-ied-overlay" id="thIedOverlay"></div>
          <img id="thIedImg" src="" style="display:none">
          <canvas id="thIedCanvas"></canvas>
          <div class="th-ied-crop-box th-hidden" id="thIedCropBox"></div>
          ${ASPECT_RATIOS.map((r, i) =>
            `<div class="th-ied-crop-handle th-ied-handle-${['nw','ne','sw','se','n','s','w','e'][i%8]}" data-handle="${['nw','ne','sw','se','n','s','w','e'][i%8]}"></div>`
          ).join('')}
          <div class="th-ied-grid-line th-hidden" id="thIedGridV1"></div>
          <div class="th-ied-grid-line th-hidden" id="thIedGridV2"></div>
          <div class="th-ied-grid-line th-hidden" id="thIedGridH1"></div>
          <div class="th-ied-grid-line th-hidden" id="thIedGridH2"></div>
        </div>

        <div class="th-ied-controls">
          <div class="th-ied-tabs">
            <button class="th-ied-tab active" data-tab="adjust">Adjust</button>
            <button class="th-ied-tab" data-tab="crop">Crop</button>
            <button class="th-ied-tab" data-tab="filter">Filter</button>
          </div>

          <!-- Adjust tab -->
          <div class="th-ied-tab-content" id="thIedTabAdjust">
            <div class="th-ied-rotate-row">
              <button class="th-ied-btn-rotate" onclick="window.ImageEditor && window.ImageEditor.rotate(-90)">↻ -90°</button>
              <button class="th-ied-btn-rotate" onclick="window.ImageEditor && window.ImageEditor.rotate(90)">90° ↺</button>
            </div>
          </div>

          <!-- Crop tab -->
          <div class="th-ied-tab-content th-hidden" id="thIedTabCrop">
            <div class="th-ied-ratios">${ratioButtons}</div>
            <p style="font-size:11px;color:rgba(255,255,255,0.6);margin:0 0 8px">Drag corners to resize, drag inside to move</p>
          </div>

          <!-- Filter tab -->
          <div class="th-ied-tab-content th-hidden" id="thIedTabFilter">
            <div class="th-ied-slider-row">
              <span class="th-ied-slider-label">Brightness</span>
              <input type="range" id="thIedFilterBrightness" min="0" max="200" value="100">
              <span class="th-ied-slider-value" id="thIedValBrightness">100%</span>
            </div>
            <div class="th-ied-slider-row">
              <span class="th-ied-slider-label">Contrast</span>
              <input type="range" id="thIedFilterContrast" min="0" max="200" value="100">
              <span class="th-ied-slider-value" id="thIedValContrast">100%</span>
            </div>
            <div class="th-ied-slider-row">
              <span class="th-ied-slider-label">Saturation</span>
              <input type="range" id="thIedFilterSaturation" min="0" max="200" value="100">
              <span class="th-ied-slider-value" id="thIedValSaturation">100%</span>
            </div>
            <div class="th-ied-slider-row">
              <span class="th-ied-slider-label">Blur</span>
              <input type="range" id="thIedFilterBlur" min="0" max="20" value="0">
              <span class="th-ied-slider-value" id="thIedValBlur">0px</span>
            </div>
          </div>
        </div>

        <div class="th-ied-actions">
          <button class="th-ied-btn-reset" onclick="window.ImageEditor && window.ImageEditor.reset()">Reset</button>
          <button class="th-ied-btn-crop" id="thIedBtnCrop" onclick="window.ImageEditor && window.ImageEditor.applyCrop()">Apply Crop</button>
          <button class="th-ied-btn-save" onclick="window.ImageEditor && window.ImageEditor.save()">Save</button>
        </div>
      </div>
    `;

    const wrapper = document.createElement('div');
    wrapper.id = MODAL_ID;
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper);
  }

  /* ── utilities ─────────────────────────────────────────────── */
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));}
  function $(sel,root=document){return root.querySelector(sel);}
  function $(all,root=document){return root.querySelectorAll(all);}

  function hide(el){ if(el) el.classList.add('th-hidden'); }
  function show(el){ if(el) el.classList.remove('th-hidden'); }

  function getNaturalSize(img){
    // Create a temp image to get natural dimensions
    const t = new Image();
    t.src = img.src;
    return { w: t.naturalWidth || img.naturalWidth || 800, h: t.naturalHeight || img.naturalHeight || 600 };
  }

  /* ── core editor ───────────────────────────────────────────── */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        editorState.img = img;
        editorState.imgW = img.naturalWidth;
        editorState.imgH = img.naturalHeight;
        editorState.scale = 1;
        editorState.offsetX = 0;
        editorState.offsetY = 0;
        editorState.rotation = 0;
        editorState.cropMode = false;
        editorState.aspectIdx = 0;
        editorState.filterBrightness = 100;
        editorState.filterContrast = 100;
        editorState.filterSaturation = 100;
        editorState.filterBlur = 0;
        resolve(img);
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  function setupCanvas() {
    const canvas = document.getElementById('thIedCanvas');
    const wrap = document.getElementById('thIedCanvasWrap');
    const wrapW = wrap.clientWidth;
    const wrapH = wrap.clientHeight;

    // Fit image to wrap while preserving aspect
    const imgRatio = editorState.imgW / editorState.imgH;
    const wrapRatio = wrapW / wrapH;
    let dispW, dispH;
    if (imgRatio > wrapRatio) {
      dispW = wrapW;
      dispH = wrapW / imgRatio;
    } else {
      dispH = wrapH;
      dispW = wrapH * imgRatio;
    }

    canvas.width = editorState.imgW;
    canvas.height = editorState.imgH;
    canvas.style.width = Math.round(dispW) + 'px';
    canvas.style.height = Math.round(dispH) + 'px';

    editorState.canvas = canvas;
    editorState.ctx = canvas.getContext('2d');
    editorState.displayW = dispW;
    editorState.displayH = dispH;

    render();
  }

  function render() {
    const ctx = editorState.ctx;
    const img = editorState.img;
    const canvas = editorState.canvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Move to center, rotate, scale
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((editorState.rotation * Math.PI) / 180);
    ctx.scale(editorState.scale, editorState.scale);
    ctx.translate(-editorState.imgW / 2 - editorState.offsetX / editorState.scale,
                  -editorState.imgH / 2 - editorState.offsetY / editorState.scale);

    // Apply filters
    ctx.filter = `brightness(${editorState.filterBrightness}%) contrast(${editorState.filterContrast}%) saturate(${editorState.filterSaturation}%) blur(${editorState.filterBlur}px)`;

    ctx.drawImage(img, 0, 0);
    ctx.restore();

    // Draw crop overlay if in crop mode
    if (editorState.cropMode && editorState.cropRect) {
      drawCropOverlay();
    }
  }

  function drawCropOverlay() {
    const ctx = editorState.ctx;
    const r = editorState.cropRect;
    const canvas = editorState.canvas;

    // Dim outside crop
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // Clear crop area
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();

    // Crop border
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();

    // Grid lines (rule of thirds)
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    const gx1 = r.x + r.w / 3, gx2 = r.x + (r.w * 2) / 3;
    const gy1 = r.y + r.h / 3, gy2 = r.y + (r.h * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(gx1, r.y); ctx.lineTo(gx1, r.y + r.h);
    ctx.moveTo(gx2, r.y); ctx.lineTo(gx2, r.y + r.h);
    ctx.moveTo(r.x, gy1); ctx.lineTo(r.x + r.w, gy1);
    ctx.moveTo(r.x, gy2); ctx.lineTo(r.x + r.w, gy2);
    ctx.stroke();
    ctx.restore();
  }

  function initCropRect() {
    if (!editorState.cropRect) {
      // Start with a centered crop filling 80% of image
      const size = Math.min(editorState.imgW, editorState.imgH) * 0.8;
      editorState.cropRect = {
        x: (editorState.imgW - size) / 2,
        y: (editorState.imgH - size) / 2,
        w: size,
        h: size
      };
    }
    applyAspectRatio();
  }

  function applyAspectRatio() {
    if (!editorState.cropRect) return;
    const ar = ASPECT_RATIOS[editorState.aspectIdx];
    if (ar.w === 0 || ar.h === 0) return; // free

    const targetAR = ar.w / ar.h;
    const curAR = editorState.cropRect.w / editorState.cropRect.h;

    // Adjust width to match aspect, keeping center
    if (curAR > targetAR) {
      // Too wide, reduce width
      editorState.cropRect.w = editorState.cropRect.h * targetAR;
    } else {
      // Too tall, reduce height
      editorState.cropRect.h = editorState.cropRect.w / targetAR;
    }

    // Keep within bounds
    const cx = editorState.cropRect.x + editorState.cropRect.w / 2;
    const cy = editorState.cropRect.y + editorState.cropRect.h / 2;
    editorState.cropRect.x = Math.max(0, Math.min(editorState.imgW - editorState.cropRect.w, cx - editorState.cropRect.w / 2));
    editorState.cropRect.y = Math.max(0, Math.min(editorState.imgH - editorState.cropRect.h, cy - editorState.cropRect.h / 2));

    render();
  }

  function updateCropHandles() {
    if (!editorState.cropMode || !editorState.cropRect) return;
    const r = editorState.cropRect;
    const box = document.getElementById('thIedCropBox');
    const handles = document.querySelectorAll('#thIedCanvasWrap .th-ied-crop-handle');
    const gridV1 = document.getElementById('thIedGridV1');
    const gridV2 = document.getElementById('thIedGridV2');
    const gridH1 = document.getElementById('thIedGridH1');
    const gridH2 = document.getElementById('thIedGridH2');

    // Scale crop rect from canvas coords to display coords
    const sx = editorState.displayW / editorState.imgW;
    const sy = editorState.displayH / editorState.imgH;

    box.style.left = (r.x * sx) + 'px';
    box.style.top = (r.y * sy) + 'px';
    box.style.width = (r.w * sx) + 'px';
    box.style.height = (r.h * sy) + 'px';
    show(box);

    // Handle positions (8 handles)
    const positions = [
      { x: r.x, y: r.y, cls: 'th-ied-handle-nw' },
      { x: r.x + r.w, y: r.y, cls: 'th-ied-handle-ne' },
      { x: r.x, y: r.y + r.h, cls: 'th-ied-handle-sw' },
      { x: r.x + r.w, y: r.y + r.h, cls: 'th-ied-handle-se' },
      { x: r.x + r.w / 2, y: r.y, cls: 'th-ied-handle-n' },
      { x: r.x + r.w / 2, y: r.y + r.h, cls: 'th-ied-handle-s' },
      { x: r.x, y: r.y + r.h / 2, cls: 'th-ied-handle-w' },
      { x: r.x + r.w, y: r.y + r.h / 2, cls: 'th-ied-handle-e' },
    ];

    handles.forEach((h, i) => {
      if (positions[i]) {
        h.style.left = (positions[i].x * sx - 10) + 'px';
        h.style.top = (positions[i].y * sy - 10) + 'px';
        show(h);
      }
    });

    // Grid lines
    if (gridV1) { gridV1.style.left = (r.x + r.w/3)*sx + 'px'; gridV1.style.top = (r.y*sy) + 'px'; gridV1.style.height = (r.h*sy) + 'px'; show(gridV1); }
    if (gridV2) { gridV2.style.left = (r.x + (r.w*2)/3)*sx + 'px'; gridV2.style.top = (r.y*sy) + 'px'; gridV2.style.height = (r.h*sy) + 'px'; show(gridV2); }
    if (gridH1) { gridH1.style.top = (r.y + r.h/3)*sy + 'px'; gridH1.style.left = (r.x*sx) + 'px'; gridH1.style.width = (r.w*sx) + 'px'; show(gridH1); }
    if (gridH2) { gridH2.style.top = (r.y + (r.h*2)/3)*sy + 'px'; gridH2.style.left = (r.x*sx) + 'px'; gridH2.style.width = (r.w*sx) + 'px'; show(gridH2); }
  }

  function switchTab(tabName) {
    document.querySelectorAll('#thIedCanvasWrap .th-ied-tab-content').forEach(el => hide(el));
    document.querySelectorAll('#thIedCanvasWrap .th-ied-tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tabName);
    });
    show(document.getElementById('thIedTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1)));

    const cropMode = tabName === 'crop';
    editorState.cropMode = cropMode;
    const btn = document.getElementById('thIedBtnCrop');
    if (btn) btn.style.display = cropMode ? 'inline-block' : 'none';

    if (cropMode) {
      initCropRect();
      updateCropHandles();
    } else {
      hide(document.getElementById('thIedCropBox'));
      document.querySelectorAll('#thIedCanvasWrap .th-ied-crop-handle').forEach(h => hide(h));
      document.querySelectorAll('#thIedCanvasWrap .th-ied-grid-line').forEach(g => hide(g));
    }
    render();
  }

  /* ── events ────────────────────────────────────────────────── */
  function bindEvents() {
    const wrap = document.getElementById('thIedCanvasWrap');
    const canvas = document.getElementById('thIedCanvas');

    // Tab switching
    document.querySelectorAll('#thIedCanvasWrap .th-ied-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Ratio buttons
    document.querySelectorAll('#thIedCanvasWrap .th-ied-ratio').forEach(btn => {
      btn.addEventListener('click', () => {
        editorState.aspectIdx = parseInt(btn.dataset.ratio, 10);
        document.querySelectorAll('#thIedCanvasWrap .th-ied-ratio').forEach(b =>
          b.classList.toggle('active', b === btn));
        applyAspectRatio();
      });
    });

    // Filter sliders
    const filters = [
      { id: 'thIedFilterBrightness', key: 'filterBrightness', labelId: 'thIedValBrightness', suffix: '%' },
      { id: 'thIedFilterContrast', key: 'filterContrast', labelId: 'thIedValContrast', suffix: '%' },
      { id: 'thIedFilterSaturation', key: 'filterSaturation', labelId: 'thIedValSaturation', suffix: '%' },
      { id: 'thIedFilterBlur', key: 'filterBlur', labelId: 'thIedValBlur', suffix: 'px' },
    ];
    filters.forEach(f => {
      const el = document.getElementById(f.id);
      el.addEventListener('input', (e) => {
        editorState[f.key] = parseFloat(e.target.value);
        document.getElementById(f.labelId).textContent = editorState[f.key] + f.suffix;
        render();
      });
    });

    // Canvas drag (pan when not cropping)
    let isDragging = false;
    let startX = 0, startY = 0;

    const startDrag = (clientX, clientY) => {
      if (editorState.cropMode) return;
      isDragging = true;
      startX = clientX;
      startY = clientY;
      wrap.style.cursor = 'grabbing';
    };
    const doDrag = (clientX, clientY) => {
      if (!isDragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      // Convert display px to canvas px, then divide by scale
      const sx = editorState.imgW / editorState.displayW;
      const sy = editorState.imgH / editorState.displayH;
      editorState.offsetX += dx * sx / editorState.scale;
      editorState.offsetY += dy * sy / editorState.scale;
      startX = clientX;
      startY = clientY;
      render();
    };
    const endDrag = () => {
      isDragging = false;
      wrap.style.cursor = editorState.cropMode ? 'crosshair' : 'move';
    };

    wrap.addEventListener('pointerdown', (e) => {
      if (e.target !== canvas && e.target !== wrap) return;
      if (editorState.cropMode) return;
      startDrag(e.clientX, e.clientY);
    });
    wrap.addEventListener('pointermove', (e) => {
      if (e.buttons === 1 && !editorState.cropMode) doDrag(e.clientX, e.clientY);
    });
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    // Wheel zoom
    wrap.addEventListener('wheel', (e) => {
      if (editorState.cropMode) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      const newScale = Math.max(0.5, Math.min(5, editorState.scale + delta));
      const rect = wrap.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / editorState.displayW * editorState.imgW;
      const cy = (e.clientY - rect.top) / editorState.displayH * editorState.imgH;
      // Adjust offset to zoom toward cursor
      editorState.offsetX -= (cx - editorState.imgW/2) * (newScale/editorState.scale - 1);
      editorState.offsetY -= (cy - editorState.imgH/2) * (newScale/editorState.scale - 1);
      editorState.scale = newScale;
      render();
    }, { passive: false });

    // Crop handles
    let cropDragHandle = null;
    let cropDragStart = { x: 0, y: 0, rect: null };
    let cropDragMove = false;

    document.querySelectorAll('#thIedCanvasWrap .th-ied-crop-handle').forEach(handle => {
      handle.addEventListener('pointerdown', (e) => {
        cropDragHandle = handle.dataset.handle;
        cropDragStart = { x: e.clientX, y: e.clientY, rect: { ...editorState.cropRect } };
        cropDragMove = false;
        e.stopPropagation();
      });
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!cropDragHandle) return;
      cropDragMove = true;
      const dx = e.clientX - cropDragStart.x;
      const dy = e.clientY - cropDragStart.y;
      const sx = editorState.imgW / editorState.displayW;
      const sy = editorState.imgH / editorState.displayH;
      const dX = dx * sx;
      const dY = dy * sy;
      const r = { ...cropDragStart.rect };

      if (cropDragHandle.includes('n')) r.y = Math.max(0, r.y + dY);
      if (cropDragHandle.includes('s')) r.h = Math.max(20, r.h + dY);
      if (cropDragHandle.includes('w')) {
        const dw = r.x + r.w - Math.max(0, r.x + dX);
        r.x = Math.max(0, r.x + dX);
        r.w = Math.max(20, dw);
      }
      if (cropDragHandle.includes('e')) r.w = Math.max(20, r.w + dX);

      // Clamp to image bounds
      if (r.x < 0) { r.w += r.x; r.x = 0; }
      if (r.y < 0) { r.h += r.y; r.y = 0; }
      if (r.x + r.w > editorState.imgW) r.w = editorState.imgW - r.x;
      if (r.y + r.h > editorState.imgH) r.h = editorState.imgH - r.y;

      editorState.cropRect = r;
      applyAspectRatio(); // maintain aspect if locked
      render();
      updateCropHandles();
    });
    wrap.addEventListener('pointerup', () => { cropDragHandle = null; });
    wrap.addEventListener('pointercancel', () => { cropDragHandle = null; });

    // Crop box drag (move the whole crop rect)
    let cropBoxDrag = false;
    let cropBoxStart = { x: 0, y: 0, rect: null };
    const cropBox = document.getElementById('thIedCropBox');
    cropBox.addEventListener('pointerdown', (e) => {
      if (!editorState.cropMode) return;
      cropBoxDrag = true;
      cropBoxStart = { x: e.clientX, y: e.clientY, rect: { ...editorState.cropRect } };
      e.stopPropagation();
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!cropBoxDrag) return;
      const dx = e.clientX - cropBoxStart.x;
      const dy = e.clientY - cropBoxStart.y;
      const sx = editorState.imgW / editorState.displayW;
      const sy = editorState.imgH / editorState.displayH;
      const r = { ...cropBoxStart.rect };
      r.x = Math.max(0, Math.min(editorState.imgW - r.w, r.rect.x + dx * sx));
      r.y = Math.max(0, Math.min(editorState.imgH - r.h, r.rect.y + dy * sy));
      editorState.cropRect = r;
      render();
      updateCropHandles();
    });
    wrap.addEventListener('pointerup', () => { cropBoxDrag = false; });

    // Window resize
    window.addEventListener('resize', () => {
      if (document.getElementById(MODAL_ID).classList.contains('open')) {
        setupCanvas();
      }
    });
  }

  /* ── public API ────────────────────────────────────────────── */
  function open({ src, onSave }) {
    buildModal();
    bindEvents();
    editorState.onSave = onSave;

    const modal = document.getElementById(MODAL_ID);
    modal.classList.add('open');

    loadImage(src).then(() => {
      setupCanvas();
      switchTab('adjust');
    }).catch(err => {
      console.error('[ImageEditor] load failed:', err);
      close();
    });
  }

  function close() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.classList.remove('open');
    setTimeout(() => {
      const m = document.getElementById(MODAL_ID);
      if (m) m.remove();
    }, 300);
    editorState.onSave = null;
  }

  function rotate(deg) {
    editorState.rotation = (editorState.rotation + deg) % 360;
    render();
  }

  function reset() {
    editorState.rotation = 0;
    editorState.scale = 1;
    editorState.offsetX = 0;
    editorState.offsetY = 0;
    editorState.filterBrightness = 100;
    editorState.filterContrast = 100;
    editorState.filterSaturation = 100;
    editorState.filterBlur = 0;
    document.getElementById('thIedFilterBrightness').value = 100;
    document.getElementById('thIedFilterContrast').value = 100;
    document.getElementById('thIedFilterSaturation').value = 100;
    document.getElementById('thIedFilterBlur').value = 0;
    document.getElementById('thIedValBrightness').textContent = '100%';
    document.getElementById('thIedValContrast').textContent = '100%';
    document.getElementById('thIedValSaturation').textContent = '100%';
    document.getElementById('thIedValBlur').textContent = '0px';
    render();
  }

  function applyCrop() {
    if (!editorState.cropRect) return;
    editorState.cropMode = false;
    hide(document.getElementById('thIedCropBox'));
    document.querySelectorAll('#thIedCanvasWrap .th-ied-crop-handle').forEach(h => hide(h));
    document.querySelectorAll('#thIedCanvasWrap .th-ied-grid-line').forEach(g => hide(g));
    render();
  }

  async function save() {
    if (!editorState.onSave) return;

    const canvas = editorState.canvas;
    const ctx = editorState.ctx;
    const img = editorState.img;

    // Create output canvas at natural size
    const outW = img.naturalWidth;
    const outH = img.naturalHeight;
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const octx = out.getContext('2d');

    // Draw rotated image onto output canvas
    // Need to handle rotation by drawing to a temp canvas first
    const temp = document.createElement('canvas');
    temp.width = img.naturalWidth;
    temp.height = img.naturalHeight;
    const tctx = temp.getContext('2d');
    tctx.drawImage(img, 0, 0);

    // Apply rotation
    octx.save();
    if (editorState.rotation !== 0) {
      const cx = outW / 2, cy = outH / 2;
      octx.translate(cx, cy);
      octx.rotate((editorState.rotation * Math.PI) / 180);
      octx.translate(-cx, -cy);
    }
    octx.drawImage(temp, 0, 0);
    octx.restore();

    // Apply crop if set
    if (editorState.cropRect) {
      octx.save();
      octx.beginPath();
      octx.rect(editorState.cropRect.x, editorState.cropRect.y, editorState.cropRect.w, editorState.cropRect.h);
      octx.clip();
      // Redraw the rotated image clipped
      const temp2 = document.createElement('canvas');
      temp2.width = outW;
      temp2.height = outH;
      const t2ctx = temp2.getContext('2d');
      t2ctx.drawImage(out, 0, 0);
      octx.clearRect(0, 0, outW, outH);
      octx.drawImage(temp2, 0, 0);
      octx.restore();
    }

    // Convert to blob
    out.toBlob((blob) => {
      if (editorState.onSave) editorState.onSave(blob, out.toDataURL('image/jpeg', 0.92));
    }, 'image/jpeg', 0.92);

    close();
  }

  global.ImageEditor = { open, close, rotate, reset, applyCrop, save };
})(window);
