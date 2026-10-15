/* ════════════════════════════════════════════════════════════════
   Twin Hearts — Pro Upgrade Card (shared module)
   ₹99 / month   ·   ₹499 lifetime (one-time)
   UPI: 7077745442@upi  ·  Name: Tulugu Vamsi
   Flow: pick plan → Pay → show QR (or scan QR) → submit proof + details
   → admin reviews → approves → both partners get Pro.
   Include this script in any page/iframe that needs Pro gating:
     <script src="/js/pro-card.js"></script>
   Then gate actions with:
     await ProCard.requirePro('music')   // returns false + shows card if not Pro
 ═════════════════════════════════════════════════════════════════ */
'use strict';

(function () {
  const API = (window.__API_BASE__ && window.__API_BASE__.replace(/\/$/, '')) || '';
  const STORAGE_KEY = 'uwl_v5';
  const MODAL_ID = 'th-pro-modal';

  // ── your UPI details ──────────────────────────────────────────
  const UPI_ID = '7077745442@upi';
  const UPI_NAME = 'Tulugu Vamsi';

  // ── theme tokens (fallbacks so the card looks right in every iframe) ──
  const T = {
    accent: 'hsl(322, 100%, 62%)',
    accentD: 'hsl(322, 95%, 50%)',
    accentGlow: 'hsla(322, 100%, 62%, 0.35)',
    accent2: '#6B093A',
    bg: '#090206',
    panel: 'rgba(18,6,13,0.92)',
    panel2: 'rgba(25,10,19,0.7)',
    border: 'rgba(255,255,255,0.10)',
    border2: 'rgba(255,255,255,0.18)',
    text: 'rgba(255,255,255,0.92)',
    text2: 'rgba(255,255,255,0.62)',
    text3: 'rgba(255,255,255,0.38)',
    green: '#34d399',
    red: '#f87171',
    yellow: '#fbbf24',
    radius: '18px',
    transition: 'all 0.22s cubic-bezier(0.4,0,0.2,1)'
  };

  let proCache = { coupleId: null, isPro: false, plan: null, ts: 0 };
  const CACHE_TTL = 60 * 1000;

  let scannerInstance = null;
  let scannerActive = false;

  /* ── helpers ─────────────────────────────────────────────────── */
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function $ (sel, root = document) { return root.querySelector(sel); }
  function toast(msg, type = 'success') {
    if (typeof window.toast === 'function') { window.toast(msg, type); return; }
    let el = document.getElementById('th-pro-toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'th-pro-toast';
      Object.assign(el.style, { position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', padding: '10px 18px', borderRadius: '12px', color: '#fff', fontSize: '13px', zIndex: 99999, pointerEvents: 'none', opacity: '0', transition: 'opacity .3s' });
      document.body.appendChild(el);
    }
    el.style.background = type === 'error' ? T.red : T.green;
    el.textContent = msg; el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 2500);
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return (s && s.coupleId) ? s : null;
    } catch (e) { return null; }
  }

  function coupleId() { const s = readSession(); return s ? s.coupleId : null; }

  /* ── Pro status ──────────────────────────────────────────────── */
  async function fetchProStatus(cid) {
    try {
      const res = await fetch(`${API}/api/pro/status?coupleId=${encodeURIComponent(cid)}`, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { console.warn('[pro-card] status check failed:', e.message); return null; }
  }

  async function isPro(cid, force = false) {
    const now = Date.now();
    if (!force && proCache.coupleId === cid && now - proCache.ts < CACHE_TTL) {
      return proCache.isPro;
    }
    const status = await fetchProStatus(cid);
    if (status) {
      proCache = { coupleId: cid, isPro: !!status.isPro, plan: status.plan || null, ts: now };
      return proCache.isPro;
    }
    return false;
  }

  /* ── inject styles ───────────────────────────────────────────── */
  function injectStyles() {
    if (document.getElementById('th-pro-card-styles')) return;
    const style = document.createElement('style');
    style.id = 'th-pro-card-styles';
    style.textContent = `
      #${MODAL_ID} {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
        padding: 20px; opacity: 0; pointer-events: none;
        transition: opacity .25s ease;
      }
      #${MODAL_ID}.open { opacity: 1; pointer-events: auto; }
      #${MODAL_ID} .th-backdrop {
        position: absolute; inset: 0; background: rgba(6,2,5,0.55);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      }
      #${MODAL_ID} .th-card {
        position: relative; z-index: 2;
        width: 100%; max-width: 430px; max-height: 94dvh;
        overflow-y: auto; border-radius: ${T.radius};
        background: ${T.panel}; border: 1px solid ${T.border2};
        box-shadow: 0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px ${T.border};
        animation: thPop .28s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes thPop { from { opacity:0; transform: scale(.92) translateY(10px); } to { opacity:1; transform: none; } }
      #${MODAL_ID} .th-header {
        padding: 22px 22px 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
      }
      #${MODAL_ID} .th-heart {
        width: 36px; height: 36px; border-radius: 10px;
        background: linear-gradient(135deg, ${T.accent}, ${T.accent2});
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; box-shadow: 0 4px 14px ${T.accentGlow};
      }
      #${MODAL_ID} .th-title { font-family: 'DM Serif Display', Georgia, serif; font-size: 20px; color: #fff; margin: 0 0 2px; letter-spacing: -0.3px; }
      #${MODAL_ID} .th-sub { font-size: 12px; color: ${T.text2}; margin: 0; }
      #${MODAL_ID} .th-close { background: none; border: none; color: ${T.text2}; font-size: 22px; cursor: pointer; padding: 2px 8px; border-radius: 8px; }
      #${MODAL_ID} .th-close:hover { background: rgba(255,255,255,0.08); color: #fff; }

      #${MODAL_ID} .th-body { padding: 0 22px 22px; }
      #${MODAL_ID} .th-plan-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
      #${MODAL_ID} .th-plan {
        border-radius: 14px; border: 2px solid ${T.border}; padding: 16px 14px;
        text-align: center; cursor: pointer; transition: ${T.transition};
        background: rgba(255,255,255,0.02);
      }
      #${MODAL_ID} .th-plan:hover { border-color: ${T.border2}; background: rgba(255,255,255,0.05); }
      #${MODAL_ID} .th-plan.selected {
        border-color: ${T.accent}; background: linear-gradient(135deg, hsla(322,100%,62%,0.16), hsla(322,100%,62%,0.06));
        box-shadow: 0 0 20px ${T.accentGlow};
      }
      #${MODAL_ID} .th-plan.best { position: relative; }
      #${MODAL_ID} .th-plan .th-tag {
        position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
        font-size: 10px; font-weight: 800; letter-spacing: 1px; color: ${T.yellow};
        background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.35);
        padding: 2px 10px; border-radius: 20px; text-transform: uppercase;
      }
      #${MODAL_ID} .th-plan-ico { font-size: 26px; margin-bottom: 10px; display: block; }
      #${MODAL_ID} .th-plan-name { font-family: 'DM Serif Display', Georgia, serif; font-size: 16px; color: #fff; margin: 0 0 6px; }
      #${MODAL_ID} .th-plan-price { font-size: 24px; font-weight: 800; color: #fff; letter-spacing: -0.5px; }
      #${MODAL_ID} .th-plan-price span { font-size: 14px; font-weight: 500; color: ${T.text2}; }
      #${MODAL_ID} .th-plan-desc { font-size: 11.5px; color: ${T.text2}; margin-top: 6px; line-height: 1.4; }

      #${MODAL_ID} .th-pay-btn {
        width: 100%; padding: 14px; border-radius: 14px; border: none;
        background: linear-gradient(135deg, ${T.accent}, ${T.accentD});
        color: #fff; font-size: 15px; font-weight: 700; font-family: 'Inter', sans-serif;
        cursor: pointer; box-shadow: 0 6px 20px ${T.accentGlow}; transition: ${T.transition};
      }
      #${MODAL_ID} .th-pay-btn:not(.active) { opacity: .6; cursor: not-allowed; filter: grayscale(.6); }
      #${MODAL_ID} .th-pay-btn.active:hover { filter: brightness(1.1); transform: translateY(-1px); }
      #${MODAL_ID} .th-pay-btn.active:active { transform: scale(.97); }

      /* QR screen */
      #${MODAL_ID} .th-step { display: none; }
      #${MODAL_ID} .th-step.active { display: block; animation: thFade .3s ease; }
      @keyframes thFade { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: none; } }
      #${MODAL_ID} .th-qr-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; padding-top: 8px; }
      #${MODAL_ID} .th-qr-box {
        width: 210px; height: 210px; border-radius: 20px;
        background: #fff; border: 2px solid ${T.border}; display: flex; align-items: center; justify-content: center;
        padding: 10px; box-shadow: 0 8px 30px rgba(0,0,0,0.4);
      }
      #${MODAL_ID} .th-qr-box img { width: 100%; height: 100%; object-fit: contain; border-radius: 14px; }
      #${MODAL_ID} .th-qr-amt { font-size: 30px; font-weight: 800; color: #fff; font-family: 'DM Serif Display', Georgia, serif; }
      #${MODAL_ID} .th-qr-note { font-size: 12.5px; color: ${T.text2}; text-align: center; line-height: 1.5; }
      #${MODAL_ID} .th-upi { margin-top: 6px; font-size: 11px; color: ${T.text3}; word-break: break-all; text-align: center; padding: 0 10px; }

      /* Scanner */
      #${MODAL_ID} .th-scan-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; padding-top: 6px; }
      #${MODAL_ID} .th-scanner-box {
        width: 100%; max-width: 320px; height: 320px; border-radius: 20px;
        background: #000; border: 2px solid ${T.border2}; position: relative; overflow: hidden;
        display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 30px rgba(0,0,0,0.6);
      }
      #${MODAL_ID} #thScannerVideo {
        width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1);
      }
      #${MODAL_ID} .th-scan-overlay {
        position: absolute; inset: 0; border: 2px solid ${T.accent}; border-radius: 20px;
        pointer-events: none; box-shadow: 0 0 20px ${T.accentGlow};
        animation: thScanPulse 2s ease-in-out infinite;
      }
      @keyframes thScanPulse {
        0%,100% { opacity: 0.6; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.02); }
      }
      #${MODAL_ID} .th-scan-line {
        position: absolute; left: 12px; right: 12px; height: 3px; background: ${T.accent};
        top: 12px; border-radius: 2px; box-shadow: 0 0 10px ${T.accent};
        animation: thScanLine 2.5s linear infinite;
      }
      @keyframes thScanLine {
        0% { top: 12px; opacity: 0; }
        10% { opacity: 1; }
        90% { opacity: 1; }
        100% { top: calc(100% - 3px); opacity: 0; }
      }
      #${MODAL_ID} .th-scan-btn {
        width: 100%; padding: 13px; border-radius: 14px; border: none;
        background: linear-gradient(135deg, ${T.accent}, ${T.accentD});
        color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; transition: ${T.transition}; box-shadow: 0 6px 20px ${T.accentGlow};
      }
      #${MODAL_ID} .th-scan-btn:active { transform: scale(.97); }
      #${MODAL_ID} .th-scan-btn.stop { background: linear-gradient(135deg, ${T.red}, #b91c1c); box-shadow: 0 6px 20px rgba(248,113,113,0.25); }

      /* form screen */
      #${MODAL_ID} .th-field { margin-bottom: 14px; }
      #${MODAL_ID} .th-field label { display: block; font-size: 11px; color: ${T.text2}; margin-bottom: 5px; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase; }
      #${MODAL_ID} .th-field input, #${MODAL_ID} .th-field textarea, #${MODAL_ID} .th-field select {
        width: 100%; border: 1px solid ${T.border}; border-radius: 10px; padding: 10px 13px;
        font-size: 13px; font-family: inherit; outline: none; background: rgba(255,255,255,0.03); color: #fff; transition: ${T.transition};
      }
      #${MODAL_ID} .th-field input:focus, #${MODAL_ID} .th-field textarea:focus { border-color: ${T.accent}; background: rgba(255,255,255,0.07); box-shadow: 0 0 0 3px ${T.accentGlow}; }
      #${MODAL_ID} .th-file-label {
        display: flex; align-items: center; gap: 10px; border: 1px dashed ${T.border2}; border-radius: 10px;
        padding: 10px 13px; background: rgba(255,255,255,0.03); color: ${T.text2}; font-size: 12.5px; cursor: pointer; transition: ${T.transition};
      }
      #${MODAL_ID} .th-file-label:hover { border-color: ${T.accent}; color: #fff; background: rgba(255,255,255,0.07); }
      #${MODAL_ID} .th-file-input { display: none; }
      #${MODAL_ID} .th-file-name { font-size: 11.5px; color: ${T.accent}; margin-top: 6px; min-height: 16px; }
      #${MODAL_ID} .th-submit-btn {
        width: 100%; padding: 14px; border-radius: 14px; border: none;
        background: linear-gradient(135deg, ${T.green}, #15803d);
        color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; transition: ${T.transition}; box-shadow: 0 6px 20px rgba(52,211,153,0.25);
      }
      #${MODAL_ID} .th-submit-btn:active { transform: scale(.97); }
      #${MODAL_ID} .th-footer-note { font-size: 11px; color: ${T.text3}; text-align: center; margin-top: 10px; line-height: 1.5; }

      /* success */
      #${MODAL_ID} .th-success { text-align: center; padding-top: 14px; }
      #${MODAL_ID} .th-success-ico { font-size: 46px; margin-bottom: 12px; }
      #${MODAL_ID} .th-success-title { font-family: 'DM Serif Display', Georgia, serif; font-size: 18px; color: #fff; margin: 0 0 6px; }
      #${MODAL_ID} .th-success-sub { font-size: 12.5px; color: ${T.text2}; margin: 0; }

      #${MODAL_ID} .th-hidden { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  /* ── modal HTML ──────────────────────────────────────────────── */
  function buildModal() {
    if (document.getElementById(MODAL_ID)) return;
    injectStyles();
    const wrapper = document.createElement('div');
    wrapper.id = MODAL_ID;
    wrapper.innerHTML = `
      <div class="th-backdrop" onclick="window.ProCard && window.ProCard.close()"></div>
      <div class="th-card" role="dialog" aria-modal="true" aria-labelledby="thProTitle">
        <div class="th-header">
          <div class="th-heart">💕</div>
          <div>
            <h2 class="th-title" id="thProTitle">Go Pro</h2>
            <p class="th-sub">Unlock everything for you & your partner</p>
          </div>
          <button class="th-close" aria-label="Close" onclick="window.ProCard && window.ProCard.close()">✕</button>
        </div>
        <div class="th-body">
          <!-- PLANS STEP -->
          <div class="th-step" id="thStepPlans">
            <div class="th-plan-row">
              <div class="th-plan" data-plan="monthly" onclick="window.ProCard && window.ProCard.selectPlan('monthly')">
                <span class="th-plan-ico">📅</span>
                <p class="th-plan-name">Monthly Pro</p>
                <p class="th-plan-price">₹99<span>/month</span></p>
                <p class="th-plan-detail th-plan-desc">Renews every 30 days · both of you get Pro</p>
              </div>
              <div class="th-plan best" data-plan="lifetime" onclick="window.ProCard && window.ProCard.selectPlan('lifetime')">
                <span class="th-tag">Best Value</span>
                <span class="th-plan-ico">♾️</span>
                <p class="th-plan-name">Lifetime Pro</p>
                <p class="th-plan-price">₹499<span>one-time</span></p>
                <p class="th-plan-desc">Pay once, Pro forever · both of you get Pro</p>
              </div>
            </div>
            <p style="font-size:11.5px;color:${T.text3};text-align:center;margin-bottom:6px">Music · Movies · AI (Both Mode) · Memory Globe</p>
            <button class="th-pay-btn" id="thPayBtn" onclick="window.ProCard && window.ProCard.goToPay()">Proceed to Pay</button>
            <p class="th-footer-note">Pay via UPI (QR or scan), then upload your payment proof.</p>
          </div>

          <!-- QR / SCAN STEP -->
          <div class="th-step" id="thStepQr">
            <div class="th-qr-wrap">
              <div style="font-size:12px;color:${T.text2};text-transform:uppercase;letter-spacing:.8px">Pay by UPI</div>
              <div class="th-qr-box" id="thQrBox"><div style="color:${T.text3};font-size:12px">Loading QR…</div></div>
              <div class="th-qr-amt" id="thQrAmt">₹0</div>
              <div class="th-upi" id="thQrUpi">UPI: ${UPI_ID}</div>
              <p class="th-qr-note" id="thQrNote">Pay <b>₹0</b> to unlock Pro. After payment, tap <b>I've Paid</b>.</p>
              <div style="display:flex;gap:8px;margin-top:10px">
                <button class="th-scan-btn" id="thScanBtn" onclick="window.ProCard && window.ProCard.toggleScanner()">📷 Scan QR Code</button>
              </div>
            </div>
            <!-- Scanner panel (hidden by default) -->
            <div class="th-scan-wrap th-hidden" id="thScannerWrap">
              <div style="font-size:12px;color:${T.text2};text-transform:uppercase;letter-spacing:.8px">Scanner — point at any UPI QR</div>
              <div class="th-scanner-box" id="thScannerBox">
                <video id="thScannerVideo" playsinline muted></video>
                <div class="th-scan-overlay"></div>
                <div class="th-scan-line"></div>
              </div>
              <button class="th-scan-btn stop" id="thStopScanBtn" onclick="window.ProCard && window.ProCard.toggleScanner()">⏹ Stop Scanner</button>
              <p style="font-size:11.5px;color:${T.text3};text-align:center;max-width:260px">Scanned UPI details will auto-fill below.</p>
            </div>
            <button class="th-pay-btn active" onclick="window.ProCard && window.ProCard.goToForm()">I've Paid → Enter Details</button>
            <p class="th-footer-note">Screenshot your payment and upload it on the next screen.</p>
          </div>

          <!-- DETAILS FORM STEP -->
          <div class="th-step" id="thStepForm">
            <form id="thProForm">
              <div class="th-field">
                <label>Your Name (paid person)</label>
                <input type="text" id="thPaidName" placeholder="Your full name" required>
              </div>
              <div class="th-field">
                <label>Your Phone</label>
                <input type="tel" id="thPaidPhone" placeholder="Your phone number" required>
              </div>
              <div class="th-field">
                <label>Partner's Name</label>
                <input type="text" id="thPartnerName" placeholder="Partner's full name" required>
              </div>
              <div class="th-field">
                <label>Partner's Phone</label>
                <input type="tel" id="thPartnerPhone" placeholder="Partner's phone number" required>
              </div>
              <div class="th-field">
                <label>Transaction / UPI Reference ID</label>
                <input type="text" id="thTxnId" placeholder="e.g. AXL1234567890" required>
              </div>
              <div class="th-field">
                <label>Upload Payment Screenshot</label>
                <label class="th-file-label" id="thFileLabel"><span>Choose file</span></label>
                <input type="file" id="thFileInput" accept="image/*" class="th-file-input">
                <div class="th-file-name" id="thFileName"></div>
              </div>
              <div class="th-field">
                <label>Note (optional)</label>
                <textarea id="thProNote" rows="3" placeholder="Anything you want the admin to know…"></textarea>
              </div>
              <button type="submit" class="th-submit-btn" id="thProSubmit">Submit Request → Admin</button>
            </form>
            <p class="th-footer-note">Once approved, both you and your partner get Pro access instantly.</p>
          </div>

          <!-- SUCCESS STEP -->
          <div class="th-step" id="thStepSuccess">
            <div class="th-success">
              <div class="th-success-ico">✅</div>
              <h2 class="th-success-title">Request Submitted</h2>
              <p class="th-success-sub">We’ll review your payment and activate Pro for both of you. You’ll be notified in the app.</p>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);

    // file input wiring
    const fileInput = document.getElementById('thFileInput');
    const fileLabel = document.getElementById('thFileLabel');
    const fileNameEl = document.getElementById('thFileName');
    let selectedFile = null;
    fileLabel.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') fileInput.click(); });
    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files[0] || null;
      if (selectedFile) {
        fileNameEl.textContent = selectedFile.name + ' · ' + (selectedFile.size / 1024).toFixed(1) + ' KB';
        const span = fileLabel.querySelector('span');
        if (span) span.textContent = 'Change file';
      }
    });

    // form submit
    document.getElementById('thProForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('thProSubmit');
      const cid = coupleId();
      if (!cid) { toast('Session not found. Please log in again.', 'error'); return; }
      btn.disabled = true; btn.textContent = 'Submitting…';
      try {
        const fd = new FormData();
        fd.append('coupleId', cid);
        fd.append('plan', window.ProCard._selectedPlan);
        fd.append('paidByName', document.getElementById('thPaidName').value.trim());
        fd.append('paidByPhone', document.getElementById('thPaidPhone').value.trim());
        fd.append('partnerName', document.getElementById('thPartnerName').value.trim());
        fd.append('partnerPhone', document.getElementById('thPartnerPhone').value.trim());
        fd.append('transactionId', document.getElementById('thTxnId').value.trim());
        fd.append('notes', document.getElementById('thProNote').value.trim());
        if (selectedFile) fd.append('paymentProof', selectedFile);

        const res = await fetch(`${API}/api/pro/upgrade-request`, {
          method: 'POST', credentials: 'include', body: fd
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Submission failed');
        window.ProCard.showStep('success');
        toast('Request sent to admin ✅');
        setTimeout(() => window.ProCard.close(), 1500);
      } catch (err) {
        toast(err.message || 'Something went wrong', 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Submit Request → Admin';
      }
    });
  }

  /* ── QR scanner ──────────────────────────────────────────────── */
  async function loadScannerLib() {
    if (window.Html5Qrcode) return window.Html5Qrcode;
    if (document.getElementById('th-qr-scanner-lib')) return new Promise(r => {
      const t = setInterval(() => { if (window.Html5Qrcode) { clearInterval(t); r(window.Html5Qrcode); } }, 100);
    });
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.id = 'th-qr-scanner-lib';
      s.src = 'https://unpkg.com/html5-qrcode@2.3.8/dist/html5-qrcode.min.js';
      s.onload = () => resolve(window.Html5Qrcode);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function startScanner() {
    try {
      const Html5Qrcode = await loadScannerLib();
      scannerInstance = new Html5Qrcode('thScannerVideo');
      await scannerInstance.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 200 },
        (decodedText) => {
          // auto-stop on first successful scan
          stopScanner();
          handleScannedData(decodedText);
        },
        (errorMessage) => { /* ignore continuous scan errors */ }
      );
      scannerActive = true;
      updateScannerUI();
    } catch (err) {
      toast('Camera access failed. Use QR instead.', 'error');
      console.error('[pro-card] scanner start failed:', err);
    }
  }

  async function stopScanner() {
    if (scannerInstance && scannerActive) {
      try { await scannerInstance.stop(); } catch (e) {}
      scannerActive = false;
    }
    scannerInstance = null;
    updateScannerUI();
  }

  function updateScannerUI() {
    const wrap = document.getElementById('thScannerWrap');
    const box = document.getElementById('thScannerBox');
    const btn = document.getElementById('thStopScanBtn');
    if (!wrap) return;
    if (scannerActive) {
      wrap.classList.remove('th-hidden');
      if (box) box.style.display = 'flex';
      if (btn) btn.textContent = '⏹ Stop Scanner';
      try { document.getElementById('thScannerVideo').play(); } catch (e) {}
    } else {
      wrap.classList.add('th-hidden');
      if (box) box.style.display = 'none';
      if (btn) btn.textContent = '📷 Scan QR Code';
    }
  }

  async function toggleScanner() {
    if (scannerActive) { await stopScanner(); return; }
    // pause any other scanner
    await stopScanner();
    await startScanner();
  }

  function handleScannedData(text) {
    if (!text) return;
    let upi = null, amt = null, name = null, txn = null;
    const t = String(text);
    // Parse UPI intent URL: upi://pay?pa=...&pn=...&am=...&tn=...
    try {
      const u = new URL(t.replace('upi://', 'https://'));
      upi = u.searchParams.get('pa') || null;
      amt = u.searchParams.get('am') || null;
      name = u.searchParams.get('pn') || null;
      txn = u.searchParams.get('txn') || null;
    } catch (e) {
      // fallback: if it's just a UPI id
      upi = t || null;
    }
    if (upi) {
      document.getElementById('thTxnId').value = txn || '';
      // store scanned info to show in note
      const noteEl = document.getElementById('thProNote');
      if (noteEl && name) noteEl.value = `Scanned UPI: ${upi} · ${name}`;
      toast('UPI QR scanned ✅');
    }
  }

  /* ── public API ──────────────────────────────────────────────── */
  window.ProCard = {
    _selectedPlan: null,
    _qrPayload: null,
    _qrAmt: null,

    open() {
      buildModal();
      const el = document.getElementById(MODAL_ID);
      el.classList.add('open');
      this.showStep('plans');
    },
    close() {
      stopScanner();
      const el = document.getElementById(MODAL_ID);
      if (el) el.classList.remove('open');
    },
    showStep(step) {
      ['plans','qr','form','success'].forEach(s => {
        const el = document.getElementById('thStep' + s[0].toUpperCase() + s.slice(1));
        if (el) el.classList.toggle('active', s === step);
      });
      const btn = document.getElementById('thPayBtn');
      if (btn) btn.classList.toggle('active', this._selectedPlan !== null);
    },
    selectPlan(plan) {
      this._selectedPlan = plan;
      document.querySelectorAll('#thStepPlans .th-plan').forEach(p => {
        p.classList.toggle('selected', p.dataset.plan === plan);
      });
      this.showStep('plans');
    },
    async goToPay() {
      if (!this._selectedPlan) { toast('Please select a plan', 'error'); return; }
      await stopScanner();
      this.showStep('qr');
      await this.renderQr();
    },
    async renderQr() {
      const box = document.getElementById('thQrBox');
      const amtEl = document.getElementById('thQrAmt');
      const noteEl = document.getElementById('thQrNote');
      const upiEl = document.getElementById('thQrUpi');
      const cid = coupleId();
      const plan = this._selectedPlan;
      const amt = plan === 'monthly' ? 99 : 499;
      const label = plan === 'monthly' ? 'Twin Hearts Pro – Monthly' : 'Twin Hearts Pro – Lifetime';
      this._qrAmt = '₹' + amt;
      amtEl.textContent = this._qrAmt;
      noteEl.textContent = 'Pay ' + this._qrAmt + ' via any UPI app. After payment, tap “I’ve Paid” and upload your screenshot.';
      upiEl.textContent = 'UPI ID: ' + UPI_ID + '  ·  ' + UPI_NAME + '  ·  Amount: ' + this._qrAmt + '  ·  ' + label;
      const upiUrl = `upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent(UPI_NAME)}&am=${amt}&cu=INR&tn=${encodeURIComponent(label + ' · ' + (cid || ''))}`;
      box.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(upiUrl)}&ecc=L" alt="UPI QR" onerror="this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#eee;border-radius:14px;color:#999;font-size:14px\\'>QR</div>'">`;
    },
    goToForm() { this.showStep('form'); },
    toggleScanner() { toggleScanner(); },

    /** Show the Pro upgrade card. Resolves true when user becomes Pro (already was or just subscribed). */
    async requirePro(feature) {
      const cid = coupleId();
      if (!cid) { toast('Please log in to continue', 'error'); return false; }
      const already = await isPro(cid);
      if (already) return true;
      toast(feature ? `${feature} is a Pro feature` : 'Pro feature', 'info');
      this.open();
      return false;
    },

    async check() {
      const cid = coupleId();
      if (!cid) return { isPro: false, plan: null };
      const status = await fetchProStatus(cid);
      proCache = { coupleId: cid, isPro: !!status && status.isPro, plan: status && status.plan, ts: Date.now() };
      return proCache;
    }
  };
})();
